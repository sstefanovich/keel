import {
  Bell,
  Building2,
  CalendarDays,
  ClipboardCopy,
  Crosshair,
  Flag,
  FolderKanban,
  History,
  ListPlus,
  Moon,
  NotebookPen,
  NotepadText,
  PanelLeft,
  RefreshCw,
  Sparkles,
  Sun,
  SunMoon,
  Timer,
  Users,
  FilePlus,
  Zap,
  Compass,
  Coffee,
} from "lucide-react";
import { CaptureKind } from "../core/capture";
import { addDays, startOfWeek, today } from "../core/dates";
import { Hold } from "../core/hold";
import { buildWeek, weekTsv } from "../core/week";
import { copyText } from "../lib/platform";
import { refreshCalendars } from "./calendars";
import { snapshotNow } from "./history";
import { Nav, View } from "./nav";
import type { Command } from "./QuickSwitcher";
import { setThemePref } from "./theme";
import { VIEW_ICONS, VIEW_TITLES } from "./viewMeta";
import { SHOW_BRIEFING_EVENT } from "./Briefing";

/** Asks the open file view to show its History panel. */
export const OPEN_HISTORY_EVENT = "keel-open-history";

interface Ctx {
  hold: Hold;
  nav: Nav;
  view: View;
  focus?: string;
  setFocus: (client?: string) => void;
  weekStart: number;
  toast: (msg: string) => void;
  capture: (kind?: CaptureKind) => void;
}

/** Everything the command list (Ctrl+Shift+P) can do. */
export function buildCommands({ hold, nav, view, focus, setFocus, weekStart, toast, capture }: Ctx): Command[] {
  const copyWeek = async (offset: number) => {
    const start = addDays(startOfWeek(today(), weekStart), offset * 7);
    const week = buildWeek(hold, start, focus);
    if (!week.rows.length) return toast("No hours logged that week");
    await copyText(weekTsv(week));
    toast(`Copied ${offset ? "last" : "this"} week's timesheet grid`);
  };

  const cmds: Command[] = [
    { id: "today", title: "Today's log", sub: "Go", Icon: Sun, keys: "Ctrl+T", run: () => nav.openToday() },
    { id: "yesterday", title: "Yesterday's log", sub: "Go", Icon: NotebookPen, run: () => nav.openLog(addDays(today(), -1)) },
    { id: "capture", title: "Quick capture…", sub: "Capture", Icon: Zap, keys: "Ctrl+K", run: () => capture() },
    { id: "log-hours", title: "Log hours…", sub: "Capture · 6h @project what you did", Icon: Timer, run: () => capture("work") },
    { id: "add-task", title: "Add a task…", sub: "Capture", Icon: ListPlus, run: () => capture("task") },
    { id: "remind", title: "Set a reminder…", sub: "Capture · remind me 3pm …", Icon: Bell, run: () => capture("reminder") },
    { id: "flag", title: "Hoist a flag…", sub: "Capture", Icon: Flag, run: () => capture("flag") },
    { id: "jot", title: "Jot on the scratchpad…", sub: "Capture", Icon: NotepadText, run: () => capture("scratch") },
    { id: "ask", title: "Ask Claude…", sub: "Capture", Icon: Sparkles, run: () => capture("ask") },
    { id: "new-note", title: "New note…", sub: "Create", Icon: FilePlus, keys: "Ctrl+N", run: () => nav.newItem("note") },
    { id: "new-meeting", title: "New meeting…", sub: "Create", Icon: Users, keys: "Ctrl+Shift+M", run: () => nav.newItem("meeting") },
    { id: "new-project", title: "New project…", sub: "Create", Icon: FolderKanban, run: () => nav.newItem("project", focus) },
    { id: "new-client", title: "New client…", sub: "Create", Icon: Building2, run: () => nav.newItem("client") },
    { id: "copy-week", title: "Copy this week's timesheet grid", sub: "Timesheet", Icon: ClipboardCopy, run: () => void copyWeek(0) },
    { id: "copy-last-week", title: "Copy last week's timesheet grid", sub: "Timesheet", Icon: ClipboardCopy, run: () => void copyWeek(-1) },
    { id: "calendar-week", title: "This week's calendar", sub: "Calendar", Icon: CalendarDays, run: () => nav.go({ kind: "calendar", mode: "week" }) },
    { id: "refresh-calendars", title: "Refresh calendars", sub: "Calendar", Icon: RefreshCw, run: () => void refreshCalendars().then(() => toast("Calendars refreshed")) },
    {
      id: "snapshot",
      title: "Save a history snapshot now",
      sub: "File history",
      Icon: History,
      run: () => void snapshotNow("Snapshot from the command list", true).then((saved) => toast(saved ? "Snapshot saved" : "Nothing changed since the last snapshot")),
    },
    { id: "theme-light", title: "Theme: light", sub: "Appearance", Icon: Sun, run: () => setThemePref("light") },
    { id: "theme-dark", title: "Theme: dark", sub: "Appearance", Icon: Moon, run: () => setThemePref("dark") },
    { id: "theme-system", title: "Theme: follow Windows", sub: "Appearance", Icon: SunMoon, run: () => setThemePref("system") },
    { id: "sidebar", title: "Toggle the sidebar", sub: "Layout", Icon: PanelLeft, keys: "Ctrl+B", run: nav.toggleSidebar },
    { id: "claude", title: nav.claudeOpen ? "Hide Claude" : "Show Claude", sub: "Layout", Icon: Sparkles, keys: "Ctrl+`", run: nav.toggleClaude },
    { id: "tour", title: "Show the tour", sub: "Help", Icon: Compass, run: nav.openTour },
    {
      id: "briefing",
      title: "Show today's briefing",
      sub: "Today",
      Icon: Coffee,
      run: () => {
        try {
          localStorage.removeItem("keel.briefingDismissed");
        } catch {
          // ignore
        }
        nav.openToday();
        // the log may already be open: ask it to show the card again
        window.setTimeout(() => window.dispatchEvent(new Event(SHOW_BRIEFING_EVENT)), 50);
      },
    },
  ];

  if (view.kind === "file") {
    cmds.splice(2, 0, { id: "history", title: "File history: this file's earlier versions", sub: "This file", Icon: History, run: () => window.dispatchEvent(new Event(OPEN_HISTORY_EVENT)) });
  }

  // every view, so "> time" finds the timesheet too
  for (const k of Object.keys(VIEW_TITLES) as (keyof typeof VIEW_TITLES)[]) {
    cmds.push({ id: `view-${k}`, title: `Open ${VIEW_TITLES[k]}`, sub: "Go", Icon: VIEW_ICONS[k], run: () => nav.go({ kind: k } as View) });
  }

  for (const c of [...hold.clients().values()].sort((a, b) => a.name.localeCompare(b.name))) {
    cmds.push({ id: `focus-${c.key}`, title: `Focus on ${c.name}`, sub: "Focus", Icon: Crosshair, run: () => setFocus(c.key) });
  }
  if (focus) cmds.push({ id: "focus-clear", title: "Clear the focus (all clients)", sub: "Focus", Icon: Crosshair, run: () => setFocus(undefined) });
  return cmds;
}
