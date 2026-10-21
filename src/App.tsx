import { useCallback, useEffect, useMemo, useState } from "react";
import { Capture } from "./core/capture";
import { formatShort, today } from "./core/dates";
import { Hold } from "./core/hold";
import { basename } from "./core/parse";
import { slugify } from "./core/templates";
import { hideWindow, loadSettings, onQuickCapture, openFs, saveSettings } from "./lib/platform";
import { HoldProvider, useHold } from "./ui/HoldContext";
import { PromptModal, PromptSpec, QuickCapture } from "./ui/Modals";
import { Sidebar } from "./ui/Sidebar";
import { Nav, NavCtx, NewKind, View } from "./ui/nav";
import { ChartsView } from "./ui/views/ChartsView";
import { DispatchView } from "./ui/views/DispatchView";
import { FlagsView } from "./ui/views/FlagsView";
import { ClaudePanel } from "./ui/ClaudePanel";
import { sendToClaude } from "./ui/claudeBridge";
import { WaitingView } from "./ui/views/WaitingView";
import { useReminders } from "./ui/useReminders";
import { AgendaView } from "./ui/views/AgendaView";
import { CalendarView } from "./ui/views/CalendarView";
import { FileView } from "./ui/views/FileView";
import { SearchView } from "./ui/views/SearchView";
import { SettingsView } from "./ui/views/SettingsView";
import { TimesheetView } from "./ui/views/TimesheetView";

/** Editors listen for this and save immediately, so other writers never race unsaved typing. */
export const FLUSH_EVENT = "keel-flush";

export default function App() {
  const [state, setState] = useState<{ hold: Hold; dir: string } | { error: string } | null>(null);

  useEffect(() => {
    (async () => {
      const { fs, dir } = await openFs();
      const hold = new Hold(fs);
      await hold.init();
      setState({ hold, dir });
    })().catch((e) => setState({ error: e instanceof Error ? e.message : String(e) }));
  }, []);

  if (!state) return <div className="splash">Opening the hold…</div>;
  if ("error" in state) {
    return (
      <div className="splash">
        <div>
          <h1>Couldn't open the hold</h1>
          <p className="muted">{state.error}</p>
          <button
            onClick={() => {
              saveSettings({ ...loadSettings(), holdDir: undefined });
              window.location.reload();
            }}
          >
            Use the default folder
          </button>
        </div>
      </div>
    );
  }
  return (
    <HoldProvider hold={state.hold} dir={state.dir}>
      <Shell />
    </HoldProvider>
  );
}

function Shell() {
  const { hold, bump, reportError, toast, focus } = useHold();
  useReminders(hold);
  const [view, setView] = useState<View>({ kind: "agenda" });
  const [capture, setCapture] = useState<{ hideAfter: boolean } | null>(null);
  const [prompt, setPrompt] = useState<PromptSpec | null>(null);

  const openFile = useCallback((path: string, line?: number) => setView({ kind: "file", path, line }), []);

  const openLog = useCallback(
    async (date: string) => {
      try {
        const path = await hold.ensureLog(date);
        bump();
        openFile(path);
      } catch (e) {
        reportError(e);
      }
    },
    [hold, bump, openFile, reportError],
  );
  const openToday = useCallback(() => openLog(today()), [openLog]);

  const openLink = useCallback(
    async (target: string) => {
      const found = hold.resolveLink(target);
      if (found) return openFile(found);
      try {
        const name = target.split("/").pop()!;
        const folder = target.includes("/") ? target.split("/").slice(0, -1).join("/") : "notes";
        const path = await hold.createNote(name, folder);
        bump();
        openFile(path);
      } catch (e) {
        reportError(e);
      }
    },
    [hold, bump, openFile, reportError],
  );

  const startCapture = useCallback((hideAfter = false) => {
    window.dispatchEvent(new Event(FLUSH_EVENT));
    setCapture({ hideAfter });
  }, []);

  const submitCapture = async (c: Capture) => {
    try {
      const day = c.date ?? today();
      const onDay = c.date ? ` (${formatShort(c.date)})` : "";
      let message: string;
      if (c.kind === "ask") {
        setClaudeMounted(true);
        setClaudeOpen(true);
        sendToClaude(c.ask!);
        message = "Sent to Claude";
      } else if (c.kind === "flag") {
        await hold.hoistFlag(c.line, "yellow", focus);
        message = "Flag hoisted";
      } else if (c.kind === "note") {
        const path = await hold.appendToNote(c.note!, c.line);
        message = `Added to ${hold.get(path)?.title ?? c.note}`;
      } else {
        if (c.work) await hold.logWork(day, c.work.key, c.work);
        else await hold.appendTo(await hold.ensureLog(day), c.heading, c.line);
        const what = { log: "Added to the log", task: "Task added", work: c.work?.hours ? "Hours logged" : "Added to work", waiting: "Added to waiting on", reminder: "Reminder set" };
        message = what[c.kind] + onDay;
      }
      bump();
      toast(message);
      // from the global hotkey with Keel hidden: hide again, unless Claude's answer is coming
      const hide = capture?.hideAfter && c.kind !== "ask";
      setCapture(null);
      if (hide) await hideWindow();
    } catch (e) {
      reportError(e);
    }
  };

  const newItem = useCallback(
    (kind: NewKind, client?: string, project?: string) => {
      const make = async (fn: () => Promise<string>) => {
        try {
          const path = await fn();
          bump();
          setPrompt(null);
          openFile(path);
        } catch (e) {
          reportError(e);
        }
      };
      const specs: Record<typeof kind, PromptSpec> = {
        note: {
          title: "New note",
          label: "Title",
          submitLabel: "Create",
          choice: {
            label: "Project (optional)",
            initial: project ?? "",
            options: [
              { value: "", label: focus ? `(none, just ${hold.clients().get(focus)?.name ?? focus})` : "(none)" },
              ...hold
                .all()
                .filter((f) => f.kind === "project" && f.frontmatter.status !== "done" && (!focus || hold.fileClient(f) === focus))
                .map((p) => {
                  const c = hold.fileClient(p);
                  return { value: slugify(basename(p.path)), label: `${p.title}${c ? ` · ${hold.clients().get(c)?.name ?? c}` : ""}` };
                })
                .sort((a, b) => a.label.localeCompare(b.label)),
            ],
          },
          onSubmit: (v, _d, proj) => make(() => hold.createNote(v, "notes", proj ? undefined : focus, proj || undefined)),
        },
        meeting: {
          title: "New meeting",
          label: "Meeting title",
          placeholder: "Acme kickoff",
          withDate: true,
          submitLabel: "Create",
          onSubmit: (v, d) => make(() => hold.createMeeting(v, d, focus)),
        },
        client: {
          title: "New client",
          label: "Client name",
          placeholder: "Acme Corp",
          submitLabel: "Create",
          onSubmit: (v) => make(() => hold.createClient(v)),
        },
        project: {
          title: "New project",
          label: "Project name",
          placeholder: "Portal rebuild",
          choice: {
            label: "Client",
            initial: client,
            options: [
              ...[...hold.clients().values()].sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ value: c.key, label: c.name })),
              { value: "", label: "(no client)" },
            ],
          },
          submitLabel: "Create",
          onSubmit: (v, _d, c) => make(() => hold.createProject(v, c)),
        },
      };
      setPrompt(specs[kind]);
    },
    [hold, bump, openFile, reportError, focus],
  );

  // Claude panel: mounted on first open, then only hidden, so its session survives toggling
  const [claudeOpen, setClaudeOpen] = useState(false);
  const [claudeMounted, setClaudeMounted] = useState(false);
  const toggleClaude = useCallback(() => {
    setClaudeMounted(true);
    setClaudeOpen((o) => !o);
  }, []);

  const nav: Nav = useMemo(
    () => ({ view, go: setView, openFile, openToday, openLog, openLink, capture: () => startCapture(), newItem, claudeOpen, toggleClaude }),
    [view, openFile, openToday, openLog, openLink, startCapture, newItem, claudeOpen, toggleClaude],
  );

  // start on today's log
  useEffect(() => {
    openToday();
  }, [openToday]);

  // global hotkey / tray → capture
  useEffect(() => onQuickCapture((wasHidden) => startCapture(wasHidden)), [startCapture]);

  // in-app shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key === "`") {
        e.preventDefault();
        toggleClaude();
        return;
      }
      // inside the Claude terminal, its own keys (Ctrl+T, Ctrl+J, …) win
      if ((e.target as Element | null)?.closest?.(".claude-panel")) return;
      const k = e.key.toLowerCase();
      const act: Record<string, () => void> = e.shiftKey
        ? { f: () => setView({ kind: "search" }), m: () => newItem("meeting") }
        : { k: () => startCapture(), t: openToday, j: () => setView({ kind: "agenda" }), n: () => newItem("note") };
      if (act[k]) {
        e.preventDefault();
        act[k]();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [startCapture, openToday, newItem, toggleClaude]);

  return (
    <NavCtx.Provider value={nav}>
      <div className="app">
        <Sidebar />
        <main className="main">
          <div className="main-content">
            {view.kind === "file" && <FileView path={view.path} line={view.line} />}
            {view.kind === "agenda" && <AgendaView />}
            {view.kind === "flags" && <FlagsView />}
            {view.kind === "waiting" && <WaitingView />}
            {view.kind === "dispatch" && <DispatchView />}
            {view.kind === "charts" && <ChartsView />}
            {view.kind === "timesheet" && <TimesheetView />}
            {view.kind === "calendar" && <CalendarView />}
            {view.kind === "search" && <SearchView initial={view.q} />}
            {view.kind === "settings" && <SettingsView section={view.section} />}
          </div>
          {claudeMounted && <ClaudePanel open={claudeOpen} onClose={() => setClaudeOpen(false)} />}
        </main>
      </div>
      {capture && <QuickCapture onSubmit={submitCapture} onClose={() => setCapture(null)} focus={focus} />}
      {prompt && <PromptModal spec={prompt} onClose={() => setPrompt(null)} />}
    </NavCtx.Provider>
  );
}
