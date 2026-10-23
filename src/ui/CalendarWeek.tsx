import { useEffect, useRef } from "react";
import { formatLong, parseISO, weekdayOf } from "../core/dates";
import { layoutDay } from "../core/calendarLayout";
import { round2 } from "../core/hold";
import { CalItem, eventSpan, eventTime } from "./calendars";

const HOUR_PX = 48;

/**
 * Seven day columns on an hour timeline: meetings as blocks (overlaps side by side), all-day events
 * on top, and each day's logged hours in its header. Clicking a day or an event selects that day.
 */
export function CalendarWeek({
  days,
  byDay,
  hoursByDay,
  selected,
  today,
  now,
  onPick,
  onOpenLog,
}: {
  days: string[];
  byDay: Map<string, CalItem[]>;
  hoursByDay: Map<string, number>;
  selected: string;
  today: string;
  now: number;
  onPick: (d: string) => void;
  onOpenLog: (d: string, e: React.MouseEvent) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);

  // the visible hours: at least 7am to 7pm, stretched to fit the week's meetings
  let from = 7;
  let to = 19;
  for (const d of days) {
    for (const e of byDay.get(d) ?? []) {
      if (e.allDay) continue;
      const s = new Date(Math.max(e.start, parseISO(d).getTime()));
      const en = new Date(Math.min(e.end, parseISO(d).getTime() + 86_400_000));
      from = Math.min(from, s.getHours());
      to = Math.max(to, en.getHours() + (en.getMinutes() ? 1 : 0) || 24);
    }
  }
  const hours = Array.from({ length: to - from }, (_, i) => from + i);

  // start scrolled to the working day
  useEffect(() => {
    scroller.current?.scrollTo({ top: Math.max(0, (8 - from) * HOUR_PX - 8) });
  }, [from, days[0]]); // eslint-disable-line react-hooks/exhaustive-deps

  const allDay = days.map((d) => (byDay.get(d) ?? []).filter((e) => e.allDay));
  const hasAllDay = allDay.some((l) => l.length);
  const nowDate = new Date(now);
  const nowTop = ((nowDate.getHours() - from) * 60 + nowDate.getMinutes()) * (HOUR_PX / 60);

  return (
    <div className="week-cal" role="grid" aria-label="Week">
      <div className="week-cal-head">
        <div className="week-cal-gutter" />
        {days.map((d) => {
          const h = hoursByDay.get(d);
          const weekend = [0, 6].includes(weekdayOf(d));
          return (
            <div
              key={d}
              role="columnheader"
              className={`week-cal-day-head${d === today ? " today" : ""}${d === selected ? " selected" : ""}${weekend ? " weekend" : ""}`}
              onClick={() => onPick(d)}
              onDoubleClick={(e) => onOpenLog(d, e)}
              title="Click to see the day · double-click to open its log"
            >
              <span className="week-cal-dow">{parseISO(d).toLocaleDateString(undefined, { weekday: "short" })}</span>
              <span className="week-cal-num">{Number(d.slice(8))}</span>
              {h ? <span className="cal-tag">{round2(h)}h</span> : null}
            </div>
          );
        })}
      </div>
      {hasAllDay && (
        <div className="week-cal-allday">
          <div className="week-cal-gutter muted small">all day</div>
          {allDay.map((list, i) => (
            <div key={days[i]} className="week-cal-allday-col" onClick={() => onPick(days[i])}>
              {list.map((e) => (
                <span key={e.id} className="cal-event all-day" style={{ "--cal": e.calendar.color } as React.CSSProperties} title={e.title}>
                  <span className="cal-event-title">{e.title}</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="week-cal-scroll" ref={scroller}>
        <div className="week-cal-body" style={{ height: hours.length * HOUR_PX }}>
          <div className="week-cal-gutter">
            {hours.map((h) => (
              <span key={h} className="week-cal-hour" style={{ top: (h - from) * HOUR_PX }}>
                {new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: "numeric" })}
              </span>
            ))}
          </div>
          {days.map((d) => {
            const dayStart = parseISO(d).getTime() + from * 3_600_000;
            const timed = (byDay.get(d) ?? []).filter((e) => !e.allDay);
            return (
              <div
                key={d}
                role="gridcell"
                aria-label={formatLong(d)}
                className={`week-cal-col${d === selected ? " selected" : ""}${[0, 6].includes(weekdayOf(d)) ? " weekend" : ""}`}
                onClick={() => onPick(d)}
                onDoubleClick={(e) => onOpenLog(d, e)}
              >
                {hours.map((h) => (
                  <div key={h} className="week-cal-line" style={{ top: (h - from) * HOUR_PX }} />
                ))}
                {layoutDay(timed).map(({ item: e, col, cols }) => {
                  const top = Math.max(0, (e.start - dayStart) / 3_600_000) * HOUR_PX;
                  const bottom = Math.min(hours.length * HOUR_PX, ((Math.max(e.end, e.start + 15 * 60_000) - dayStart) / 3_600_000) * HOUR_PX);
                  return (
                    <div
                      key={e.id}
                      className={`week-cal-event${e.end <= now ? " past" : ""}${e.tentative ? " tentative" : ""}${e.free ? " free" : ""}`}
                      style={{ "--cal": e.calendar.color, top, height: Math.max(18, bottom - top - 2), left: `${(col / cols) * 100}%`, width: `calc(${100 / cols}% - 3px)` } as React.CSSProperties}
                      title={`${eventSpan(e)} · ${e.title}${e.location ? `\n${e.location}` : ""}`}
                    >
                      <span className="week-cal-event-title">{e.title}</span>
                      {bottom - top > 34 && <span className="week-cal-event-time">{eventTime(e.start)}</span>}
                    </div>
                  );
                })}
                {d === today && nowTop >= 0 && nowTop <= hours.length * HOUR_PX && <div className="week-cal-now" style={{ top: nowTop }} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
