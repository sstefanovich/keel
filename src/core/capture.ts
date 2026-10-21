import { addDays, hhmm, isISODate, parseTime, toISO, weekdayOf } from "./dates";

export interface Capture {
  kind: "hours" | "work" | "task" | "reminder" | "waiting" | "log" | "flag";
  /** Section of today's log the line goes under ("" when it isn't a plain append) */
  heading: "Tasks" | "Log" | "";
  /** What will be written (a preview, for work entries) */
  line: string;
  /** Hours/items for a project's block in today's log */
  work?: { key: string; hours?: number; item?: string };
}

const DURATION = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+)m)?\s+/i;
const KEY = /^@([\w.-]+(?:\/[\w.-]+)?)(?:\s+(.*))?$/;

function hoursOf(m: RegExpMatchArray): number {
  return (m[1] ? Number(m[1]) : 0) + (m[2] ? Number(m[2]) / 60 : 0);
}

function work(key: string, hours?: number, item?: string): Capture {
  const head = `- ${hours ? `${Math.round(hours * 100) / 100}h ` : ""}@${key.toLowerCase()}`;
  return {
    kind: hours ? "hours" : "work",
    heading: "",
    line: item ? `${head}  ↳ ${item}` : head,
    work: { key: key.toLowerCase(), hours: hours || undefined, item: item || undefined },
  };
}
const TASK_START = /^(?:todo:?|task:?|t:|\[\s?\]|-\s?\[ \])\s+/i;
const TIME_IN_TEXT = /(?:^|\s)(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2})(?=\s|$)/i;
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/**
 * Interpret a quick-capture line. Returns null for empty input.
 * With a focused client, hours without an @client go to it and tasks get its #tag.
 */
export function parseCapture(input: string, now: Date = new Date(), focus?: string): Capture | null {
  const text = input.trim();
  if (!text) return null;
  const tag = (s: string) => (focus && !new RegExp(`(^|\\s)#${focus}(\\s|/|$)`, "i").test(s) ? `${s} #${focus}` : s);

  const flag = text.match(/^(?:flag:?|!)\s+(.+)$/i);
  if (flag) return { kind: "flag", heading: "", line: flag[1].trim() };

  // "6h @portal [what]" adds hours (and an item) to today's block for that project
  const dur = text.match(DURATION);
  if (dur && (dur[1] || dur[2])) {
    const rest = text.slice(dur[0].length).trim();
    const k = rest.match(KEY);
    if (k) return work(k[1], hoursOf(dur), k[2]?.trim());
    if (focus) return work(focus, hoursOf(dur), rest);
  }
  // "@portal reviewed the PR" adds a done item to today's block for that project
  const item = text.match(KEY);
  if (item && item[2]?.trim()) return work(item[1], undefined, item[2].trim());

  const wait = text.match(/^wait(?:ing)?(?:\s+on)?\s+([^:]{1,40}?):\s*(.+)$/i);
  if (wait) return { kind: "waiting", heading: "Tasks", line: `- [ ] ${tag(wait[2].trim())} @waiting(${wait[1].trim()})` };

  const remind = text.match(/^remind\s+me\s+(.*)$/i);
  if (remind) {
    const r = parseReminderPhrase(remind[1], now);
    if (r) return { kind: "reminder", heading: "Tasks", line: `- [ ] ${tag(r.text)} @remind(${r.spec})` };
    return { kind: "task", heading: "Tasks", line: `- [ ] ${tag(remind[1].replace(/^to\s+/i, ""))}` };
  }

  if (TASK_START.test(text)) return { kind: "task", heading: "Tasks", line: `- [ ] ${tag(text.replace(TASK_START, ""))}` };

  return { kind: "log", heading: "Log", line: `- ${hhmm(now)} ${text}` };
}

/** "tomorrow 9am call the bank", "at 15:00 to file taxes", "call mum friday 6pm" */
export function parseReminderPhrase(phrase: string, now: Date): { text: string; spec: string } | null {
  let rest = ` ${phrase.trim()} `;
  const tm = rest.match(TIME_IN_TEXT);
  if (!tm) return null;
  const time = parseTime(tm[1].replace(/\s+/g, ""));
  if (!time) return null;
  rest = rest.replace(tm[0], " ");

  const today = toISO(now);
  let date = today;
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
