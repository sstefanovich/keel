import { CalendarClock, X } from "lucide-react";
import { useState } from "react";
import { addDays, parseISO, today } from "../core/dates";
import { round2 } from "../core/hold";
import { groupMeetings, meetingKey, workMeetings } from "../core/meetingHours";
import { ParsedFile } from "../core/parse";
import { CalItem, eventTime, useCalendarEvents } from "./calendars";
import { useHold } from "./HoldContext";

const LEARNED_KEY = "keel.meetingProjects";
const DISMISSED_KEY = "keel.meetingsDismissed";

function readJson<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "") ?? fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // per-machine convenience only
  }
}

/**
 * "From your calendar" in a day's Work panel: the day's meetings grouped by the project their titles
 * name, ready to add as hours and done items. Picking a project for a meeting is remembered, so the
 * next occurrence of a recurring meeting is grouped automatically.
 */
export function MeetingHours({ file, options, run }: { file: ParsedFile; options: { key: string; text: string }[]; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const { hold } = useHold();
  const date = file.date!;
  const events = useCalendarEvents(parseISO(date).getTime(), parseISO(addDays(date, 1)).getTime());
  const [learned, setLearned] = useState<Record<string, string>>(() => readJson(LEARNED_KEY, {}));
  const [dismissed, setDismissed] = useState<string[]>(() => readJson(DISMISSED_KEY, []));

  if (date > today()) return null;
  const meetings = workMeetings(events, Date.now());
  const ownerOf = (title: string) => {
    const known = learned[meetingKey(title)];
    if (known) return known;
    const g = hold.guessOwner(title);
    return g.project ?? g.client;
  };
  const { groups, unassigned } = groupMeetings<CalItem>(meetings, ownerOf, file.hours, new Set(dismissed));
  if (!groups.length && !unassigned.length) return null;

  const name = (key: string) => {
    const r = hold.resolveHours(key);
    return r.project && hold.projectByKey(r.project) ? hold.projectName(r.project) : (hold.clients().get(r.client)?.name ?? `@${key}`);
  };
  const dismiss = (ids: string[]) => {
    const next = [...dismissed, ...ids].slice(-500);
    setDismissed(next);
    writeJson(DISMISSED_KEY, next);
  };
  const learn = (title: string, key: string) => {
    const next = { ...learned, [meetingKey(title)]: key };
    setLearned(next);
    writeJson(LEARNED_KEY, next);
  };
  const current = (key: string) => file.hours.find((b) => b.client === key);

  return (
    <div className="meeting-hours">
      <h4>
        <CalendarClock size={13} aria-hidden="true" /> From your calendar
      </h4>
      {groups.map((g) => {
        const block = current(g.key);
        return (
          <div key={g.key} className="meeting-group">
            <div className="meeting-group-head">
              <span className="work-name">{name(g.key)}</span>
              <span className="muted small">{g.hours}h</span>
            </div>
            <ul className="meeting-list">
              {g.meetings.map((m) => (
                <li key={m.id}>
                  <span className="meeting-dot" style={{ background: m.calendar.color }} />
                  <span className="muted small">{eventTime(m.start)}</span> {m.title}
                </li>
              ))}
            </ul>
            <div className="meeting-actions">
              <button
                className="primary"
                onClick={() => run(() => hold.logMeetings(date, g.key, g.meetings.map((m) => m.title), g.hours))}
                title={block?.hours ? `Adds ${g.hours}h to the ${round2(block.hours)}h already logged, and lists the meetings` : "Logs the hours and lists the meetings"}
              >
                Add {g.hours}h
              </button>
              <button onClick={() => run(() => hold.logMeetings(date, g.key, g.meetings.map((m) => m.title)))} title="List the meetings without changing the hours">
                List only
              </button>
              <button className="icon-btn" onClick={() => dismiss(g.meetings.map((m) => m.id))} title="Not work: hide these" aria-label="Hide these meetings">
                <X size={13} aria-hidden="true" />
              </button>
            </div>
          </div>
        );
      })}
      {unassigned.map((m) => (
        <div key={m.id} className="meeting-group unassigned">
          <div className="meeting-group-head">
            <span className="small">
              <span className="meeting-dot" style={{ background: m.calendar.color }} />
              <span className="muted">{eventTime(m.start)}</span> {m.title}
            </span>
            <button className="icon-btn" onClick={() => dismiss([m.id])} title="Not work: hide it" aria-label="Hide this meeting">
              <X size={13} aria-hidden="true" />
            </button>
          </div>
          <select
            value=""
            aria-label={`Which project was “${m.title}” for?`}
            onChange={(e) => {
              const key = e.target.value;
              if (key) learn(m.title, key);
            }}
          >
            <option value="">Which project? (remembered for next time)</option>
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.text}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}
