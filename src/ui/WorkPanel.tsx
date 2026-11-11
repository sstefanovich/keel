import { CalendarRange } from "lucide-react";
import { ISODate, formatShort, parseISO, startOfWeek, today, weekdayOf } from "../core/dates";
import { round2 } from "../core/hold";
import { ParsedFile } from "../core/parse";
import { buildWeek } from "../core/week";
import { useDayTarget } from "./dayTarget";
import { useHold } from "./HoldContext";
import { flushEditors } from "./editor/Editor";
import { MeetingHours } from "./MeetingHours";
import { openOpts, useNav } from "./nav";
import { useWeekStart } from "./weekStart";
import { workOptions } from "./workProjects";

const TOP_PROJECTS = 5;

/**
 * Beside a work log: the week this day falls in, the one thing the log itself can't show. Hours per day
 * against the daily target, and where the week's hours went by project. The day's own work blocks are
 * edited in the log, so they aren't repeated here. Also: meetings to turn into hours, and a project picker.
 */
export function WorkPanel({ file }: { file: ParsedFile }) {
  const { hold, bump, reportError, focus } = useHold();
  const nav = useNav();
  const weekStart = useWeekStart();
  const target = useDayTarget();
  const date = file.date!;
  const now = today();
  const start = startOfWeek(date, weekStart);
  const week = buildWeek(hold, start, focus);
  const isThisWeek = week.days.includes(now);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await flushEditors();
      await fn();
      bump();
    } catch (e) {
      reportError(e);
    }
  };

  const workday = (d: ISODate) => target.workdays.includes(weekdayOf(d));
  // non-working days only show up when something was logged on them
  const days = week.days.map((d, i) => ({ d, hours: week.dayTotals[i] })).filter((x) => workday(x.d) || x.hours > 0);
  const expected = target.hours ? week.days.filter(workday).length * target.hours : 0;
  const scale = Math.max(target.hours, ...days.map((x) => x.hours), 1);
  const projects = week.rows.filter((r) => r.total > 0).sort((a, b) => b.total - a.total);
  const shown = projects.slice(0, TOP_PROJECTS);
  const rest = projects.slice(TOP_PROJECTS).reduce((s, r) => s + r.total, 0);

  const used = new Set(file.hours.map((b) => b.client));
  const hasClients = hold.clients().size > 0;
  const allOptions = workOptions(hold, focus);
  const options = allOptions.filter((o) => !used.has(o.key));

  return (
    <section className="work-panel wk-panel">
      <header>
        <h3>{isThisWeek ? "This week" : `Week of ${formatShort(start)}`}</h3>
        <button className="link wk-total" onClick={(e) => nav.go({ kind: "timesheet" }, openOpts(e))} title="Open the timesheet">
          <b>{round2(week.total)}h</b>
          {expected > 0 && <span className="muted"> of {round2(expected)}h</span>}
        </button>
      </header>

      <ul className="wk-days" aria-label="Hours per day">
        {days.map(({ d, hours }) => {
          const future = d > now;
          const short = target.hours > 0 && workday(d) && !future && d !== now && hours < target.hours;
          const cls = ["wk-day", d === date ? "viewing" : "", d === now ? "today" : "", future ? "future" : "", short ? "short" : ""].filter(Boolean).join(" ");
          return (
            <li key={d}>
              <button
                className={cls}
                onClick={(e) => d !== date && nav.openLog(d, openOpts(e))}
                aria-current={d === date ? "date" : undefined}
                title={`${formatShort(d)}: ${round2(hours)}h${short ? ` (under ${target.hours}h)` : ""}`}
              >
                <span className="wk-day-name">{parseISO(d).toLocaleDateString(undefined, { weekday: "short" })}</span>
                <span className="wk-bar" aria-hidden="true">
                  <span className="wk-fill" style={{ width: `${(hours / scale) * 100}%` }} />
                  {target.hours > 0 && <span className="wk-target" style={{ left: `${(target.hours / scale) * 100}%` }} />}
                </span>
                <span className="wk-day-hours">{hours ? `${round2(hours)}h` : future ? "" : "–"}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {shown.length > 0 ? (
        <ul className="wk-projects" aria-label="Hours by project this week">
          {shown.map((r) => (
            <li key={`${r.client}/${r.project ?? ""}`}>
              <span className="wk-project-name" title={r.project ? `${r.label} · ${r.clientName}` : `${r.clientName} (general)`}>
                {r.label}
                {r.project && r.label !== r.clientName && <span className="muted small"> · {r.clientName}</span>}
              </span>
              <span className="wk-project-hours">{round2(r.total)}h</span>
            </li>
          ))}
          {rest > 0 && (
            <li className="muted">
              <span className="wk-project-name">
                {projects.length - TOP_PROJECTS} more
              </span>
              <span className="wk-project-hours">{round2(rest)}h</span>
            </li>
          )}
        </ul>
      ) : (
        <p className="muted small wk-empty">
          <CalendarRange size={14} aria-hidden="true" />
          {hasClients
            ? "No hours yet this week. Under Work in the log, type @ to pick a project, then add the hours: - 6h @project"
            : "Set up clients and projects in Settings, then log hours under Work: - 6h @project"}
        </p>
      )}

      <MeetingHours file={file} options={allOptions} run={run} />

      {/* own full-width row: long project names would otherwise push the panel off-screen */}
      <select
        className="work-add-project"
        value=""
        aria-label={`Add a project to ${date === now ? "today" : formatShort(date)}`}
        onChange={(e) => e.target.value && run(() => hold.logWork(date, e.target.value, {}))}
      >
        <option value="">+ Add a project to {date === now ? "today" : formatShort(date)}…</option>
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.text}
          </option>
        ))}
      </select>
    </section>
  );
}
