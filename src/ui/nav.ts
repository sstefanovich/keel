import { createContext, useContext } from "react";

export type View =
  | { kind: "file"; path: string; line?: number }
  | { kind: "agenda" }
  | { kind: "flags" }
  | { kind: "waiting" }
  | { kind: "dispatch" }
  | { kind: "charts" }
  | { kind: "timesheet" }
  | { kind: "calendar" }
  | { kind: "search"; q?: string }
  | { kind: "settings"; section?: string };

export type NewKind = "note" | "meeting" | "client" | "project";

export interface Nav {
  view: View;
  go: (v: View) => void;
  openFile: (path: string, line?: number) => void;
  openToday: () => void;
  openLog: (date: string) => void;
  openLink: (target: string) => void;
  capture: () => void;
  /** For "project", `client` preselects the client. */
  newItem: (kind: NewKind, client?: string) => void;
}

export const NavCtx = createContext<Nav | null>(null);

export function useNav(): Nav {
  const n = useContext(NavCtx);
  if (!n) throw new Error("useNav outside NavCtx");
  return n;
}
