import { ISODate, addDays, formatShort } from "./dates";
import { Hold, round2 } from "./hold";

/** One project (or a client's general time) across a 7-day timesheet week. */
export interface WeekRow {
  client: string;
  clientName: string;
  project?: string;
  label: string;
  /** Hours per day, in week order (days[0] first) */
  hours: number[];
  /** What was done per day, in week order */
  items: string[][];
  total: number;
}

export interface Week {
  days: ISODate[];
  rows: WeekRow[];
  dayTotals: number[];
  total: number;
}

/**
 * The timesheet for a week, one row per project: daily hours plus the items done
 * each day (bullets under "- 6h @project" lines and ticked tasks tagged to it).
 */
export function buildWeek(hold: Hold, start: ISODate, client?: string): Week {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const clients = hold.clients();
  const rows = new Map<string, WeekRow>();
  const row = (c: string, p?: string): WeekRow => {
    const key = `${c}/${p ?? ""}`;
    let r = rows.get(key);
    if (!r) {
      const clientName = clients.get(c)?.name ?? c;
      r = {
        client: c,
        clientName,
        project: p,
        label: p ? hold.projectName(p) : clientName,
        hours: days.map(() => 0),
        items: days.map(() => []),
        total: 0,
      };
      rows.set(key, r);
    }
    return r;
  };
  const add = (r: WeekRow, d: number, text: string) => {
    if (text && !r.items[d].some((x) => x.toLowerCase() === text.toLowerCase())) r.items[d].push(text);
  };

  for (const e of hold.timesheet(days[0], days[6], client).entries) {
    const r = row(e.client, e.project);
    const d = days.indexOf(e.date);
    r.hours[d] += e.hours;
    e.items.forEach((i) => add(r, d, i));
  }

  // ticked tasks that belong to a project count as that day's work too
  for (const t of hold.tasks()) {
    if (t.status !== "done") continue;
    const d = days.indexOf(t.doneOn ?? hold.get(t.file)?.date ?? "");
    if (d < 0) continue;
    const target = hold.taskProject(t);
    if (!target || (client && target.client !== client)) continue;
    add(row(target.client, target.project), d, t.text.replace(/(^|\s)#[\w/-]+/g, "$1").replace(/\s{2,}/g, " ").trim());
  }

  const list = [...rows.values()]
    .map((r) => ({ ...r, total: r.hours.reduce((a, b) => a + b, 0) }))
    .sort((a, b) => a.clientName.localeCompare(b.clientName) || (a.project ? 1 : 0) - (b.project ? 1 : 0) || a.label.localeCompare(b.label));
  const dayTotals = days.map((_, d) => list.reduce((s, r) => s + r.hours[d], 0));
  return { days, rows: list, dayTotals, total: dayTotals.reduce((a, b) => a + b, 0) };
}

const fmt = (h: number) => (h ? String(round2(h)) : "");

/** Tab-separated grid for pasting into a spreadsheet or timesheet form. */
export function weekTsv(w: Week): string {
  const head = ["Project", ...w.days.map((d) => formatShort(d)), "Total"];
  const lines = w.rows.map((r) => [r.project ? `${r.label} (${r.clientName})` : r.label, ...r.hours.map(fmt), fmt(r.total)]);
  return [head, ...lines, ["Total", ...w.dayTotals.map(fmt), fmt(w.total)]].map((l) => l.join("\t")).join("\r\n");
}

/** One row's hours as tab-separated values in week order (paste across a form row). */
export function rowTsv(r: WeekRow): string {
  return r.hours.map(fmt).join("\t");
}

/** Plain-text daily report for one project: each day's hours and items. */
export function rowReport(w: Week, r: WeekRow): string {
  const parts: string[] = [];
  w.days.forEach((d, i) => {
    if (!r.items[i].length && !r.hours[i]) return;
    const head = `${formatShort(d)}${r.hours[i] ? ` (${round2(r.hours[i])}h)` : ""}`;
    parts.push([head, ...r.items[i].map((x) => `- ${x}`)].join("\n"));
  });
  return parts.join("\n\n");
}

/** Just the items for one day, one per line (for a per-day field in a form). */
export function dayItems(r: WeekRow, dayIndex: number): string {
  return r.items[dayIndex].map((x) => `- ${x}`).join("\n");
}
