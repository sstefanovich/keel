import { ISODate, addDays, formatShort } from "./dates";
import { Hold, round2 } from "./hold";
import { renameMentions } from "./parse";

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
    const r = row(target.client, target.project);
    // the row already names the project: drop its @key, name any others
    const text = renameMentions(t.text, (k) => {
      const name = hold.keyName(k);
      return name && name === r.label ? "" : name;
    });
    add(r, d, text.replace(/(^|\s)#[\w/-]+/g, "$1").replace(/\s{2,}/g, " ").trim());
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

/** How copied task lists look: "- item" lines or bare lines. */
export type TaskListStyle = "bullets" | "plain";

const listLine = (x: string, style: TaskListStyle) => (style === "bullets" ? `- ${x}` : x);

/** Plain-text daily report for one project: each day's hours and items. */
export function rowReport(w: Week, r: WeekRow, style: TaskListStyle = "bullets"): string {
  const parts: string[] = [];
  w.days.forEach((d, i) => {
    if (!r.items[i].length && !r.hours[i]) return;
    const head = `${formatShort(d)}${r.hours[i] ? ` (${round2(r.hours[i])}h)` : ""}`;
    parts.push([head, ...r.items[i].map((x) => listLine(x, style))].join("\n"));
  });
  return parts.join("\n\n");
}

/** Just the items for one project on one day, one per line (for a per-day field in a form). */
export function dayItems(r: WeekRow, dayIndex: number, style: TaskListStyle = "bullets"): string {
  return r.items[dayIndex].map((x) => listLine(x, style)).join("\n");
}

/** What a timesheet week is checked against: hours expected on each working day. */
export interface DayTarget {
  /** Expected hours per working day; 0 turns the check off */
  hours: number;
  /** Working weekdays (0 = Sunday … 6 = Saturday) */
  workdays: number[];
}

export const DEFAULT_TARGET: DayTarget = { hours: 8, workdays: [1, 2, 3, 4, 5] };

export type WeekIssue =
  | { kind: "short"; day: number; hours: number; target: number }
  | { kind: "no-hours"; day: number; row: WeekRow }
  | { kind: "no-items"; day: number; row: WeekRow };

export interface WeekCheck {
  issues: WeekIssue[];
  /** Working days still ahead, today included until it reaches the target */
  daysLeft: number;
  /** Today, while it's a working day under the target: in progress, not a problem yet */
  today?: { hours: number; target: number };
  /** Nothing missing so far and no working days left: ready to enter into the timesheet system */
  ready: boolean;
}

/**
 * Gaps to fix before submitting a week: working days (up to today) under the target, projects with
 * work listed but no hours, and hours with nothing listed to report.
 */
export function checkWeek(w: Week, target: DayTarget, today: ISODate): WeekCheck {
  const issues: WeekIssue[] = [];
  let daysLeft = 0;
  let inProgress: WeekCheck["today"];
  w.days.forEach((d, i) => {
    const working = target.workdays.includes(new Date(`${d}T12:00:00`).getDay());
    if (d > today) {
      if (working) daysLeft++;
      return;
    }
    const total = round2(w.dayTotals[i]);
    // today isn't finished: under the target it's still in progress, and its gaps can wait
    if (d === today && working && target.hours > 0 && total < target.hours) {
      daysLeft++;
      inProgress = { hours: total, target: target.hours };
      return;
    }
    if (target.hours > 0 && working && total < target.hours) issues.push({ kind: "short", day: i, hours: total, target: target.hours });
    for (const r of w.rows) {
      if (r.items[i].length && !r.hours[i]) issues.push({ kind: "no-hours", day: i, row: r });
      if (r.hours[i] && !r.items[i].length) issues.push({ kind: "no-items", day: i, row: r });
    }
  });
  return { issues, daysLeft, today: inProgress, ready: !issues.length && daysLeft === 0 };
}

/** One gap in words, e.g. "6h of 8h logged" or "Portal: work listed but no hours". */
export function describeIssue(x: WeekIssue): string {
  switch (x.kind) {
    case "short":
      return x.hours ? `${fmt(x.hours)}h of ${x.target}h logged` : `no hours logged (${x.target}h expected)`;
    case "no-hours":
      return `${x.row.label}: work listed but no hours`;
    case "no-items":
      return `${x.row.label}: ${fmt(x.row.hours[x.day])}h but nothing listed to report`;
  }
}

/**
 * The week as markdown for Claude's timecard and status-report skills: the hours grid, the gaps
 * still open, and what was done per project per day. Claude enters these numbers as they are.
 */
export function weekBrief(w: Week, check: WeekCheck, clientName?: string): string {
  const out = [
    `# Week of ${formatShort(w.days[0])} – ${formatShort(w.days[6])} (${w.days[0]} to ${w.days[6]})`,
    "",
    "Written by Keel from the logs. Enter these numbers exactly as they are; don't add them up again from the logs.",
  ];
  if (clientName) out.push("", `Only ${clientName}: Keel was focused on that client.`);

  out.push("", "## Hours", "", `| Project | Client | ${w.days.join(" | ")} | Total |`, `|---|---|${w.days.map(() => "---:|").join("")}---:|`);
  for (const r of w.rows) out.push(`| ${r.project ? r.label : "(general)"} | ${r.clientName} | ${r.hours.map(fmt).join(" | ")} | ${fmt(r.total)} |`);
  out.push(`| **Total** | | ${w.dayTotals.map(fmt).join(" | ")} | ${fmt(w.total)} |`);

  out.push("", "## Gaps", "");
  if (check.issues.length) check.issues.forEach((x) => out.push(`- ${w.days[x.day]}: ${describeIssue(x)}`));
  else out.push(check.daysLeft ? `None so far; ${check.daysLeft} working day${check.daysLeft === 1 ? "" : "s"} still to come.` : "None: the week is complete.");

  out.push("", "## Work by project");
  for (const r of w.rows) {
    out.push("", `### ${r.project ? `${r.label} (${r.clientName})` : `${r.clientName} (general)`} · ${fmt(r.total) || 0}h`);
    w.days.forEach((d, i) => {
      if (!r.items[i].length && !r.hours[i]) return;
      out.push("", `**${formatShort(d)} (${d})** · ${r.hours[i] ? `${fmt(r.hours[i])}h` : "no hours"}`);
      r.items[i].forEach((x) => out.push(`- ${x}`));
    });
  }
  return out.join("\n") + "\n";
}
