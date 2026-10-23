import { Coffee, X } from "lucide-react";
import { useEffect, useState } from "react";
import { addDays, formatShort, parseISO } from "../core/dates";
import { ParsedFile, taskLabel } from "../core/parse";
import { CalItem, eventTime, useCalendarEvents } from "./calendars";
import { useHold } from "./HoldContext";
import { openOpts, useNav } from "./nav";

const KEY = "keel.briefingDismissed";
/** Shows the briefing again (from the command list) */
export const SHOW_BRIEFING_EVENT = "keel-show-briefing";
const WAITING_DAYS = 3;
const SHOW = 4;

function dismissedOn(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

const daysBetween = (a: string, b: string) => Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86_400_000);

/**
 * The first thing on today's log until dismissed: today's meetings, what's due or overdue, what was
 * carried over from the last log, and things waited on for a while.
 */
export function Briefing({ file }: { file: ParsedFile }) {
  const { hold, focus } = useHold();
  const nav = useNav();
  const date = file.date!;
  const [hidden, setHidden] = useState(() => dismissedOn() === date);
  const events = useCalendarEvents(parseISO(date).getTime(), parseISO(addDays(date, 1)).getTime());

  useEffect(() => {
    const show = () => setHidden(false);
    window.addEventListener(SHOW_BRIEFING_EVENT, show);
    return () => window.removeEventListener(SHOW_BRIEFING_EVENT, show);
  }, []);

  if (hidden) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(KEY, date);
    } catch {
      // shows again next time
    }
    setHidden(true);
  };

  const meetings: CalItem[] = events.filter((e) => !e.free);
  const agenda = hold.agenda(date, 14, focus);
  const due = [...agenda.overdue, ...agenda.today];
  const prevLog = hold
    .all()
    .filter((f) => f.kind === "log" && f.date && f.date < date)
    .sort((a, b) => b.date!.localeCompare(a.date!))[0];
  const carried = prevLog ? prevLog.tasks.filter((t) => t.status === "migrated").length : 0;
  const waiting = hold.waitingOn(focus).filter((t) => t.since && daysBetween(t.since, date) >= WAITING_DAYS);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const nothing = !meetings.length && !due.length && !carried && !waiting.length;

  return (
    <section className="briefing" aria-label="Today's briefing">
      <header>
        <Coffee size={15} aria-hidden="true" />
        <h3>{greeting}</h3>
        <button className="icon-btn" onClick={dismiss} title="Done for today (Ctrl+Shift+P → Show today's briefing brings it back)" aria-label="Dismiss the briefing">
          <X size={14} aria-hidden="true" />
        </button>
      </header>
      {nothing && <p className="muted small">A clear day: no meetings, nothing due, nothing carried over.</p>}

      {meetings.length > 0 && (
        <div className="briefing-part">
          <button className="briefing-label link" onClick={(e) => nav.go({ kind: "calendar", date, mode: "week" }, openOpts(e))}>
            {meetings.length} meeting{meetings.length === 1 ? "" : "s"}
          </button>
          <ul>
            {meetings.slice(0, SHOW).map((m) => (
              <li key={m.id}>
                <span className="briefing-time">{m.allDay ? "All day" : eventTime(m.start)}</span> {m.title}
              </li>
            ))}
            {meetings.length > SHOW && <li className="muted">+{meetings.length - SHOW} more</li>}
          </ul>
        </div>
      )}

      {due.length > 0 && (
        <div className="briefing-part">
          <button className="briefing-label link" onClick={(e) => nav.go({ kind: "agenda" }, openOpts(e))}>
            {agenda.overdue.length ? `${agenda.overdue.length} overdue · ` : ""}
            {agenda.today.length} due today
          </button>
          <ul>
            {due.slice(0, SHOW).map((t) => (
              <li key={t.file + t.line}>
                <button className="link" onClick={() => nav.openFile(t.file, t.line)}>
                  {taskLabel(t)}
                </button>
                {t.due && t.due < date && <span className="briefing-late"> · due {formatShort(t.due)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {carried > 0 && prevLog && (
        <div className="briefing-part">
          <span className="briefing-label">
            {carried} task{carried === 1 ? "" : "s"} carried over from {formatShort(prevLog.date!)}
          </span>
        </div>
      )}

      {waiting.length > 0 && (
        <div className="briefing-part">
          <button className="briefing-label link" onClick={(e) => nav.go({ kind: "waiting" }, openOpts(e))}>
            Waiting {WAITING_DAYS}+ days
          </button>
          <ul>
            {waiting.slice(0, SHOW).map((t) => (
              <li key={t.file + t.line}>
                <button className="link" onClick={() => nav.openFile(t.file, t.line)}>
                  {t.waiting ? <b>{t.waiting}</b> : null}
                  {t.waiting ? " · " : ""}
                  {taskLabel(t)}
                </button>
                <span className="muted"> · {daysBetween(t.since!, date)}d</span>
              </li>
            ))}
            {waiting.length > SHOW && <li className="muted">+{waiting.length - SHOW} more</li>}
          </ul>
        </div>
      )}

      <button className="small briefing-done" onClick={dismiss}>
        Got it
      </button>
    </section>
  );
}
