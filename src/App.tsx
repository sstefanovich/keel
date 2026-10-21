import { useCallback, useEffect, useMemo, useState } from "react";
import { parseCapture } from "./core/capture";
import { today } from "./core/dates";
import { Hold } from "./core/hold";
import { hideWindow, loadSettings, onQuickCapture, openFs, saveSettings } from "./lib/platform";
import { HoldProvider, useHold } from "./ui/HoldContext";
import { PromptModal, PromptSpec, QuickCapture } from "./ui/Modals";
import { Sidebar } from "./ui/Sidebar";
import { Nav, NavCtx, NewKind, View } from "./ui/nav";
import { ChartsView } from "./ui/views/ChartsView";
import { DispatchView } from "./ui/views/DispatchView";
import { FlagsView } from "./ui/views/FlagsView";
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

  const submitCapture = async (text: string) => {
    const c = parseCapture(text, undefined, focus);
    if (!c) return;
    try {
      if (c.kind === "flag") {
        await hold.hoistFlag(c.line, "yellow", focus);
      } else if (c.work) {
        await hold.logWork(today(), c.work.key, c.work);
      } else {
        const path = await hold.ensureLog(today());
        await hold.appendTo(path, c.heading, c.line);
      }
      bump();
      toast(
        {
          hours: "Hours logged",
          work: "Added to today's work",
          log: "Added to today's log",
          reminder: "Reminder set",
          task: "Task added",
          flag: "Flag hoisted",
          waiting: "Added to waiting on",
        }[c.kind],
      );
      const hide = capture?.hideAfter;
      setCapture(null);
      if (hide) await hideWindow();
    } catch (e) {
      reportError(e);
    }
  };

  const newItem = useCallback(
    (kind: NewKind, client?: string) => {
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
        note: { title: "New note", label: "Title", submitLabel: "Create", onSubmit: (v) => make(() => hold.createNote(v, "notes", focus)) },
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

  const nav: Nav = useMemo(
    () => ({ view, go: setView, openFile, openToday, openLog, openLink, capture: () => startCapture(), newItem }),
    [view, openFile, openToday, openLog, openLink, startCapture, newItem],
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
  }, [startCapture, openToday, newItem]);

  return (
    <NavCtx.Provider value={nav}>
      <div className="app">
        <Sidebar />
        <main className="main">
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
        </main>
      </div>
      {capture && <QuickCapture onSubmit={submitCapture} onClose={() => setCapture(null)} focus={focus} />}
      {prompt && <PromptModal spec={prompt} onClose={() => setPrompt(null)} />}
    </NavCtx.Provider>
  );
}
