import { useSyncExternalStore } from "react";

/** How wide the text column is: a readable max width (left-aligned) or the whole window. */
export type EditorWidth = "readable" | "full";

const KEY = "keel.editorWidth";
const listeners = new Set<() => void>();

function read(): EditorWidth {
  try {
    return localStorage.getItem(KEY) === "full" ? "full" : "readable";
  } catch {
    return "readable";
  }
}

let current = read();

function apply() {
  document.documentElement.dataset.editorWidth = current;
}
apply();

export function setEditorWidth(w: EditorWidth) {
  current = w;
  try {
    localStorage.setItem(KEY, w);
  } catch {
    // ignore
  }
  apply();
  listeners.forEach((l) => l());
}

export function useEditorWidth(): EditorWidth {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}
