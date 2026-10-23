import { useSyncExternalStore } from "react";
import { Space } from "../core/parse";

/**
 * Work or personal mode (per machine). Sets data-space on the page for the accent colour, and
 * follows changes made in Keel's other window (the quick-capture box) through the storage event.
 */
const KEY = "keel.space";
const listeners = new Set<() => void>();

function read(): Space {
  try {
    return localStorage.getItem(KEY) === "personal" ? "personal" : "work";
  } catch {
    return "work";
  }
}

let current: Space = read();

function apply() {
  if (typeof document !== "undefined") document.documentElement.dataset.space = current;
}
apply();

export function getSpace(): Space {
  return current;
}

export function setSpace(s: Space) {
  current = s;
  try {
    localStorage.setItem(KEY, s);
  } catch {
    // just for this session
  }
  apply();
  listeners.forEach((l) => l());
}

/** Re-read the saved mode (another window may have changed it). */
export function refreshSpace() {
  const s = read();
  if (s !== current) {
    current = s;
    apply();
    listeners.forEach((l) => l());
  }
}

if (typeof window !== "undefined") window.addEventListener("storage", (e) => e.key === KEY && refreshSpace());

export function useSpace(): Space {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}
