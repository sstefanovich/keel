import { createContext, useContext } from "react";
import type { PromptSpec } from "./Modals";

export type View =
  | { kind: "file"; path: string; line?: number }
  | { kind: "agenda" }
  | { kind: "scratch" }
  | { kind: "flags" }
  | { kind: "waiting" }
  | { kind: "dispatch" }
  | { kind: "charts" }
  | { kind: "timesheet" }
  | { kind: "calendar"; date?: string }
  | { kind: "search"; q?: string }
  | { kind: "settings"; section?: string };

const VIEW_KINDS = new Set(["file", "agenda", "scratch", "flags", "waiting", "dispatch", "charts", "timesheet", "calendar", "search", "settings"]);

export function isView(v: unknown): v is View {
  if (typeof v !== "object" || v === null) return false;
  const kind = (v as { kind?: unknown }).kind;
  if (typeof kind !== "string" || !VIEW_KINDS.has(kind)) return false;
  return kind !== "file" || typeof (v as { path?: unknown }).path === "string";
}

export type NewKind = "note" | "meeting" | "client" | "project";

/** Where to show something: the current tab (default) or a new one. */
export interface OpenOpts {
  newTab?: boolean;
}

/** Ctrl/Cmd+click or middle-click opens in a new tab, like a browser. */
export function openOpts(e?: { ctrlKey?: boolean; metaKey?: boolean; button?: number }): OpenOpts {
  return { newTab: !!e && (!!e.ctrlKey || !!e.metaKey || e.button === 1) };
}

export interface TabInfo {
  id: string;
  view: View;
}

export interface Nav {
  view: View;
  go: (v: View, o?: OpenOpts) => void;
  openFile: (path: string, line?: number, o?: OpenOpts) => void;
  openToday: (o?: OpenOpts) => void;
  openLog: (date: string, o?: OpenOpts) => void;
  openLink: (target: string, o?: OpenOpts) => void;
  capture: () => void;
  /** For "project", `client` preselects the client; for "note", `project` preselects the project. */
  newItem: (kind: NewKind, client?: string, project?: string) => void;
  /** Quick open (Ctrl+P) */
  openSwitcher: () => void;
  /** The first-run tour */
  openTour: () => void;
  /** Ask for a value (rename, new folder, …); closes itself when onSubmit succeeds */
  prompt: (spec: PromptSpec) => void;
  /** The Claude terminal panel */
  claudeOpen: boolean;
  toggleClaude: () => void;
  /** Tabs */
  tabs: TabInfo[];
  activeTab: string;
  selectTab: (id: string) => void;
  closeTab: (id: string) => void;
  newTab: () => void;
  moveTab: (id: string, to: number) => void;
  back: () => void;
  forward: () => void;
  canBack: boolean;
  canForward: boolean;
  /** Sidebar */
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

export const NavCtx = createContext<Nav | null>(null);

export function useNav(): Nav {
  const n = useContext(NavCtx);
  if (!n) throw new Error("useNav outside NavCtx");
  return n;
}
