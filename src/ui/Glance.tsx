import { Bell, CircleCheck, Clock, Hourglass, ListChecks } from "lucide-react";
import { formatTime, hhmm, today } from "../core/dates";
import { round2 } from "../core/hold";
import { ParsedFile } from "../core/parse";
import { useHold } from "./HoldContext";
import { openOpts, useNav } from "./nav";

/**
 * One line above a day's log: hours logged, tasks, the next reminder and waiting items.
 * Fixed height and no wrapping, so changing numbers never shift the text below.
 */
export function Glance({ file }: { file: ParsedFile }) {
  const { hold, focus } = useHold();
  const nav = useNav();
  const date = file.date!;
  const isToday = date === today();

  const hours = file.hours.reduce((s, h) => s + h.hours, 0);
  const projects = new Set(file.hours.map((h) => h.client)).size;
  const open = file.tasks.filter((t) => t.status === "open").length;
  const doneThatDay = hold.tasks().filter((t) => t.status === "done" && (t.doneOn ?? (t.file === file.path ? date : "")) === date).length;
  const agenda = isToday ? hold.agenda(date, 14, focus) : undefined;
  const overdue = agenda?.overdue.length ?? 0;
  const now = hhmm(new Date());
  const next = isToday ? hold.remindersOn(date).find((r) => r.rule.time > now) : undefined;
  const waiting = isToday ? hold.waitingOn(focus).length : 0;

  return (
    <div className="glance" aria-label="Day at a glance">
      <button className="glance-item" onClick={(e) => nav.go({ kind: "timesheet" }, openOpts(e))} title="Open the timesheet">
        <Clock size={14} aria-hidden="true" />
        <b>{hours ? `${round2(hours)}h` : "No hours"}</b>
        <span>{hours ? `on ${projects} project${projects === 1 ? "" : "s"}` : "logged yet"}</span>
      </button>
      <button className="glance-item" onClick={(e) => nav.go({ kind: "agenda" }, openOpts(e))} title="Open the agenda">
        <ListChecks size={14} aria-hidden="true" />
        <b>{open}</b>
        <span>open</span>
        {overdue > 0 && <span className="glance-alert">· {overdue} overdue</span>}
      </button>
      <span className="glance-item static" title="Tasks ticked off this day">
        <CircleCheck size={14} aria-hidden="true" />
        <b>{doneThatDay}</b>
        <span>done</span>
      </span>
      {isToday && (
        <button className="glance-item" onClick={() => next && nav.openFile(next.file, next.line)} title={next ? "Open where this reminder lives" : undefined} disabled={!next}>
          <Bell size={14} aria-hidden="true" />
          {next ? (
            <>
              <b>{formatTime(next.rule.time)}</b>
              <span className="glance-text">{next.text}</span>
            </>
          ) : (
            <span>No more reminders today</span>
          )}
        </button>
      )}
      {isToday && waiting > 0 && (
        <button className="glance-item" onClick={(e) => nav.go({ kind: "waiting" }, openOpts(e))} title="Open Waiting on">
          <Hourglass size={14} aria-hidden="true" />
          <b>{waiting}</b>
          <span>waiting</span>
        </button>
      )}
    </div>
  );
}
