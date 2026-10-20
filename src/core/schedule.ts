import { ISODate, isISODate, parseISO, parseTime, weekdayOf } from "./dates";

/**
 * A parsed @remind(...) spec. Supported forms:
 *   @remind(15:00)               — on the file's date (or every day in an undated file)
 *   @remind(2026-12-24 18:00)    — once
 *   @remind(daily 08:00)
 *   @remind(weekdays 17:30) / @remind(weekends 10:00)
 *   @remind(mon,thu 09:00)
 *   @remind(monthly 1 09:00)     — day of month
 */
export type RemindRule =
  | { kind: "once"; date: ISODate; time: string }
  | { kind: "days"; days: number[]; time: string }
  | { kind: "monthly"; day: number; time: string };

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export function parseRemind(spec: string, fileDate?: ISODate): RemindRule | null {
  const parts = spec.trim().toLowerCase().split(/\s+/);
  const timeStr = parts.pop() ?? "";
  // allow "3:30 pm" (time split over two tokens)
  let time = parseTime(timeStr);
  if (!time && (timeStr === "am" || timeStr === "pm") && parts.length) {
    time = parseTime(parts.pop()! + timeStr);
  }
  if (!time) return null;

  if (parts.length === 0) {
    return fileDate ? { kind: "once", date: fileDate, time } : { kind: "days", days: ALL_DAYS, time };
  }
  const head = parts[0];
  if (parts.length === 1 && isISODate(head)) return { kind: "once", date: head, time };
  if (parts.length === 1 && head === "daily") return { kind: "days", days: ALL_DAYS, time };
  if (parts.length === 1 && head === "weekdays") return { kind: "days", days: [1, 2, 3, 4, 5], time };
  if (parts.length === 1 && head === "weekends") return { kind: "days", days: [0, 6], time };
  if (parts.length === 2 && head === "monthly") {
    const day = Number(parts[1]);
    return day >= 1 && day <= 31 ? { kind: "monthly", day, time } : null;
  }
  const names = parts.join(",").split(",").filter(Boolean);
  const days = names.map((n) => DAY_NAMES.indexOf(n.slice(0, 3)));
  if (days.length && days.every((d) => d >= 0)) return { kind: "days", days, time };
  return null;
}

export function occursOn(rule: RemindRule, date: ISODate): boolean {
  switch (rule.kind) {
    case "once":
      return rule.date === date;
    case "days":
      return rule.days.includes(weekdayOf(date));
    case "monthly": {
      const d = parseISO(date);
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      // "monthly 31" fires on the last day of shorter months
      return d.getDate() === Math.min(rule.day, lastDay);
    }
  }
}

export function describeRule(rule: RemindRule): string {
  switch (rule.kind) {
    case "once":
      return rule.date;
    case "days":
      if (rule.days.length === 7) return "daily";
      if (rule.days.join() === "1,2,3,4,5") return "weekdays";
      if (rule.days.join() === "0,6") return "weekends";
      return rule.days.map((d) => DAY_NAMES[d]).join(", ");
    case "monthly":
      return `monthly on the ${rule.day}`;
  }
}
