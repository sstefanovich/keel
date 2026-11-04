import { useSyncExternalStore } from "react";

/** Whether a new day's log starts with yesterday's projects and hours under Work ("- 6h @project", no items). Per machine. */
const KEY = "keel.carryWorkProjects";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

let current = read();

export function carryWorkEnabled(): boolean {
  return current;
}

export function setCarryWork(on: boolean) {
  current = on;
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // setting just won't survive a restart
  }
  listeners.forEach((l) => l());
}

export function useCarryWork(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

/** The last day whose log was given the carried-over work (see Hold.workCarriedOn). Per machine. */
const CARRIED_KEY = "keel.workCarriedOn";
export const workCarriedStore = {
  get(): string | null {
    try {
      return localStorage.getItem(CARRIED_KEY);
    } catch {
      return null;
    }
  },
  set(d: string) {
    try {
      localStorage.setItem(CARRIED_KEY, d);
    } catch {
      // then it may carry once more after a restart, into a Work section that's still empty
    }
  },
};
