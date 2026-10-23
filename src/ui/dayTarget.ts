import { useSyncExternalStore } from "react";
import { DEFAULT_TARGET, DayTarget } from "../core/week";

/** Hours expected per working day, for the timesheet's gap check. Per machine. */
const KEY = "keel.dayTarget";
const listeners = new Set<() => void>();

function read(): DayTarget {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && typeof v.hours === "number" && Array.isArray(v.workdays)) return { hours: v.hours, workdays: v.workdays.filter((d: unknown) => typeof d === "number") };
  } catch {
    // fall through
  }
  return DEFAULT_TARGET;
}

let current = read();

export function setDayTarget(t: DayTarget) {
  current = t;
  try {
    localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    // setting just won't survive a restart
  }
  listeners.forEach((l) => l());
}

export function useDayTarget(): DayTarget {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}
