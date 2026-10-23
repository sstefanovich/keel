import { ISODate, addDays, hhmm, isISODate, parseTime, toISO, weekdayOf } from "./dates";
import { DURATION_SRC } from "./parse";

/** What a capture becomes; also the chips shown under the input, in Tab order. */
export const CAPTURE_KINDS = ["log", "task", "work", "waiting", "reminder", "flag", "note", "scratch", "ask"] as const;
export type CaptureKind = (typeof CAPTURE_KINDS)[number];

export interface Capture {
  kind: CaptureKind;
  /** The kind detected from the text (kind differs when the user picked another with Tab) */
  auto: CaptureKind;
  /** Section of the day's log the line goes under ("" when it isn't a plain append) */
  heading: "Tasks" | "Log" | "";
  /** What will be written (a preview, for work entries) */
  line: string;
  /** Day it goes to, when not today ("yesterday …", "fri: …", "2026-10-20: …") */
  date?: ISODate;
  /** Hours/items for a project's block in the day's log */
  work?: { key: string; hours?: number; item?: string };
  /** Note to append to ("> Note name: text") */
  note?: string;
  /** Question for Claude ("? …") */
  ask?: string;
  /** Why this text can't be captured as the chosen kind */
  error?: string;
}

const DURATION = new RegExp(String.raw`^${DURATION_SRC}\s+`, "i");
const KEY = /^@([\w.-]+(?:\/[\w.-]+)?)(?:\s+(.*))?$/;
const TASK_START = /^(?:todo:?|task:?|t:|\[\s?\]|-\s?\[ \])\s+/i;
const FLAG_START = /^(?:flag:?|!)\s+/i;
const WAIT_START = /^wait(?:ing)?(?:\s+on)?\s+/i;
const REMIND_START = /^remind\s+me\s+/i;
const SCRATCH_START = /^(?:scratch|sp):\s*/i;
const NOTE_TARGET = /^>\s*([^:]+?)\s*:\s*(.*)$/;
const TIME_IN_TEXT = /(?:^|\s)(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2})(?=\s|$)/i;
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function hoursOf(m: RegExpMatchArray): number {
  return (m[1] ? Number(m[1]) : 0) + (m[2] ? Number(m[2]) / 60 : 0);
}

/**
 * A leading day: "yesterday …" / "today …", or with a colon "fri: …", "friday: …", "2026-10-20: …"
 * (the colon keeps a log line like "Monday's deploy failed" from being misread).
 * A weekday means the most recent one, today included.
 */
export function parseDayPrefix(text: string, today: ISODate): { date?: ISODate; rest: string } {
  const rel = text.match(/^(yesterday|today):?\s+(.+)$/i);
  if (rel) return { date: rel[1].toLowerCase() === "yesterday" ? addDays(today, -1) : undefined, rest: rel[2] };
  const iso = text.match(/^(\d{4}-\d{2}-\d{2}):\s*(.+)$/);
  if (iso && isISODate(iso[1])) return { date: iso[1] === today ? undefined : iso[1], rest: iso[2] };
  const wd = text.match(/^(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sunday|monday|tuesday|wednesday|thursday|friday|saturday):\s*(.+)$/i);
  if (wd) {
    const target = DAYS.findIndex((d) => d.startsWith(wd[1].toLowerCase().slice(0, 3)));
    const back = (weekdayOf(today) - target + 7) % 7;
    return { date: back ? addDays(today, -back) : undefined, rest: wd[2] };
  }
  return { rest: text };
}

interface Ctx {
  now: Date;
  focus?: string;
  date?: ISODate;
}

const tagFor = (focus?: string) => (s: string) =>
  focus && !new RegExp(`(^|\\s)#${focus}(\\s|/|$)`, "i").test(s) ? `${s} #${focus}` : s;

function workCapture(key: string, hours: number | undefined, item: string | undefined): Pick<Capture, "line" | "work"> {
  const k = key.toLowerCase();
  const head = `- ${hours ? `${Math.round(hours * 100) / 100}h ` : ""}@${k}`;
  return { line: item ? `${head}  ↳ ${item}` : head, work: { key: k, hours: hours || undefined, item: item || undefined } };
}

type Built = Omit<Capture, "auto" | "kind">;

/** Turn text into each kind of capture. Returns an error when the text doesn't fit that kind. */
const BUILD: Record<CaptureKind, (body: string, c: Ctx) => Built> = {
  log: (b, c) => ({ heading: "Log", line: `- ${c.date ? "" : `${hhmm(c.now)} `}${b}` }),
  task: (b, c) => ({ heading: "Tasks", line: `- [ ] ${tagFor(c.focus)(b.replace(TASK_START, ""))}` }),
  work: (b, c) => {
    const text = b.replace(/^work(?:ed)?:?\s+/i, "");
    const dur = text.match(DURATION);
    const hours = dur && (dur[1] || dur[2]) ? hoursOf(dur) : undefined;
    const rest = (hours ? text.slice(dur![0].length) : text).trim().replace(/^on\s+/i, "");
    const k = rest.match(KEY);
    if (k) return { heading: "", ...workCapture(k[1], hours, k[2]?.trim()) };
    if (c.focus) return { heading: "", ...workCapture(c.focus, hours, rest || undefined) };
    return { heading: "", line: "", error: "Add a project, e.g. 6h @project or @project what you did" };
  },
  waiting: (b, c) => {
    const body = b.replace(WAIT_START, "");
    const m = body.match(/^([^:]{1,40}?):\s*(.+)$/);
    const tag = tagFor(c.focus);
    return { heading: "Tasks", line: m ? `- [ ] ${tag(m[2].trim())} @waiting(${m[1].trim()})` : `- [ ] ${tag(body)} @waiting` };
  },
  reminder: (b, c) => {
    const r = parseReminderPhrase(b.replace(REMIND_START, ""), c.now, c.date);
    if (!r) return { heading: "Tasks", line: "", error: "Add a time, e.g. remind me 3pm call the bank" };
    return { heading: "Tasks", line: `- [ ] ${tagFor(c.focus)(r.text)} @remind(${r.spec})` };
  },
  flag: (b) => ({ heading: "", line: b.replace(FLAG_START, "") }),
  note: (b) => {
    const m = b.match(NOTE_TARGET) ?? `>${b}`.match(NOTE_TARGET);
    if (!m || !m[2].trim()) return { heading: "", line: "", error: "Use > Note name: what to add" };
    return { heading: "", line: `- ${m[2].trim()}`, note: m[1].trim() };
  },
  scratch: (b) => {
    const text = b.replace(SCRATCH_START, "").trim();
    return text ? { heading: "", line: text } : { heading: "", line: "", error: "Type something to jot on the scratchpad" };
  },
  ask: (b) => {
    const q = b.replace(/^\?\s*/, "").trim();
    return q ? { heading: "", line: q, ask: q } : { heading: "", line: "", error: "Type a question for Claude" };
  },
};

/** Which kind the text looks like. */
function detect(body: string, c: Ctx): CaptureKind {
  if (body.startsWith("?")) return "ask";
  if (body.startsWith(">")) return "note";
  if (SCRATCH_START.test(body)) return "scratch";
  if (FLAG_START.test(body)) return "flag";
  const w = body.replace(/^work(?:ed)?:?\s+/i, "");
  const dur = w.match(DURATION);
  const afterDur = dur ? w.slice(dur[0].length).trim().replace(/^on\s+/i, "") : "";
  // "6h @x …", or while focused on a client "2h fixed the bug"
  if (dur && (afterDur.startsWith("@") || c.focus)) return "work";
  // "@x did something" (a bare "@jordan" stays a log line)
  if (/^@[\w.-]+(?:\/[\w.-]+)?\s+\S/.test(body)) return "work";
  if (/^wait(?:ing)?(?:\s+on)?\s+[^:]{1,40}?:\s*\S/i.test(body)) return "waiting";
  if (REMIND_START.test(body)) return parseReminderPhrase(body.replace(REMIND_START, ""), c.now, c.date) ? "reminder" : "task";
  if (TASK_START.test(body)) return "task";
  return "log";
}

/**
 * Interpret a quick-capture line. Returns null for empty input.
 * `force` is a kind picked with Tab; otherwise the kind is detected from the text.
 * With a focused client, hours without an @client go to it and tasks get its #tag.
 */
export function parseCapture(input: string, now: Date = new Date(), focus?: string, force?: CaptureKind): Capture | null {
  const text = input.trim();
  if (!text) return null;
  const today = toISO(now);
  // "?" and "> Note:" never take a day prefix; everything else may
  const { date, rest } = /^[?>]/.test(text) ? { date: undefined, rest: text } : parseDayPrefix(text, today);
  const ctx: Ctx = { now, focus, date };
  const auto = detect(rest, ctx);
  const kind = force ?? auto;
  // a task captured via "remind me" without a time drops the "remind me"
  // the scratchpad takes the text exactly as typed ("yesterday …" included)
  const body =
    kind === "scratch" ? text : kind === "task" && REMIND_START.test(rest) ? rest.replace(REMIND_START, "").replace(/^to\s+/i, "") : rest;
  const built = BUILD[kind](body, ctx);
  const keepsDate = kind !== "flag" && kind !== "note" && kind !== "ask" && kind !== "scratch";
  return { ...built, kind, auto, date: keepsDate ? date : undefined };
}

/** "tomorrow 9am call the bank", "at 15:00 to file taxes", "call mum friday 6pm" */
export function parseReminderPhrase(phrase: string, now: Date, onDate?: ISODate): { text: string; spec: string } | null {
  let rest = ` ${phrase.trim()} `;
  const tm = rest.match(TIME_IN_TEXT);
  if (!tm) return null;
  const time = parseTime(tm[1].replace(/\s+/g, ""));
  if (!time) return null;
  rest = rest.replace(tm[0], " ");

  const today = toISO(now);
  // a day picked with a capture prefix ("fri: remind me 3pm …") unless the phrase names its own
  let date = onDate ?? today;
  const dm = rest.match(/\s(?:on\s+)?(today|tonight|tomorrow|\d{4}-\d{2}-\d{2}|sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?=\s)/i);
  if (dm) {
    const w = dm[1].toLowerCase();
    if (w === "tomorrow") date = addDays(today, 1);
    else if (isISODate(w)) date = w;
    else if (DAYS.includes(w)) {
      const diff = (DAYS.indexOf(w) - weekdayOf(today) + 7) % 7 || 7;
      date = addDays(today, diff);
    }
    rest = rest.replace(dm[0], " ");
  }

  const text = rest
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:to|that)\s+/i, "")
    .replace(/\s+(?:at|on)$/i, "");
  if (!text) return null;
  return { text, spec: date === today ? time : `${date} ${time}` };
}
