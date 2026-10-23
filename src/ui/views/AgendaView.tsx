import { ReactNode } from "react";
import { describeRule } from "../../core/schedule";
import { addDays, formatLong, formatShort, formatTime, hhmm, parseISO, today } from "../../core/dates";
import { useCalendarEvents, useCalendars } from "../calendars";
import { EventRow } from "../EventRow";
import { Task } from "../../core/parse";
import { FlagBoard } from "../FlagBoard";
import { BellOff, CalendarCheck, CircleCheck } from "lucide-react";
import { EmptyState } from "../EmptyState";
import { useHold } from "../HoldContext";
import { TaskRow } from "../TaskRow";
import { openOpts, useNav } from "../nav";

function Section({ title, count, tone, children }: { title: string; count: number; tone?: string; children: ReactNode }) {
  return (
    <section className={`panel${tone ? ` panel-${tone}` : ""}`}>
      <h2>
        {title} <span className="count">{count}</span>
      </h2>
      {children}
    </section>
  );
}

function groupBy<T>(items: T[], key: (t: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const i of items) m.set(key(i), [...(m.get(key(i)) ?? []), i]);
  return [...m];
}

export function AgendaView() {
  const { hold, focus } = useHold();
  const nav = useNav();
  const d = today();
  const a = hold.agenda(d, 14, focus);
  const now = hhmm(new Date());
  const { sources } = useCalendars();
  const meetings = useCalendarEvents(parseISO(d).getTime(), parseISO(addDays(d, 1)).getTime());

  return (
    <div className="page">
      <header className="page-head">
        <h1>Agenda</h1>
        <p className="muted">{formatLong(d)}</p>
      </header>

      <FlagBoard compact />

      {a.overdue.length > 0 && (
        <Section title="Overdue" count={a.overdue.length} tone="danger">
          <ul className="tasks">{a.overdue.map((t) => <TaskRow key={t.file + t.line} task={t} />)}</ul>
        </Section>
      )}

      {sources.some((s) => s.enabled) && (
        <Section title="Meetings today" count={meetings.length}>
          {meetings.length ? (
            <ul className="events">
              {meetings.map((e) => (
                <EventRow key={e.id} event={e} />
              ))}
            </ul>
          ) : (
            <EmptyState compact icon={CalendarCheck} title="No meetings today." />
          )}
        </Section>
      )}

      <div className="grid-2">
        <Section title="Today" count={a.today.length}>
          {a.today.length ? (
            <ul className="tasks">{a.today.map((t) => <TaskRow key={t.file + t.line} task={t} inToday />)}</ul>
          ) : (
            <EmptyState compact icon={CircleCheck} title="Nothing on for today.">
              <button className="link" onClick={(e) => nav.openToday(openOpts(e))}>
                Open today's log
              </button>
            </EmptyState>
          )}
        </Section>

        <Section title="Reminders" count={a.reminders.length}>
          {a.reminders.length ? (
            <ul className="reminders">
              {a.reminders.map((r) => (
                <li key={r.file + r.line} className={r.rule.time <= now ? "past" : ""}>
                  <span className="time">{formatTime(r.rule.time)}</span>
                  <button className="task-text" onClick={() => nav.openFile(r.file, r.line)}>
                    {r.text}
                  </button>
                  {r.rule.kind !== "once" && <span className="chip">{describeRule(r.rule)}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState compact icon={BellOff} title="No reminders today." />
          )}
        </Section>
      </div>

      <Section title="Upcoming · 14 days" count={a.upcoming.length}>
        {a.upcoming.length ? (
          groupBy(a.upcoming, (t: Task) => t.due!).map(([due, tasks]) => (
            <div key={due} className="group">
              <h3>{formatShort(due)}</h3>
              <ul className="tasks">{tasks.map((t) => <TaskRow key={t.file + t.line} task={t} showDue={false} />)}</ul>
            </div>
          ))
        ) : (
          <EmptyState compact icon={CircleCheck} title="Nothing due in the next two weeks." />
        )}
      </Section>

      <Section title="Open, no due date" count={a.open.length}>
        {a.open.length ? (
          groupBy(a.open, (t: Task) => t.file).map(([file, tasks]) => (
            <div key={file} className="group">
              <h3>
                <button className="link" onClick={() => nav.openFile(file)}>
                  {hold.get(file)?.title ?? file}
                </button>
              </h3>
              <ul className="tasks">{tasks.map((t) => <TaskRow key={t.file + t.line} task={t} showFile={false} />)}</ul>
            </div>
          ))
        ) : (
          <EmptyState compact icon={CircleCheck} title="All clear." />
        )}
      </Section>
    </div>
  );
}
