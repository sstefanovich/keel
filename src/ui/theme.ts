import { useSyncExternalStore } from "react";
import { isTauri } from "../lib/platform";

/** What the user picked; "system" follows the OS. */
export type ThemePref = "system" | "light" | "dark";
export type Theme = "light" | "dark";

const KEY = "keel.theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

let pref: ThemePref = readPref();
let snapshot = { pref, theme: resolve(pref) };

function resolve(p: ThemePref): Theme {
  return p === "system" ? (media.matches ? "dark" : "light") : p;
}

function apply() {
  const theme = resolve(pref);
  document.documentElement.dataset.theme = theme;
  snapshot = { pref, theme };
  // native title bar: follow our choice, or the OS when "system"
  if (isTauri) {
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(pref === "system" ? null : pref))
      .catch(() => {});
  }
  listeners.forEach((l) => l());
}

export function setThemePref(p: ThemePref) {
  pref = p;
  try {
    if (p === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, p);
  } catch {
    // choice just won't survive a restart
  }
  apply();
}

/** The theme currently showing (system preference resolved). */
export function currentTheme(): Theme {
  return snapshot.theme;
}

export function onThemeChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

media.addEventListener("change", () => {
  if (pref === "system") apply();
});
apply();

export function useTheme(): { pref: ThemePref; theme: Theme; setPref: (p: ThemePref) => void } {
  const s = useSyncExternalStore(onThemeChange, () => snapshot);
  return { ...s, setPref: setThemePref };
}
