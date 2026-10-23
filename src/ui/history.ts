import { useSyncExternalStore } from "react";
import { historySnapshot, isTauri } from "../lib/platform";

/**
 * Automatic file history: every 10 minutes (and at startup) Keel records whatever changed in the
 * Hold as a local snapshot, so any file can be viewed or restored as it was. Per-machine on/off.
 */
const KEY = "keel.history";
const EVERY_MS = 10 * 60_000;

interface State {
  enabled: boolean;
  last?: number;
  busy: boolean;
  error?: string;
}

const listeners = new Set<() => void>();
let state: State = { enabled: readEnabled(), busy: false };

function readEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

let root = "";

/** Take a snapshot now (skipped while one is running). Resolves true if anything was recorded. */
export async function snapshotNow(message?: string): Promise<boolean> {
  if (!isTauri || !root || state.busy) return false;
  set({ busy: true });
  try {
    const s = await historySnapshot(root, message);
    set({ busy: false, last: Date.now(), error: undefined });
    return !!s;
  } catch (e) {
    set({ busy: false, error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

export function setHistoryEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // just for this session
  }
  set({ enabled: on });
  if (on) void snapshotNow();
}

export function startHistory(dir: string): () => void {
  root = dir;
  const tick = () => {
    if (state.enabled) void snapshotNow();
  };
  const first = window.setTimeout(tick, 15_000);
  const timer = window.setInterval(tick, EVERY_MS);
  return () => {
    window.clearTimeout(first);
    window.clearInterval(timer);
  };
}

export function useHistory(): State {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}
