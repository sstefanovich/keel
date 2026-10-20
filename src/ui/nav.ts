import { createContext, useContext } from "react";

export type View =
  | { kind: "file"; path: string; line?: number }
  | { kind: "agenda" }
  | { kind: "timesheet" }
  | { kind: "calendar" }
  | { kind: "search"; q?: string }
  | { kind: "settings" };

export interface Nav {
  view: View;
  go: (v: View) => void;
  openFile: (path: string, line?: number) => void;
  openToday: () => void;
  openLog: (date: string) => void;
  openLink: (target: string) => void;
  capture: () => void;
  newItem: (kind: "note" | "meeting" | "client") => void;
}

export const NavCtx = createContext<Nav | null>(null);

export function useNav(): Nav {
  const n = useContext(NavCtx);
  if (!n) throw new Error("useNav outside NavCtx");
  return n;
}
