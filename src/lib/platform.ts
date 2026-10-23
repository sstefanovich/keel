import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { HoldFs, MemoryFs } from "../core/fs";

/** True inside the Tauri shell; false when the UI runs in a plain browser via `npm run dev`. */
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export class TauriFs implements HoldFs {
  constructor(public root: string) {}
  list() {
    return invoke<{ path: string; mtime: number }[]>("hold_list", { root: this.root });
  }
  read(path: string) {
    return invoke<string>("hold_read", { root: this.root, path });
  }
  write(path: string, content: string) {
    return invoke<void>("hold_write", { root: this.root, path, content });
  }
  exists(path: string) {
    return invoke<boolean>("hold_exists", { root: this.root, path });
  }
  remove(path: string) {
    return invoke<void>("hold_remove", { root: this.root, path });
  }
  rename(from: string, to: string) {
    return invoke<void>("hold_rename", { root: this.root, from, to });
  }
  dirs() {
    return invoke<string[]>("hold_dirs", { root: this.root });
  }
  mkdir(path: string) {
    return invoke<void>("hold_mkdir", { root: this.root, path });
  }
  rmdir(path: string) {
    return invoke<void>("hold_rmdir", { root: this.root, path });
  }
}

/** Browser-only stand-in: keeps the hold in localStorage. */
class LocalStorageFs extends MemoryFs {
  constructor() {
    let initial: Record<string, string> = {};
    try {
      initial = JSON.parse(localStorage.getItem("keel.browserHold") ?? "{}");
    } catch {
      // start empty
    }
    super(initial, () => {
      const out: Record<string, string> = {};
      for (const [p, f] of this.files) out[p] = f.content;
      try {
        localStorage.setItem("keel.browserHold", JSON.stringify(out));
      } catch {
        // storage full or blocked: keep working in memory
      }
    });
  }
}

// ---------- settings ----------

export interface Settings {
  holdDir?: string;
}

export function loadSettings(): Settings {
  try {
    return JSON.parse(localStorage.getItem("keel.settings") ?? "{}");
  } catch {
    return {};
  }
}

export function saveSettings(s: Settings) {
  localStorage.setItem("keel.settings", JSON.stringify(s));
}

export async function defaultHoldDir(): Promise<string> {
  return isTauri ? invoke<string>("default_hold_dir") : "(browser storage)";
}

export async function openFs(): Promise<{ fs: HoldFs; dir: string }> {
  if (!isTauri) return { fs: new LocalStorageFs(), dir: "(browser storage)" };
  const dir = loadSettings().holdDir || (await defaultHoldDir());
  return { fs: new TauriFs(dir), dir };
}

// ---------- notifications ----------

export async function ensureNotificationPermission(): Promise<boolean> {
  if (!isTauri) return false;
  const n = await import("@tauri-apps/plugin-notification");
  if (await n.isPermissionGranted()) return true;
  return (await n.requestPermission()) === "granted";
}

export async function notify(title: string, body: string) {
  if (!isTauri) {
    console.info(`[reminder] ${title}: ${body}`);
    return;
  }
  const n = await import("@tauri-apps/plugin-notification");
  if (await ensureNotificationPermission()) n.sendNotification({ title, body });
}

// ---------- dialogs & export ----------

export async function pickFolder(current?: string): Promise<string | null> {
  if (!isTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ directory: true, defaultPath: current, title: "Choose your Hold folder" });
  return typeof r === "string" ? r : null;
}

export async function confirmDialog(message: string, okLabel = "OK"): Promise<boolean> {
  if (!isTauri) return window.confirm(message);
  const { ask } = await import("@tauri-apps/plugin-dialog");
  return ask(message, { title: "Keel", kind: "warning", okLabel, cancelLabel: "Cancel" });
}

export async function exportText(defaultName: string, content: string): Promise<boolean> {
  if (!isTauri) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type: "text/csv" }));
    a.download = defaultName;
    a.click();
    return true;
  }
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({ defaultPath: defaultName, filters: [{ name: "CSV", extensions: ["csv"] }] });
  if (!path) return false;
  await invoke("save_export", { path, content });
  return true;
}

// ---------- links & clipboard ----------

export async function openUrl(url: string) {
  if (!isTauri) {
    window.open(url, "_blank", "noopener");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // older webviews / non-secure origins: fall back to a hidden textarea
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

/** Copy formatted HTML (for Outlook/Teams) with a plain-text alternative. */
export async function copyRich(html: string, plain: string) {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" }),
      }),
    ]);
  } catch {
    await copyText(plain);
  }
}

// ---------- calendar feeds ----------

/** Download an ICS feed (in Rust: no CORS) and cache it under `id`. */
export async function calendarFetch(id: string, url: string): Promise<string> {
  if (isTauri) return invoke<string>("calendar_fetch", { id, url });
  const res = await fetch(url.replace(/^webcal:/i, "https:"));
  if (!res.ok) throw new Error(`The calendar server answered ${res.status}`);
  return res.text();
}

/** The last downloaded copy of a feed. */
export async function calendarCached(id: string): Promise<string | null> {
  return isTauri ? invoke<string | null>("calendar_cached", { id }) : null;
}

export async function calendarForget(id: string): Promise<void> {
  if (isTauri) await invoke("calendar_forget", { id });
}

// ---------- file history (snapshots in a git repository in the hold) ----------

export interface Snapshot {
  id: string;
  time: number;
}

export interface FileVersion {
  id: string;
  time: number;
  message: string;
  deleted: boolean;
}

/** Record everything that changed since the last snapshot; null when nothing did. */
export async function historySnapshot(root: string, message?: string): Promise<Snapshot | null> {
  return isTauri ? invoke<Snapshot | null>("history_snapshot", { root, message }) : null;
}

export async function historyVersions(root: string, path: string): Promise<FileVersion[]> {
  return isTauri ? invoke<FileVersion[]>("history_versions", { root, path }) : [];
}

export async function historyRead(root: string, id: string, path: string): Promise<string | null> {
  return isTauri ? invoke<string | null>("history_read", { root, id, path }) : null;
}

// ---------- autostart ----------

export async function getAutostart(): Promise<boolean> {
  if (!isTauri) return false;
  return (await import("@tauri-apps/plugin-autostart")).isEnabled();
}

export async function setAutostart(on: boolean) {
  if (!isTauri) return;
  const a = await import("@tauri-apps/plugin-autostart");
  await (on ? a.enable() : a.disable());
}

// ---------- window & events ----------

/** Fired by the global Ctrl+Alt+K shortcut and the tray menu. */
export function onQuickCapture(cb: (wasHidden: boolean) => void): () => void {
  if (!isTauri) return () => {};
  const un = listen<{ wasHidden: boolean }>("quick-capture", (e) => cb(e.payload?.wasHidden ?? false));
  return () => {
    un.then((f) => f());
  };
}

export async function hideWindow() {
  if (isTauri) await getCurrentWindow().hide();
}

export async function showMainWindow() {
  if (!isTauri) return;
  const w = getCurrentWindow();
  await w.unminimize();
  await w.show();
  await w.setFocus();
}

// ---------- the standalone quick-capture window ----------

/** True in the small always-on-top capture window (Ctrl+Alt+K while Keel isn't in front). */
export const isCaptureWindow = isTauri && getCurrentWindow().label === "capture";

/** The capture window was just shown by the hotkey or tray. */
export function onCaptureOpen(cb: () => void): () => void {
  if (!isTauri) return () => {};
  const un = listen("capture-open", () => cb());
  return () => {
    un.then((f) => f());
  };
}

export async function setWindowHeight(width: number, height: number) {
  if (!isTauri) return;
  const { LogicalSize } = await import("@tauri-apps/api/dpi");
  await getCurrentWindow().setSize(new LogicalSize(width, Math.ceil(height)));
}

interface CaptureReply {
  id: string;
  message?: string;
  error?: string;
}

/** Capture window → main window: save this (the main window owns all writes). Resolves with its confirmation. */
export async function sendCapture<T>(capture: T): Promise<string> {
  const { emitTo } = await import("@tauri-apps/api/event");
  const id = `${Date.now()}${Math.random().toString(36).slice(2)}`;
  return new Promise<string>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      un.then((f) => f());
      reject(new Error("Keel didn't answer. Is the main window still running?"));
    }, 15_000);
    const un = listen<CaptureReply>("capture-done", (e) => {
      if (e.payload.id !== id) return;
      window.clearTimeout(timer);
      un.then((f) => f());
      if (e.payload.error) reject(new Error(e.payload.error));
      else resolve(e.payload.message ?? "Saved");
    });
    un.then(() => emitTo("main", "capture-submit", { id, capture })).catch(reject);
  });
}

/** Main window: handle captures sent from the capture window. */
export function onRemoteCapture<T>(handle: (capture: T) => Promise<string>): () => void {
  if (!isTauri) return () => {};
  const un = listen<{ id: string; capture: T }>("capture-submit", async (e) => {
    const { emitTo } = await import("@tauri-apps/api/event");
    let reply: CaptureReply;
    try {
      reply = { id: e.payload.id, message: await handle(e.payload.capture) };
    } catch (err) {
      reply = { id: e.payload.id, error: err instanceof Error ? err.message : String(err) };
    }
    await emitTo("capture", "capture-done", reply);
  });
  return () => {
    un.then((f) => f());
  };
}
