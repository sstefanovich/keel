import { ISODate, addDays, formatShort, parseISO, today } from "./dates";
import { Client, ClientTotal, Hold, round2 } from "./hold";
import { ParsedFile, Task, renameMentions, taskLabel } from "./parse";

/** A client status update ("Dispatch") for a date range, built from the hold. */
export interface StatusReport {
  client: Client;
  from: ISODate;
  to: ISODate;
  /** "Today" for counting how long items have waited */
  asOf: ISODate;
  hours?: ClientTotal;
  completed: Task[];
  meetings: ParsedFile[];
  inProgress: Task[];
  waiting: Task[];
  upcoming: Task[];
}

export function buildReport(hold: Hold, clientKey: string, from: ISODate, to: ISODate, asOf: ISODate = today()): StatusReport {
  const client = hold.clients().get(clientKey) ?? { key: clientKey, name: clientKey };
  // "Kickoff deck @portal-rebuild" reads as "Kickoff deck (Portal Rebuild)" in what goes to the client
  const named = (t: Task): Task => {
    const names: string[] = [];
    const text = renameMentions(t.text, (k) => {
      const name = hold.keyName(k);
      if (name && name !== client.name && !names.includes(name)) names.push(name);
      return name && "";
    });
    return { ...t, text: names.length ? `${text} (${names.join(", ")})` : text };
  };
  const mine = hold.tasks().filter((t) => hold.taskClient(t) === clientKey).map(named);
  const fileDate = (t: Task) => hold.get(t.file)?.date;
  const inRange = (d?: ISODate) => !!d && d >= from && d <= to;
  const horizon = addDays(to, 14);
  const byDue = (a: Task, b: Task) => (a.due ?? "").localeCompare(b.due ?? "");
  return {
    client,
    from,
    to,
    asOf,
    hours: hold.timesheet(from, to, clientKey).byClient[0],
    completed: mine.filter((t) => t.status === "done" && inRange(t.doneOn ?? fileDate(t))),
    meetings: hold
      .all()
      .filter((f) => f.kind === "meeting" && hold.fileClient(f) === clientKey && inRange(f.date))
      .sort((a, b) => a.date!.localeCompare(b.date!)),
    inProgress: mine.filter((t) => t.status === "open" && t.waiting === undefined && !(t.due && t.due <= horizon)),
    waiting: hold.waitingOn(clientKey).map(named),
    upcoming: mine.filter((t) => t.status === "open" && t.waiting === undefined && t.due && t.due <= horizon).sort(byDue),
  };
}

/** Task text for the report: no #tags (they only file it) and no @Name of who it waits on. */
function clean(t: Task, _r: StatusReport): string {
  return taskLabel(t);
}

function daysSince(d: ISODate | undefined, to: ISODate): number {
  if (!d) return 0;
  return Math.max(0, Math.round((parseISO(to).getTime() - parseISO(d).getTime()) / 86_400_000));
}

const waitingText = (t: Task) => taskLabel(t);

interface Section {
  title: string;
  items: { strong?: string; text: string }[];
}

function sections(r: StatusReport, opts: { includeHours: boolean }): Section[] {
  const out: Section[] = [];
  if (opts.includeHours && r.hours) {
    out.push({
      title: "Time",
      items: [
        ...r.hours.byProject.map((p) => ({ text: `${p.name || "General"}: ${round2(p.hours)}h` })),
        { strong: `Total: ${round2(r.hours.hours)}h`, text: "" },
      ],
    });
  }
  out.push({ title: "Completed", items: r.completed.map((t) => ({ text: clean(t, r) })) });
  if (r.meetings.length) out.push({ title: "Meetings", items: r.meetings.map((m) => ({ text: `${formatShort(m.date!)}: ${m.title.replace(/^\d{4}-\d{2}-\d{2}\s*/, "")}` })) });
  out.push({ title: "In progress", items: r.inProgress.map((t) => ({ text: clean(t, r) })) });
  out.push({
    title: "Waiting on",
    items: r.waiting.map((t) => {
      // count to today, not to the end of a week that hasn't finished yet
      const days = daysSince(t.since, r.to < r.asOf ? r.to : r.asOf);
      return { strong: t.waiting || "Someone", text: `${clean({ ...t, text: waitingText(t) }, r)} (${days} day${days === 1 ? "" : "s"})` };
    }),
  });
  out.push({ title: "Coming up", items: r.upcoming.map((t) => ({ text: `${formatShort(t.due!)}: ${clean(t, r)}` })) });
  return out;
}

export function reportTitle(r: StatusReport): string {
  return `${r.client.name}: status update`;
}

export function reportRange(r: StatusReport): string {
  return `${formatShort(r.from)} – ${formatShort(r.to)}, ${r.to.slice(0, 4)}`;
}

export function reportMarkdown(r: StatusReport, opts = { includeHours: true }): string {
  const lines = [`# ${reportTitle(r)}`, reportRange(r), "", "## Summary", "_Add a sentence or two on overall status._", ""];
  for (const s of sections(r, opts)) {
    lines.push(`## ${s.title}`);
    if (!s.items.length) lines.push("- None");
    for (const i of s.items) lines.push(`- ${i.strong ? `**${i.strong}**${i.text ? ": " : ""}` : ""}${i.text}`);
    lines.push("");
  }
  return lines.join("\n");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Simple HTML for pasting into Outlook or Teams. */
export function reportHtml(r: StatusReport, opts = { includeHours: true }): string {
  const parts = [`<h2>${esc(reportTitle(r))}</h2>`, `<p>${esc(reportRange(r))}</p>`];
  for (const s of sections(r, opts)) {
    parts.push(`<h3>${esc(s.title)}</h3>`);
    if (!s.items.length) parts.push("<p><i>None</i></p>");
    else
      parts.push(
        `<ul>${s.items.map((i) => `<li>${i.strong ? `<b>${esc(i.strong)}</b>${i.text ? ": " : ""}` : ""}${esc(i.text)}</li>`).join("")}</ul>`,
      );
  }
  return parts.join("\n");
}
