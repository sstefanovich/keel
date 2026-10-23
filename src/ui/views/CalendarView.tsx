import { getSpace } from "../space";
import { CalendarPlus, ChevronLeft, ChevronRight, NotebookPen, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { addDays, addMonths, dateRange, endOfMonth, formatLong, parseISO, startOfMonth, startOfWeek, today } from "../../core/dates";
import { round2 } from "../../core/hold";
import { CalItem, eventDays, eventTime, refreshCalendars, useCalendarEvents, useCalendars } from "../calendars";
import { EmptyState } from "../EmptyState";
import { EventRow } from "../EventRow";
import { CalendarWeek } from "../CalendarWeek";
import { useHold } from "../HoldContext";
import { openOpts, useNav } from "../nav";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "Oct 19 – 25, 2026" / "Oct 26 – Nov 1, 2026" */
function weekTitle(first: string, last: string): string {
  const a = parseISO(first);
  const b = parseISO(last);
  const mon = (d: Date) => d.toLocaleDateString(undefined, { month: "short" });
  return `${mon(a)} ${a.getDate()} – ${a.getMonth() === b.getMonth() ? "" : `${mon(b)} `}${b.getDate()}, ${b.getFullYear()}`;
}
const SHOWN = 3;

type Mode = "month" | "week";
const MODE_KEY = "keel.calendarMode";

function loadMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "week" ? "week" : "month";
  } catch {
    return "month";
  }
}

export function CalendarView({ date, mode: initialMode }: { date?: string; mode?: Mode }) {
  const { hold } = useHold();
  const nav = useNav();
  const t = today();
  const [month, setMonth] = useState(startOfMonth(date ?? t));
  const [selected, setSelected] = useState(date ?? t);
  const [mode, setModeState] = useState<Mode>(initialMode ?? loadMode);
  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      // per-machine preference only
    }
  };
  useEffect(() => {
    if (initialMode) setModeState(initialMode);
  }, [initialMode]);
  const [now, setNow] = useState(Date.now());
  const { sources, states } = useCalendars();

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (date) {
      setMonth(startOfMonth(date));
      setSelected(date);
    }
  }, [date]);

  const weekFirst = startOfWeek(selected);
  const first = mode === "week" ? weekFirst : startOfWeek(month);
  const last = mode === "week" ? addDays(weekFirst, 6) : addDays(startOfWeek(endOfMonth(month)), 6);
  const days = dateRange(first, last);
  const work = getSpace() === "work";
  // hours and meeting notes are work things
  const ts = work ? hold.timesheet(first, last) : { byDay: new Map<string, number>() };
  const tasks = hold.tasks(getSpace()).filter((x) => x.status === "open" && x.due);
  const meetings = work ? hold.all().filter((f) => f.kind === "meeting" && f.date) : [];

  const events = useCalendarEvents(parseISO(first).getTime(), parseISO(addDays(last, 1)).getTime());
  const byDay = useMemo(() => {
    const m = new Map<string, CalItem[]>();
    for (const e of events) for (const d of eventDays(e)) m.set(d, [...(m.get(d) ?? []), e]);
    return m;
  }, [events]);

  const enabled = sources.filter((s) => s.enabled);
  const loading = enabled.some((s) => states.get(s.id)?.status === "loading");
  const failed = enabled.filter((s) => states.get(s.id)?.status === "error");

  const go = (m: string) => {
    setMonth(m);
    if (selected.slice(0, 7) !== m.slice(0, 7)) setSelected(m.slice(0, 7) === t.slice(0, 7) ? t : m);
  };

  const pick = (d: string) => {
    setSelected(d);
    if (d.slice(0, 7) !== month.slice(0, 7)) setMonth(startOfMonth(d));
  };

  const dayEvents = byDay.get(selected) ?? [];
  const dayHours = work ? hold.timesheet(selected, selected).byDay.get(selected) : undefined;
  const dayNotes = meetings.filter((m) => m.date === selected && !dayEvents.some((e) => hold.meetingNote(selected, e.title)?.path === m.path));
  const dayDue = tasks.filter((x) => x.due === selected);

  return (
    <div className="page calendar-page">
      <header className="page-head row">
        <h1>
          {mode === "week"
            ? weekTitle(first, last)
            : parseISO(month).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </h1>
        <div className="toolbar">
          <div className="seg" role="radiogroup" aria-label="Calendar view">
            {(["month", "week"] as const).map((m) => (
              <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>
                {m === "month" ? "Month" : "Week"}
              </button>
            ))}
          </div>
          {sources.length > 0 && (
            <span className="cal-sources" aria-label="Calendars">
              {enabled.map((s) => (
                <span key={s.id} className={`cal-source${states.get(s.id)?.status === "error" ? " error" : ""}`} style={{ "--cal": s.color } as React.CSSProperties} title={states.get(s.id)?.error ?? s.name}>
                  {s.name}
                </span>
              ))}
              <button className="icon-btn" onClick={() => void refreshCalendars()} disabled={loading} title="Refresh calendars" aria-label="Refresh calendars">
                <RefreshCw size={14} className={loading ? "spin" : ""} aria-hidden="true" />
              </button>
            </span>
          )}
          <button onClick={() => (mode === "week" ? pick(addDays(selected, -7)) : go(addMonths(month, -1)))} aria-label={mode === "week" ? "Previous week" : "Previous month"}>
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button onClick={() => pick(t)}>Today</button>
          <button onClick={() => (mode === "week" ? pick(addDays(selected, 7)) : go(addMonths(month, 1)))} aria-label={mode === "week" ? "Next week" : "Next month"}>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      {failed.length > 0 && (
        <p className="cal-warning" role="alert">
          <TriangleAlert size={14} aria-hidden="true" />
          {failed.map((s) => `${s.name}: ${states.get(s.id)?.error}`).join(" · ")}
          <button className="link" onClick={() => nav.go({ kind: "settings", section: "calendars" })}>
            Calendar settings
          </button>
        </p>
      )}

      <div className="cal-layout">
        {mode === "week" ? (
          <CalendarWeek
            days={days}
            byDay={byDay}
            hoursByDay={ts.byDay}
            selected={selected}
            today={t}
            now={now}
            onPick={pick}
            onOpenLog={(d, e) => nav.openLog(d, openOpts(e))}
          />
        ) : (
        <div className="calendar" role="grid" aria-label="Month">
          {WEEKDAYS.map((w) => (
            <div key={w} className="cal-head" role="columnheader">
              {w}
            </div>
          ))}
          {days.map((d) => {
            const hasLog = !!hold.get(hold.logPath(d, getSpace()));
            const hrs = ts.byDay.get(d);
            const due = tasks.filter((x) => x.due === d).length;
            const mtg = meetings.filter((m) => m.date === d).length;
            const evs = byDay.get(d) ?? [];
            const cls = ["cal-day", d.slice(0, 7) !== month.slice(0, 7) && "cal-out", d === t && "cal-today", d === selected && "cal-selected"].filter(Boolean).join(" ");
            return (
              <div
                key={d}
                className={cls}
                role="gridcell"
                tabIndex={0}
                aria-selected={d === selected}
                aria-label={`${formatLong(d)}${evs.length ? `, ${evs.length} event${evs.length === 1 ? "" : "s"}` : ""}`}
                onClick={() => pick(d)}
                onDoubleClick={(e) => nav.openLog(d, openOpts(e))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") nav.openLog(d, openOpts(e));
                  else if (e.key === " ") {
                    e.preventDefault();
                    pick(d);
                  }
                }}
                title="Click to see the day · double-click to open its log"
              >
                <span className="cal-top">
                  <span className="cal-num">{Number(d.slice(8))}</span>
                  <span className="cal-marks">
                    {hasLog && <span className="dot" title="Log" />}
                    {hrs ? <span className="cal-tag">{round2(hrs)}h</span> : null}
                    {mtg ? <span className="cal-tag">{mtg} note{mtg === 1 ? "" : "s"}</span> : null}
                    {due ? <span className="cal-tag cal-due">{due} due</span> : null}
                  </span>
                </span>
                {evs.slice(0, SHOWN).map((e) => (
                  <span key={e.id} className={`cal-event${e.allDay ? " all-day" : ""}${e.end <= now && !e.allDay ? " past" : ""}`} style={{ "--cal": e.calendar.color } as React.CSSProperties}>
                    {!e.allDay && <span className="cal-event-time">{eventTime(e.start)}</span>}
                    <span className="cal-event-title">{e.title}</span>
                  </span>
                ))}
                {evs.length > SHOWN && <span className="cal-more">+{evs.length - SHOWN} more</span>}
              </div>
            );
          })}
        </div>
        )}

        <aside className="cal-day-panel panel" aria-label={formatLong(selected)}>
          <header className="cal-day-head">
            <h2>{formatLong(selected)}</h2>
            <button onClick={(e) => nav.openLog(selected, openOpts(e))} title="Open this day's log">
              <NotebookPen size={14} aria-hidden="true" /> {selected === t ? "Today's log" : "Log"}
            </button>
          </header>
          {(dayHours || dayDue.length > 0) && (
            <p className="muted small">
              {dayHours ? `${round2(dayHours)}h logged` : ""}
              {dayHours && dayDue.length ? " · " : ""}
              {dayDue.length ? `${dayDue.length} task${dayDue.length === 1 ? "" : "s"} due` : ""}
            </p>
          )}
          {sources.length === 0 ? (
            <EmptyState compact icon={CalendarPlus} title="Connect your calendars">
              <p>Show your Outlook and Google meetings here, and start meeting notes from them.</p>
              <button className="link" onClick={() => nav.go({ kind: "settings", section: "calendars" })}>
                Add a calendar
              </button>
            </EmptyState>
          ) : dayEvents.length ? (
            <ul className="events">
              {dayEvents.map((e) => (
                <EventRow key={e.id} event={e} now={now} />
              ))}
            </ul>
          ) : (
            <p className="muted">No meetings.</p>
          )}
          {dayNotes.length > 0 && (
            <>
              <h3>Meeting notes</h3>
              <ul className="plain-list">
                {dayNotes.map((m) => (
                  <li key={m.path}>
                    <button className="link" onClick={(e) => nav.openFile(m.path, undefined, openOpts(e))}>
                      {m.title.replace(/^\d{4}-\d{2}-\d{2}\s+/, "")}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
