/**
 * Read-only iCalendar (RFC 5545) support for subscribed calendars (Outlook / Google ICS links).
 *
 * Covers what those two feeds actually send: VEVENTs with time zones (IANA names from Google,
 * Windows names plus a VTIMEZONE block from Outlook), all-day events, RRULE recurrence with
 * EXDATEs, moved or cancelled single instances (RECURRENCE-ID), and meeting links.
 *
 * Times are handled as "wall" milliseconds: Date.UTC() of the clock reading in the event's zone,
 * converted to real instants only at the end, so recurrences keep their local time across DST.
 */

const DAY = 86_400_000;

// ---------- lines & properties ----------

export interface IcsProp {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Undo line folding (a line starting with a space or tab continues the previous one). */
function unfold(text: string): string[] {
  const out: string[] = [];
  for (const line of text.replace(/^﻿/, "").split(/\r?\n/)) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) out[out.length - 1] += line.slice(1);
    else if (line) out.push(line);
  }
  return out;
}

/** NAME;PARAM=a;PARAM="b:c":value (colons and semicolons inside quotes don't count). */
export function parseProp(line: string): IcsProp | null {
  let quoted = false;
  let colon = -1;
  const cuts: number[] = [];
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === ";") cuts.push(i);
    else if (!quoted && c === ":") {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const parts: string[] = [];
  let from = 0;
  for (const c of cuts) {
    parts.push(head.slice(from, c));
    from = c + 1;
  }
  parts.push(head.slice(from));
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"(.*)"$/, "$1");
  }
  return { name: parts[0].toUpperCase(), params, value: line.slice(colon + 1) };
}

/** TEXT values: \n, \, \; and \\ escapes. */
export function unescapeText(v: string): string {
  return v.replace(/\\([nN,;\\])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

interface Component {
  type: string;
  props: IcsProp[];
  children: Component[];
}

function components(lines: string[]): Component[] {
  const root: Component = { type: "ROOT", props: [], children: [] };
  const stack = [root];
  for (const line of lines) {
    const p = parseProp(line);
    if (!p) continue;
    const top = stack[stack.length - 1];
    if (p.name === "BEGIN") {
      const c: Component = { type: p.value.trim().toUpperCase(), props: [], children: [] };
      top.children.push(c);
      stack.push(c);
    } else if (p.name === "END") {
      if (stack.length > 1) stack.pop();
    } else top.props.push(p);
  }
  return root.children;
}

const prop = (c: Component, name: string) => c.props.find((p) => p.name === name);
const props = (c: Component, name: string) => c.props.filter((p) => p.name === name);

// ---------- time zones ----------

/** A UTC offset written as ±HHMM or ±HHMMSS, in ms. */
export function parseOffset(s: string): number {
  const m = /^([+-])(\d{2})(\d{2})(\d{2})?$/.exec(s.trim());
  if (!m) return 0;
  const v = (Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4] ?? 0)) * 1000;
  return m[1] === "-" ? -v : v;
}

interface Observance {
  /** Wall time of the first onset */
  start: number;
  offsetTo: number;
  /** Yearly rule: the month and the nth (or -nth) weekday that the change happens on */
  rule?: { month: number; n: number; wd: number; monthDay?: number; until?: number };
  rdates: number[];
}

export interface VTimezone {
  id: string;
  observances: Observance[];
}

function parseVTimezone(c: Component): VTimezone {
  const observances: Observance[] = [];
  for (const o of c.children) {
    if (o.type !== "STANDARD" && o.type !== "DAYLIGHT") continue;
    const start = parseDateValue(prop(o, "DTSTART")?.value ?? "");
    if (!start) continue;
    const ob: Observance = { start: start.wall, offsetTo: parseOffset(prop(o, "TZOFFSETTO")?.value ?? "+0000"), rdates: [] };
    const rr = prop(o, "RRULE");
    if (rr) {
      const r = parseRRule(rr.value);
      const by = r?.byday?.[0];
      if (r && r.freq === "YEARLY") {
        ob.rule = {
          month: r.bymonth?.[0] ?? new Date(start.wall).getUTCMonth() + 1,
          n: by?.n ?? 0,
          wd: by?.wd ?? 0,
          monthDay: by ? undefined : (r.bymonthday?.[0] ?? new Date(start.wall).getUTCDate()),
          until: r.until?.wall,
        };
      }
    }
    for (const rd of props(o, "RDATE")) {
      for (const v of rd.value.split(",")) {
        const d = parseDateValue(v);
        if (d) ob.rdates.push(d.wall);
      }
    }
    observances.push(ob);
  }
  return { id: prop(c, "TZID")?.value ?? "", observances };
}

/** The onsets of an observance in a given year (wall ms). */
function onsetsIn(ob: Observance, year: number): number[] {
  const tod = ((ob.start % DAY) + DAY) % DAY;
  const out = ob.rdates.filter((w) => new Date(w).getUTCFullYear() === year);
  if (new Date(ob.start).getUTCFullYear() === year) out.push(ob.start);
  if (ob.rule && year >= new Date(ob.start).getUTCFullYear()) {
    const { month, n, wd, monthDay } = ob.rule;
    const dom = monthDay ?? nthWeekday(year, month, n, wd);
    if (dom) {
      const w = Date.UTC(year, month - 1, dom) + tod;
      if (w >= ob.start && (ob.rule.until === undefined || w <= ob.rule.until + DAY)) out.push(w);
    }
  }
  return out;
}

/** The offset in force at a wall time, from a VTIMEZONE definition. */
function vtzOffset(tz: VTimezone, wall: number): number {
  const year = new Date(wall).getUTCFullYear();
  let best: { at: number; off: number } | undefined;
  for (const ob of tz.observances) {
    for (const y of [year - 1, year]) {
      for (const at of onsetsIn(ob, y)) {
        if (at <= wall && (!best || at > best.at)) best = { at, off: ob.offsetTo };
      }
    }
  }
  if (best) return best.off;
  // before every onset: use the earliest observance's offset
  const first = [...tz.observances].sort((a, b) => a.start - b.start)[0];
  return first?.offsetTo ?? 0;
}

const ianaFormats = new Map<string, Intl.DateTimeFormat | null>();

function ianaFormat(tz: string): Intl.DateTimeFormat | null {
  if (!ianaFormats.has(tz)) {
    let f: Intl.DateTimeFormat | null = null;
    try {
      f = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
      });
    } catch {
      // not an IANA name (e.g. Outlook's "Eastern Standard Time")
    }
    ianaFormats.set(tz, f);
  }
  return ianaFormats.get(tz)!;
}

/** The zone's offset from UTC at an instant. */
function ianaOffset(f: Intl.DateTimeFormat, utc: number): number {
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(utc))) if (part.type !== "literal") p[part.type] = Number(part.value);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return wall - Math.floor(utc / 1000) * 1000;
}

/** Where an event's times are anchored. */
export type Zone = { kind: "utc" } | { kind: "floating" } | { kind: "iana"; f: Intl.DateTimeFormat } | { kind: "vtz"; tz: VTimezone };

/** Common Windows zone names (Outlook) → IANA, used when a feed omits its VTIMEZONE block. */
const WINDOWS_ZONES: Record<string, string> = {
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver",
  "US Mountain Standard Time": "America/Phoenix",
  "Pacific Standard Time": "America/Los_Angeles",
  "Alaskan Standard Time": "America/Anchorage",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "Atlantic Standard Time": "America/Halifax",
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "W. Europe Standard Time": "Europe/Berlin",
  "Romance Standard Time": "Europe/Paris",
  "Central Europe Standard Time": "Europe/Budapest",
  "Central European Standard Time": "Europe/Warsaw",
  "E. Europe Standard Time": "Europe/Chisinau",
  "FLE Standard Time": "Europe/Kiev",
  "India Standard Time": "Asia/Kolkata",
  "China Standard Time": "Asia/Shanghai",
  "Tokyo Standard Time": "Asia/Tokyo",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "New Zealand Standard Time": "Pacific/Auckland",
  UTC: "UTC",
};

export function resolveZone(tzid: string | undefined, zones: Map<string, VTimezone>): Zone {
  if (!tzid) return { kind: "floating" };
  const id = tzid.replace(/^"(.*)"$/, "$1");
  // "/mozilla.org/20050126_1/America/New_York" and similar prefixed ids
  const tail = id.replace(/^\/.*?\/(?=[A-Z][a-z]+\/)/, "");
  for (const name of [id, tail, WINDOWS_ZONES[id]]) {
    const f = name ? ianaFormat(name) : null;
    if (f) return { kind: "iana", f };
  }
  const tz = zones.get(id);
  if (tz && tz.observances.length) return { kind: "vtz", tz };
  return { kind: "floating" };
}

/** The real instant of a wall time in a zone. */
export function toInstant(wall: number, zone: Zone): number {
  switch (zone.kind) {
    case "utc":
      return wall;
    case "floating": {
      const d = new Date(wall);
      return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()).getTime();
    }
    case "vtz":
      return wall - vtzOffset(zone.tz, wall);
    case "iana": {
      const guess = wall - ianaOffset(zone.f, wall);
      return wall - ianaOffset(zone.f, guess);
    }
  }
}

/** Local midnight of an all-day date (given as wall ms). */
function localDay(wall: number): number {
  const d = new Date(wall);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()).getTime();
}

// ---------- values ----------

/** 20261023, 20261023T140000, 20261023T140000Z → wall ms (+ whether it was a date or UTC). */
export function parseDateValue(v: string): { wall: number; date: boolean; utc: boolean } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  return { wall: Date.UTC(+y, +mo - 1, +d, +(h ?? 0), +(mi ?? 0), +(s ?? 0)), date: h === undefined, utc: !!z };
}

/** P1D, PT1H30M, P2W, -PT15M → ms */
export function parseDuration(v: string): number {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return 0;
  const ms = ((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 86400 + +(m[4] ?? 0) * 3600 + +(m[5] ?? 0) * 60 + +(m[6] ?? 0)) * 1000;
  return m[1] === "-" ? -ms : ms;
}

interface When {
  wall: number;
  date: boolean;
  zone: Zone;
}

function when(p: IcsProp | undefined, zones: Map<string, VTimezone>): When | null {
  if (!p) return null;
  const v = parseDateValue(p.value);
  if (!v) return null;
  const date = v.date || p.params.VALUE === "DATE";
  return { wall: v.wall, date, zone: v.utc ? { kind: "utc" } : resolveZone(p.params.TZID, zones) };
}

// ---------- recurrence ----------

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export interface RRule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count?: number;
  until?: { wall: number; date: boolean; utc: boolean };
  byday?: { n: number; wd: number }[];
  bymonthday?: number[];
  bymonth?: number[];
  bysetpos?: number[];
  wkst: number;
}

export function parseRRule(v: string): RRule | null {
  const kv: Record<string, string> = {};
  for (const part of v.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) kv[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  const freq = kv.FREQ?.toUpperCase();
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") return null;
  const nums = (s?: string) => (s ? s.split(",").map(Number).filter((n) => Number.isFinite(n) && n !== 0) : undefined);
  const byday = kv.BYDAY?.split(",")
    .map((s) => /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(s.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ n: m[1] ? Number(m[1]) : 0, wd: WEEKDAYS.indexOf(m[2].toUpperCase()) }));
  return {
    freq,
    interval: Math.max(1, Number(kv.INTERVAL) || 1),
    count: kv.COUNT ? Number(kv.COUNT) : undefined,
    until: kv.UNTIL ? (parseDateValue(kv.UNTIL) ?? undefined) : undefined,
    byday: byday?.length ? byday : undefined,
    bymonthday: nums(kv.BYMONTHDAY),
    bymonth: nums(kv.BYMONTH),
    bysetpos: nums(kv.BYSETPOS),
    wkst: kv.WKST ? Math.max(0, WEEKDAYS.indexOf(kv.WKST.toUpperCase())) : 1,
  };
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Day of month of the nth (n<0: from the end) weekday `wd` in a month; null if it doesn't exist. */
function nthWeekday(y: number, m: number, n: number, wd: number): number | null {
  const len = daysInMonth(y, m);
  const all: number[] = [];
  for (let d = 1; d <= len; d++) if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === wd) all.push(d);
  const i = n > 0 ? n - 1 : all.length + n;
  return all[i] ?? null;
}

function setpos<T>(sorted: T[], pos?: number[]): T[] {
  if (!pos) return sorted;
  return pos.map((p) => sorted[p > 0 ? p - 1 : sorted.length + p]).filter((x) => x !== undefined);
}

/** Candidate days (day numbers) in one month. */
function monthDays(y: number, m: number, r: RRule, defaultDay: number): number[] {
  const len = daysInMonth(y, m);
  let doms: number[];
  if (r.bymonthday) {
    doms = r.bymonthday.map((n) => (n > 0 ? n : len + 1 + n)).filter((d) => d >= 1 && d <= len);
    if (r.byday) doms = doms.filter((d) => r.byday!.some((b) => b.wd === new Date(Date.UTC(y, m - 1, d)).getUTCDay()));
  } else if (r.byday) {
    doms = [];
    for (const b of r.byday) {
      if (b.n) {
        const d = nthWeekday(y, m, b.n, b.wd);
        if (d) doms.push(d);
      } else {
        for (let d = 1; d <= len; d++) if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === b.wd) doms.push(d);
      }
    }
  } else doms = defaultDay <= len ? [defaultDay] : [];
  const sorted = [...new Set(doms)].sort((a, b) => a - b);
  return setpos(sorted, r.bysetpos).map((d) => Date.UTC(y, m - 1, d) / DAY);
}

const MAX_PERIODS = 20_000;

/**
 * Wall start times of a recurring event, in order, from DTSTART until `horizon` (wall ms),
 * honouring COUNT and UNTIL. `untilOk` decides UNTIL, which may be in UTC.
 */
export function* recur(startWall: number, r: RRule, horizon: number, untilOk: (wall: number) => boolean): Generator<number> {
  const tod = ((startWall % DAY) + DAY) % DAY;
  const sd = Math.floor(startWall / DAY);
  const s = new Date(startWall);
  const y0 = s.getUTCFullYear();
  const m0 = s.getUTCMonth() + 1;
  const d0 = s.getUTCDate();
  const wd = (day: number) => new Date(day * DAY).getUTCDay();
  let emitted = 0;

  yield startWall;
  emitted++;

  for (let p = 0; p < MAX_PERIODS; p++) {
    let days: number[];
    switch (r.freq) {
      case "DAILY": {
        const day = sd + p * r.interval;
        const dt = new Date(day * DAY);
        const ok =
          (!r.bymonth || r.bymonth.includes(dt.getUTCMonth() + 1)) &&
          (!r.bymonthday || r.bymonthday.includes(dt.getUTCDate())) &&
          (!r.byday || r.byday.some((b) => b.wd === dt.getUTCDay()));
        days = ok ? [day] : [];
        break;
      }
      case "WEEKLY": {
        const weekStart = sd - ((wd(sd) - r.wkst + 7) % 7) + p * 7 * r.interval;
        const wds = r.byday ? r.byday.map((b) => b.wd) : [wd(sd)];
        days = wds.map((w) => weekStart + ((w - r.wkst + 7) % 7)).sort((a, b) => a - b);
        if (r.bymonth) days = days.filter((d) => r.bymonth!.includes(new Date(d * DAY).getUTCMonth() + 1));
        days = setpos(days, r.bysetpos);
        break;
      }
      case "MONTHLY": {
        const mi = (y0 * 12 + m0 - 1) + p * r.interval;
        const y = Math.floor(mi / 12);
        const m = (mi % 12) + 1;
        days = !r.bymonth || r.bymonth.includes(m) ? monthDays(y, m, r, d0) : [];
        break;
      }
      case "YEARLY": {
        const y = y0 + p * r.interval;
        days = (r.bymonth ?? [m0]).flatMap((m) => monthDays(y, m, { ...r, bysetpos: undefined }, d0)).sort((a, b) => a - b);
        days = setpos(days, r.bysetpos);
        break;
      }
    }
    for (const day of days) {
      const wall = day * DAY + tod;
      if (wall <= startWall) continue;
      if (wall > horizon || !untilOk(wall)) return;
      if (r.count !== undefined && emitted >= r.count) return;
      yield wall;
      emitted++;
    }
    // a period that starts past the horizon can't produce anything earlier
    if (days.length && days[0] * DAY + tod > horizon) return;
  }
}

// ---------- events ----------

interface RawEvent {
  uid: string;
  title: string;
  location?: string;
  description?: string;
  url?: string;
  joinUrl?: string;
  attendees: string[];
  organizer?: string;
  start: When;
  /** Timed: real ms; all-day: days */
  length: number;
  rrule?: RRule;
  rdates: When[];
  exdates: When[];
  recurrenceId?: When;
  cancelled: boolean;
  tentative: boolean;
  free: boolean;
}

export interface CalEvent {
  /** Unique per occurrence */
  id: string;
  uid: string;
  title: string;
  allDay: boolean;
  /** Real ms; for all-day events, local midnight of the first day */
  start: number;
  /** Exclusive */
  end: number;
  location?: string;
  description?: string;
  url?: string;
  /** Teams / Meet / Zoom / Webex link, if the event has one */
  joinUrl?: string;
  attendees: string[];
  organizer?: string;
  tentative: boolean;
  free: boolean;
  recurring: boolean;
}

export interface Calendar {
  name?: string;
  events: RawEvent[];
}

const JOIN_RE = /https:\/\/(?:teams\.microsoft\.com\/(?:l\/meetup-join|meet)|teams\.live\.com\/meet|meet\.google\.com|[\w.-]*zoom\.us\/[jw]|[\w.-]*webex\.com\/(?:meet|join|[\w.-]+\/j\.php))[^\s<>"')\]]*/i;

/** The first online-meeting link in an event's fields. */
export function findJoinUrl(...texts: (string | undefined)[]): string | undefined {
  for (const t of texts) {
    const m = t ? JOIN_RE.exec(t) : null;
    if (m) return m[0];
  }
  return undefined;
}

function person(p: IcsProp): string {
  return (p.params.CN || p.value.replace(/^mailto:/i, "")).trim();
}

function parseEvent(c: Component, zones: Map<string, VTimezone>): RawEvent | null {
  const start = when(prop(c, "DTSTART"), zones);
  if (!start) return null;
  const end = when(prop(c, "DTEND") ?? prop(c, "DUE"), zones);
  const dur = prop(c, "DURATION");
  let length: number;
  if (start.date) {
    length = end ? Math.max(1, Math.round((end.wall - start.wall) / DAY)) : dur ? Math.max(1, Math.round(parseDuration(dur.value) / DAY)) : 1;
  } else {
    length = end ? Math.max(0, toInstant(end.wall, end.zone) - toInstant(start.wall, start.zone)) : dur ? Math.max(0, parseDuration(dur.value)) : 0;
  }
  const text = (name: string) => {
    const p = prop(c, name);
    return p ? unescapeText(p.value).trim() || undefined : undefined;
  };
  const dates = (name: string) =>
    props(c, name).flatMap((p) =>
      p.value.split(",").flatMap((v) => {
        const w = when({ ...p, value: v }, zones);
        return w ? [w] : [];
      }),
    );
  const description = text("DESCRIPTION");
  const location = text("LOCATION");
  const status = prop(c, "STATUS")?.value.toUpperCase();
  const busy = prop(c, "X-MICROSOFT-CDO-BUSYSTATUS")?.value.toUpperCase();
  const rr = prop(c, "RRULE");
  return {
    uid: prop(c, "UID")?.value ?? `${start.wall}-${text("SUMMARY") ?? ""}`,
    title: text("SUMMARY") ?? "(No title)",
    location,
    description,
    url: prop(c, "URL")?.value,
    joinUrl: findJoinUrl(prop(c, "X-MICROSOFT-SKYPETEAMSMEETINGURL")?.value, prop(c, "X-GOOGLE-CONFERENCE")?.value, location, description),
    attendees: props(c, "ATTENDEE").map(person).filter(Boolean),
    organizer: prop(c, "ORGANIZER") ? person(prop(c, "ORGANIZER")!) : undefined,
    start,
    length,
    rrule: rr ? (parseRRule(rr.value) ?? undefined) : undefined,
    rdates: dates("RDATE"),
    exdates: dates("EXDATE"),
    recurrenceId: when(prop(c, "RECURRENCE-ID"), zones) ?? undefined,
    cancelled: status === "CANCELLED",
    tentative: status === "TENTATIVE" || busy === "TENTATIVE",
    free: prop(c, "TRANSP")?.value.toUpperCase() === "TRANSPARENT" || busy === "FREE",
  };
}

export function parseIcs(text: string): Calendar {
  const top = components(unfold(text));
  const cal = top.find((c) => c.type === "VCALENDAR") ?? { type: "VCALENDAR", props: [], children: top };
  const zones = new Map<string, VTimezone>();
  for (const c of cal.children) if (c.type === "VTIMEZONE") {
    const tz = parseVTimezone(c);
    zones.set(tz.id, tz);
  }
  const events: RawEvent[] = [];
  for (const c of cal.children) {
    if (c.type !== "VEVENT") continue;
    const e = parseEvent(c, zones);
    if (e) events.push(e);
  }
  const name = prop(cal, "X-WR-CALNAME")?.value;
  return { name: name ? unescapeText(name).trim() : undefined, events };
}

/** The identity of an occurrence: its real start (timed) or its date (all-day). */
function keyOf(w: When, allDay: boolean): number {
  if (allDay || w.date) return Math.floor(w.wall / DAY);
  return toInstant(w.wall, w.zone);
}

function startEnd(e: RawEvent, wall: number): { start: number; end: number } {
  if (e.start.date) {
    const start = localDay(wall);
    return { start, end: localDay(wall + e.length * DAY) };
  }
  const start = toInstant(wall, e.start.zone);
  return { start, end: start + e.length };
}

function occurrence(e: RawEvent, wall: number, recurring: boolean): CalEvent {
  const { start, end } = startEnd(e, wall);
  return {
    id: `${e.uid}@${start}`,
    uid: e.uid,
    title: e.title,
    allDay: e.start.date,
    start,
    end,
    location: e.location,
    description: e.description,
    url: e.url,
    joinUrl: e.joinUrl,
    attendees: e.attendees,
    organizer: e.organizer,
    tentative: e.tentative,
    free: e.free,
    recurring,
  };
}

/** Every occurrence overlapping [from, to) (real ms), sorted by start. */
export function expand(cal: Calendar, from: number, to: number): CalEvent[] {
  const overrides = new Map<string, RawEvent[]>();
  for (const e of cal.events) if (e.recurrenceId) overrides.set(e.uid, [...(overrides.get(e.uid) ?? []), e]);

  const out: CalEvent[] = [];
  const overlaps = (ev: CalEvent) => ev.start < to && (ev.end > from || (ev.end === ev.start && ev.start >= from));

  for (const e of cal.events) {
    if (e.recurrenceId) {
      if (!e.cancelled) {
        const ev = occurrence(e, e.start.wall, true);
        if (overlaps(ev)) out.push(ev);
      }
      continue;
    }
    if (e.cancelled) continue;
    if (!e.rrule && !e.rdates.length) {
      const ev = occurrence(e, e.start.wall, false);
      if (overlaps(ev)) out.push(ev);
      continue;
    }
    const allDay = e.start.date;
    const moved = new Set((overrides.get(e.uid) ?? []).map((o) => keyOf(o.recurrenceId!, allDay)));
    const skipped = new Set(e.exdates.map((x) => keyOf(x, allDay)));
    const skippedDays = new Set(e.exdates.filter((x) => x.date).map((x) => Math.floor(x.wall / DAY)));
    const isOut = (wall: number) => {
      const k = keyOf({ ...e.start, wall }, allDay);
      return moved.has(k) || skipped.has(k) || skippedDays.has(Math.floor(wall / DAY));
    };
    // wall and real time differ by less than a day; allow for the event's length too
    const horizon = to + 2 * DAY;
    const r = e.rrule;
    const until = r?.until;
    const untilOk = (wall: number) => {
      if (!until) return true;
      if (until.date) return Math.floor(wall / DAY) <= Math.floor(until.wall / DAY);
      if (until.utc && !allDay) return toInstant(wall, e.start.zone) <= until.wall;
      return wall <= until.wall;
    };
    const walls = r ? [...recur(e.start.wall, r, horizon, untilOk)] : [e.start.wall];
    for (const rd of e.rdates) walls.push(rd.wall);
    for (const wall of new Set(walls)) {
      if (isOut(wall)) continue;
      const ev = occurrence(e, wall, true);
      if (overlaps(ev)) out.push(ev);
    }
  }
  return out.sort((a, b) => a.start - b.start || Number(b.allDay) - Number(a.allDay) || a.title.localeCompare(b.title));
}
