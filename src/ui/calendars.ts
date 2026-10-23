import { useMemo, useSyncExternalStore } from "react";
import { toISO } from "../core/dates";
import { Hold } from "../core/hold";
import { CalEvent, Calendar, expand, parseIcs } from "../core/ics";
import { calendarCached, calendarFetch, calendarForget } from "../lib/platform";

/**
 * Subscribed calendars (Outlook / Google ICS links). The links are secrets, so they live in this
 * machine's settings, never in the Hold; downloaded feeds are cached by the Rust side.
 */
export interface CalendarSource {
  id: string;
  name: string;
  url: string;
  color: string;
  enabled: boolean;
}

export interface SourceState {
  status: "loading" | "ok" | "error";
  error?: string;
  /** When the feed was last downloaded (ms); undefined while showing only the cached copy */
  fetchedAt?: number;
  cal?: Calendar;
}

export interface CalItem extends CalEvent {
  calendar: { id: string; name: string; color: string };
}

export const CALENDAR_COLORS = ["#2f7bd8", "#d9822b", "#3a9d5d", "#9b59b6", "#d64550", "#1f9aa5", "#7a7a7a"];

const KEY = "keel.calendars";
const REFRESH_MS = 15 * 60_000;

function load(): CalendarSource[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((s) => s && typeof s.id === "string" && typeof s.url === "string") : [];
  } catch {
    return [];
  }
}

let sources: CalendarSource[] = load();
const states = new Map<string, SourceState>();
const listeners = new Set<() => void>();
let snapshot = { sources, states: new Map(states), version: 0 };

function emit() {
  snapshot = { sources, states: new Map(states), version: snapshot.version + 1 };
  for (const l of listeners) l();
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(sources));
  } catch {
    // storage blocked: keep the list for this session
  }
}

function setState(id: string, patch: Partial<SourceState>) {
  states.set(id, { status: "loading", ...states.get(id), ...patch });
  emit();
}

/** A guess at a calendar's name from its link. */
export function nameFromUrl(url: string): string {
  if (/outlook\.(office365|office|live)\.com/i.test(url)) return "Outlook";
  if (/calendar\.google\.com/i.test(url)) return "Google";
  if (/icloud\.com/i.test(url)) return "iCloud";
  return "Calendar";
}

export async function refreshCalendar(id: string): Promise<void> {
  const s = sources.find((x) => x.id === id);
  if (!s) return;
  setState(id, { status: "loading", error: undefined });
  try {
    const text = await calendarFetch(id, s.url);
    setState(id, { status: "ok", fetchedAt: Date.now(), cal: parseIcs(text) });
  } catch (e) {
    setState(id, { status: "error", error: e instanceof Error ? e.message : String(e) });
  }
}

export function refreshCalendars(): Promise<void> {
  return Promise.all(sources.filter((s) => s.enabled).map((s) => refreshCalendar(s.id))).then(() => {});
}

/** Add a calendar; resolves once its first download succeeds (rejects, and adds nothing, if it fails). */
export async function addCalendar(url: string, name?: string): Promise<CalendarSource> {
  // forgive what comes along with a pasted link: spaces, quotes, <angle brackets>
  const clean = url.trim().replace(/^[<"'\s]+|[>"'\s]+$/g, "");
  if (!/^(https?|webcal):\/\/\S+$/i.test(clean)) throw new Error("Paste the calendar's full link, starting with https:// or webcal://");
  if (sources.some((s) => s.url === clean)) throw new Error("That calendar is already added");
  const id = `cal${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const text = await calendarFetch(id, clean);
  const cal = parseIcs(text);
  const used = new Set(sources.map((s) => s.color));
  const source: CalendarSource = {
    id,
    url: clean,
    name: name?.trim() || cal.name || nameFromUrl(clean),
    color: CALENDAR_COLORS.find((c) => !used.has(c)) ?? CALENDAR_COLORS[sources.length % CALENDAR_COLORS.length],
    enabled: true,
  };
  sources = [...sources, source];
  persist();
  states.set(id, { status: "ok", fetchedAt: Date.now(), cal });
  emit();
  return source;
}

export function updateCalendar(id: string, patch: Partial<Omit<CalendarSource, "id" | "url">>) {
  sources = sources.map((s) => (s.id === id ? { ...s, ...patch } : s));
  persist();
  emit();
  if (patch.enabled && !states.get(id)?.cal) void refreshCalendar(id);
}

export async function removeCalendar(id: string) {
  sources = sources.filter((s) => s.id !== id);
  states.delete(id);
  persist();
  emit();
  await calendarForget(id).catch(() => {});
}

let started = false;

/** Show cached feeds straight away, then keep them fresh (every 15 min and when Keel regains focus). */
export function startCalendarSync(): () => void {
  if (started) return () => {};
  started = true;
  void (async () => {
    for (const s of sources) {
      try {
        const text = await calendarCached(s.id);
        if (text && !states.get(s.id)?.fetchedAt) setState(s.id, { status: "loading", cal: parseIcs(text) });
      } catch {
        // no cache yet
      }
    }
    await refreshCalendars();
  })();
  const stale = () => {
    for (const s of sources) {
      const st = states.get(s.id);
      if (s.enabled && st?.status !== "loading" && (!st?.fetchedAt || Date.now() - st.fetchedAt > REFRESH_MS)) void refreshCalendar(s.id);
    }
  };
  const timer = window.setInterval(stale, REFRESH_MS);
  window.addEventListener("focus", stale);
  return () => {
    started = false;
    window.clearInterval(timer);
    window.removeEventListener("focus", stale);
  };
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useCalendars() {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** Events from every enabled calendar overlapping [from, to) (ms), sorted by start. */
export function useCalendarEvents(from: number, to: number): CalItem[] {
  const { sources: list, states: st, version } = useCalendars();
  return useMemo(() => {
    const out: CalItem[] = [];
    for (const s of list) {
      const cal = s.enabled ? st.get(s.id)?.cal : undefined;
      if (!cal) continue;
      for (const e of expand(cal, from, to)) out.push({ ...e, id: `${s.id}:${e.id}`, calendar: { id: s.id, name: s.name, color: s.color } });
    }
    return out.sort((a, b) => a.start - b.start || Number(b.allDay) - Number(a.allDay));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, from, to]);
}

/** Local ISO dates (YYYY-MM-DD) an event covers. */
export function eventDays(e: CalEvent): string[] {
  const days: string[] = [];
  const d = new Date(e.start);
  d.setHours(0, 0, 0, 0);
  const last = Math.max(e.start, e.end - 1);
  for (let i = 0; d.getTime() <= last && i < 366; i++) {
    days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    d.setDate(d.getDate() + 1);
  }
  return days;
}

/** The meeting note for an event: the existing one (same date and title), or a new one filled in from the event. */
export async function eventNotes(hold: Hold, e: CalEvent, focus?: string): Promise<string> {
  const date = toISO(new Date(e.start));
  const existing = hold.meetingNote(date, e.title);
  if (existing) return existing.path;
  const owner = hold.guessOwner(e.title);
  return hold.createMeeting(e.title, date, owner.client ?? focus, {
    time: e.allDay ? undefined : new Date(e.start),
    attendees: e.attendees,
    project: owner.project,
  });
}

/** "9:30 AM" */
export function eventTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "9:30 – 10:15 AM", "All day" */
export function eventSpan(e: CalEvent): string {
  if (e.allDay) {
    const days = Math.round((e.end - e.start) / 86_400_000);
    return days > 1 ? `All day · ${days} days` : "All day";
  }
  return e.end > e.start ? `${eventTime(e.start)} – ${eventTime(e.end)}` : eventTime(e.start);
}
