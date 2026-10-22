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
import { Nav, NavCtx, NewKind, OpenOpts, View, isView } from "./ui/nav";
import { TabBar } from "./ui/TabBar";
import { QuickSwitcher } from "./ui/QuickSwitcher";
import { Tour, tourSeen } from "./ui/Tour";
import { TabsState, canBack, canForward, closeTab, currentView, cycleTab, go, initTabs, moveTab, navigate, reopenClosed, restoreTabs, selectTab, serializeTabs } from "./ui/tabs";
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
  // tabs, each with its own history; restored from the last session
  const [tabs, setTabs] = useState<TabsState<View>>(() => {
    try {
      return restoreTabs(localStorage.getItem(TABS_KEY), isView) ?? initTabs<View>({ kind: "agenda" });
    } catch {
      return initTabs<View>({ kind: "agenda" });
    }
  });
  const [hadSavedTabs] = useState(() => {
    try {
      return !!localStorage.getItem(TABS_KEY);
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(TABS_KEY, serializeTabs(tabs));
    } catch {
      // tabs just won't be restored
    }
  }, [tabs]);
  const view = currentView(tabs);
  const show = useCallback((v: View, o?: OpenOpts) => setTabs((s) => navigate(s, v, o?.newTab)), []);

  const [capture, setCapture] = useState<{ hideAfter: boolean } | null>(null);
  const [prompt, setPrompt] = useState<PromptSpec | null>(null);
  const [switcher, setSwitcher] = useState(false);
  const [tour, setTour] = useState(() => !tourSeen());

  // sidebar: collapsible to an icon rail, and resizable
  const [sidebar, setSidebar] = useState(loadSidebar);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, JSON.stringify(sidebar));
    } catch {
      // ignore
    }
  }, [sidebar]);
  const toggleSidebar = useCallback(() => setSidebar((s) => ({ ...s, collapsed: !s.collapsed })), []);

  const openFile = useCallback((path: string, line?: number, o?: OpenOpts) => show({ kind: "file", path, line }, o), [show]);

  const openLog = useCallback(
    async (date: string, o?: OpenOpts) => {
      try {
        const path = await hold.ensureLog(date);
        bump();
        openFile(path, undefined, o);
      } catch (e) {
        reportError(e);
      }
    },
    [hold, bump, openFile, reportError],
  );
  const openToday = useCallback((o?: OpenOpts) => openLog(today(), o), [openLog]);

  const openLink = useCallback(
    async (target: string, o?: OpenOpts) => {
      const found = hold.resolveLink(target);
      if (found) return openFile(found, undefined, o);
      try {
        const name = target.split("/").pop()!;
        const folder = target.includes("/") ? target.split("/").slice(0, -1).join("/") : "notes";
        const path = await hold.createNote(name, folder);
        bump();
        openFile(path, undefined, o);
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

  const newTab = useCallback(() => openToday({ newTab: true }), [openToday]);
  const closeTabById = useCallback((id: string) => setTabs((s) => closeTab(s, id, { kind: "agenda" })), []);

  const nav: Nav = useMemo(
    () => ({
      view,
      go: show,
      openFile,
      openToday,
      openLog,
      openLink,
      capture: () => startCapture(),
      newItem,
      openSwitcher: () => setSwitcher(true),
      openTour: () => setTour(true),
      claudeOpen,
      toggleClaude,
      tabs: tabs.tabs.map((t) => ({ id: t.id, view: t.history[t.index] })),
      activeTab: tabs.active,
      selectTab: (id) => setTabs((s) => selectTab(s, id)),
      closeTab: closeTabById,
      newTab,
      moveTab: (id, to) => setTabs((s) => moveTab(s, id, to)),
      back: () => setTabs((s) => go(s, -1)),
      forward: () => setTabs((s) => go(s, 1)),
      canBack: canBack(tabs),
      canForward: canForward(tabs),
      sidebarCollapsed: sidebar.collapsed,
      toggleSidebar,
    }),
    [view, show, openFile, openToday, openLog, openLink, startCapture, newItem, claudeOpen, toggleClaude, tabs, closeTabById, newTab, sidebar.collapsed, toggleSidebar],
  );

  // start on today's log, unless tabs were restored (then just make sure today's log exists and has its carry-over)
  useEffect(() => {
    if (hadSavedTabs) {
      hold
        .ensureLog(today())
        .then(bump)
        .catch(reportError);
    } else openToday();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // mouse back/forward buttons
  useEffect(() => {
    const onUp = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        setTabs((s) => go(s, e.button === 3 ? -1 : 1));
      }
    };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, []);

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
      // physical keys for punctuation, since e.key varies with layout and Ctrl
      const k = e.code === "BracketLeft" ? "[" : e.code === "BracketRight" ? "]" : e.key.toLowerCase();
      const act: Record<string, () => void> = e.shiftKey
        ? {
            f: () => show({ kind: "search" }),
            m: () => newItem("meeting"),
            t: () => setTabs((s) => reopenClosed(s)),
            tab: () => setTabs((s) => cycleTab(s, -1)),
          }
        : {
            k: () => startCapture(),
            t: () => openToday(),
            j: () => show({ kind: "agenda" }),
            n: () => newItem("note"),
            p: () => setSwitcher(true),
            o: () => setSwitcher(true),
            w: () => setTabs((s) => closeTab(s, s.active, { kind: "agenda" })),
            tab: () => setTabs((s) => cycleTab(s, 1)),
            "[": () => setTabs((s) => go(s, -1)),
            "]": () => setTabs((s) => go(s, 1)),
            // Ctrl+B like VS Code/Obsidian (Ctrl+\ is 1Password's global shortcut)
            b: toggleSidebar,
          };
      if (act[k]) {
        e.preventDefault();
        act[k]();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [startCapture, openToday, newItem, toggleClaude, show, toggleSidebar]);

  return (
    <NavCtx.Provider value={nav}>
      <div className={`app${sidebar.collapsed ? " sidebar-collapsed" : ""}`} style={{ gridTemplateColumns: `${sidebar.collapsed ? 56 : sidebar.width}px 1fr` }}>
        <Sidebar onResize={(width) => setSidebar((s) => ({ ...s, width }))} />
        <main className="main">
          <TabBar />
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
      {switcher && <QuickSwitcher onClose={() => setSwitcher(false)} />}
      {tour && <Tour onClose={() => setTour(false)} />}
    </NavCtx.Provider>
  );
}

const TABS_KEY = "keel.tabs";
const SIDEBAR_KEY = "keel.sidebar";

function loadSidebar(): { collapsed: boolean; width: number } {
  try {
    const s = JSON.parse(localStorage.getItem(SIDEBAR_KEY) ?? "{}");
    return { collapsed: !!s.collapsed, width: Math.min(420, Math.max(200, Number(s.width) || 248)) };
  } catch {
    return { collapsed: false, width: 248 };
  }
}
