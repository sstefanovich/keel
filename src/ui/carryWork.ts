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
