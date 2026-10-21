import { useSyncExternalStore } from "react";

/** First day of a timesheet week: 0 = Sunday … 6 = Saturday. Defaults to Saturday (Sat–Fri weeks). */
const KEY = "keel.weekStart";
const DEFAULT = 6;
const listeners = new Set<() => void>();

function read(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return localStorage.getItem(KEY) !== null && v >= 0 && v <= 6 ? v : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

let current = read();

export function setWeekStart(day: number) {
  current = day;
  try {
    localStorage.setItem(KEY, String(day));
  } catch {
    // setting just won't survive a restart
  }
  listeners.forEach((l) => l());
}

export function useWeekStart(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}
