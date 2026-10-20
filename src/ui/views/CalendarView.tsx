import { useState } from "react";
import { addDays, addMonths, dateRange, endOfMonth, parseISO, startOfMonth, startOfWeek, today } from "../../core/dates";
import { round2 } from "../../core/hold";
import { useHold } from "../HoldContext";
import { useNav } from "../nav";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function CalendarView() {
  const { hold } = useHold();
  const nav = useNav();
  const t = today();
  const [month, setMonth] = useState(startOfMonth(t));

  const first = startOfWeek(month);
  const last = addDays(startOfWeek(endOfMonth(month)), 6);
  const days = dateRange(first, last);
  const ts = hold.timesheet(first, last);
  const tasks = hold.tasks().filter((x) => x.status === "open" && x.due);
  const meetings = hold.all().filter((f) => f.kind === "meeting" && f.date);

  return (
    <div className="page">
      <header className="page-head row">
        <h1>{parseISO(month).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h1>
        <div className="toolbar">
          <button onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">
            ‹
          </button>
          <button onClick={() => setMonth(startOfMonth(t))}>Today</button>
          <button onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">
            ›
          </button>
        </div>
      </header>
      <div className="calendar">
        {WEEKDAYS.map((w) => (
          <div key={w} className="cal-head">
            {w}
          </div>
        ))}
        {days.map((d) => {
          const hasLog = !!hold.get(hold.logPath(d));
          const hrs = ts.byDay.get(d);
          const due = tasks.filter((x) => x.due === d).length;
          const mtg = meetings.filter((m) => m.date === d).length;
          const cls = ["cal-day", d.slice(0, 7) !== month.slice(0, 7) && "cal-out", d === t && "cal-today"].filter(Boolean).join(" ");
          return (
            <button key={d} className={cls} onClick={() => nav.openLog(d)} title={`Open log for ${d}`}>
              <span className="cal-num">{Number(d.slice(8))}</span>
              <span className="cal-marks">
                {hasLog && <span className="dot" title="Log" />}
                {hrs ? <span className="cal-tag">{round2(hrs)}h</span> : null}
                {mtg ? <span className="cal-tag">{mtg} mtg</span> : null}
                {due ? <span className="cal-tag cal-due">{due} due</span> : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
