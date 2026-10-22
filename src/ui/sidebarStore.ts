import { useSyncExternalStore } from "react";

/**
 * Per-machine sidebar state kept in localStorage: which sections/folders are open,
 * recently opened files, and how the Notes section is grouped.
 */

type Listener = () => void;

function createStore<T>(key: string, fallback: T, valid: (v: unknown) => v is T) {
  let value: T = fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (valid(parsed)) value = parsed;
    }
  } catch {
    // use the fallback
  }
  const listeners = new Set<Listener>();
  return {
    get: () => value,
    set(next: T) {
      value = next;
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // just won't persist
      }
      listeners.forEach((l) => l());
    },
    subscribe(l: Listener) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}

const isRecord = (v: unknown): v is Record<string, boolean> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

// ---------- open/closed sections and folders ----------

const openStore = createStore<Record<string, boolean>>("keel.sidebarOpen", {}, isRecord);

/** Whether a section/folder is open; `byDefault` applies until the user toggles it. */
export function useOpen(key: string, byDefault: boolean): [boolean, () => void] {
  const state = useSyncExternalStore(openStore.subscribe, openStore.get);
  const open = key in state ? state[key] : byDefault;
  return [open, () => openStore.set({ ...openStore.get(), [key]: !open })];
}

export function setOpen(key: string, open: boolean) {
  openStore.set({ ...openStore.get(), [key]: open });
}

// ---------- recently opened files ----------

const RECENT_MAX = 8;
const recentStore = createStore<string[]>("keel.recent", [], isStrings);

export function pushRecent(path: string) {
  const list = recentStore.get();
  if (list[0] === path) return;
  recentStore.set([path, ...list.filter((p) => p !== path)].slice(0, RECENT_MAX));
}

export function renameRecent(from: string, to: string) {
  const list = recentStore.get();
  if (list.includes(from)) recentStore.set(list.map((p) => (p === from ? to : p)));
}

export function useRecent(): string[] {
  return useSyncExternalStore(recentStore.subscribe, recentStore.get);
}

// ---------- how Notes are grouped ----------

export type NotesMode = "folders" | "project" | "az";
const modeStore = createStore<NotesMode>("keel.notesMode", "folders", (v): v is NotesMode => v === "folders" || v === "project" || v === "az");

export function useNotesMode(): [NotesMode, (m: NotesMode) => void] {
  return [useSyncExternalStore(modeStore.subscribe, modeStore.get), modeStore.set];
}
