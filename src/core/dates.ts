/** Local-time date helpers. Dates are passed around as ISO strings (YYYY-MM-DD). */

export type ISODate = string;

const pad = (n: number) => String(n).padStart(2, "0");

export function toISO(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISO(iso: ISODate): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function isISODate(s: unknown): s is ISODate {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(parseISO(s).getTime());
}

export function today(): ISODate {
  return toISO(new Date());
}

export function addDays(iso: ISODate, n: number): ISODate {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(iso: ISODate): number {
  return parseISO(iso).getDay();
}

/** First day of the week containing iso. weekStart: 0 = Sunday … 6 = Saturday (default Monday). */
export function startOfWeek(iso: ISODate, weekStart = 1): ISODate {
  return addDays(iso, -((weekdayOf(iso) - weekStart + 7) % 7));
}

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function startOfMonth(iso: ISODate): ISODate {
  return iso.slice(0, 8) + "01";
}

export function endOfMonth(iso: ISODate): ISODate {
  const d = parseISO(startOfMonth(iso));
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return toISO(d);
}

export function addMonths(iso: ISODate, n: number): ISODate {
  const d = parseISO(startOfMonth(iso));
  d.setMonth(d.getMonth() + n);
  return toISO(d);
}

/** Inclusive list of dates from a to b. */
export function dateRange(a: ISODate, b: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
}

export function hhmm(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatLong(iso: ISODate): string {
  return parseISO(iso).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatShort(iso: ISODate): string {
  return parseISO(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** "3pm", "3:30 pm", "15:00", "9" → "HH:MM" (24h), or null. */
export function parseTime(s: string): string | null {
  const m = s.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    if (m[3] === "pm" && h !== 12) h += 12;
    if (m[3] === "am" && h === 12) h = 0;
  }
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

/** "15:00" → "3:00 PM" in the user's locale. */
export function formatTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
