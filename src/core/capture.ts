import { addDays, hhmm, isISODate, parseTime, toISO, weekdayOf } from "./dates";

export interface Capture {
  kind: "hours" | "task" | "reminder" | "log" | "flag";
  /** Section of today's log the line goes under ("" for a flag, which gets its own file) */
  heading: "Hours" | "Tasks" | "Log" | "";
  line: string;
}

const HOURS_START = /^(\d+(?:\.\d+)?h|\d+m|\d+h\d+m)\s+@[\w.-]+/i;
const TASK_START = /^(?:todo:?|task:?|t:|\[\s?\]|-\s?\[ \])\s+/i;
const TIME_IN_TEXT = /(?:^|\s)(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2})(?=\s|$)/i;
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Interpret a quick-capture line. Returns null for empty input. */
export function parseCapture(input: string, now: Date = new Date()): Capture | null {
  const text = input.trim();
  if (!text) return null;

  const flag = text.match(/^(?:flag:?|!)\s+(.+)$/i);
  if (flag) return { kind: "flag", heading: "", line: flag[1].trim() };

  if (HOURS_START.test(text)) return { kind: "hours", heading: "Hours", line: `- ${text}` };

  const remind = text.match(/^remind\s+me\s+(.*)$/i);
  if (remind) {
    const r = parseReminderPhrase(remind[1], now);
    if (r) return { kind: "reminder", heading: "Tasks", line: `- [ ] ${r.text} @remind(${r.spec})` };
    return { kind: "task", heading: "Tasks", line: `- [ ] ${remind[1].replace(/^to\s+/i, "")}` };
  }

  if (TASK_START.test(text)) return { kind: "task", heading: "Tasks", line: `- [ ] ${text.replace(TASK_START, "")}` };

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
