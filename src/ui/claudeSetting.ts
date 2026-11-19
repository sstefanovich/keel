import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import { isTauri } from "../lib/platform";

/**
 * Whether Keel shows its Claude features (the chat and terminal, "? ask" in capture, the
 * Timesheet's Claude menu, recipe substitutions…). "auto" shows them when Claude Code is
 * installed on this computer; "on" / "off" decide regardless. Per machine.
 */
export type ClaudePref = "auto" | "on" | "off";

const KEY = "keel.claude";
const listeners = new Set<() => void>();

function readPref(): ClaudePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "on" || v === "off" ? v : "auto";
  } catch {
    return "auto";
  }
}

let pref = readPref();
/** Claude Code found on this computer: null until checked */
let installed: boolean | null = null;
let snapshot: { pref: ClaudePref; installed: boolean | null; enabled: boolean } = { pref, installed, enabled: false };

function update() {
  // while the check runs, "auto" stays hidden rather than flashing buttons that might not work
  snapshot = { pref, installed, enabled: pref === "on" || (pref === "auto" && installed === true) };
  listeners.forEach((l) => l());
}

/** Look for Claude Code (again, e.g. after installing it). */
export async function checkClaude(): Promise<boolean> {
  try {
    installed = isTauri ? !!(await invoke<string | null>("claude_path")) : false;
  } catch {
    installed = false;
  }
  update();
  return installed;
}

void checkClaude();
update();

export function setClaudePref(p: ClaudePref) {
  pref = p;
  try {
    localStorage.setItem(KEY, p);
  } catch {
    // won't survive a restart
  }
  update();
}

/** For code outside React (handlers, commands). */
export function claudeEnabled(): boolean {
  return snapshot.enabled;
}

export function useClaude(): { pref: ClaudePref; installed: boolean | null; enabled: boolean } {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
  );
}
