import { FilePlus, FileText, MapPin, Repeat, Users, Video } from "lucide-react";
import { toISO } from "../core/dates";
import { openUrl } from "../lib/platform";
import { CalItem, eventNotes, eventSpan } from "./calendars";
import { useHold } from "./HoldContext";
import { openOpts, useNav } from "./nav";

const isUrl = (s: string) => /^https?:\/\//i.test(s);

/** One calendar event: time, title, where, and buttons to join or take notes. */
export function EventRow({ event: e, now = Date.now() }: { event: CalItem; now?: number }) {
  const { hold, bump, reportError, focus } = useHold();
  const nav = useNav();
  const date = toISO(new Date(e.start));
  const note = hold.meetingNote(date, e.title);
  const past = e.end <= now && !e.allDay;
  const live = e.start <= now && now < e.end && !e.allDay;
  const where = e.location && !isUrl(e.location) && e.location !== e.joinUrl ? e.location : undefined;

  const notes = async (ev: React.MouseEvent) => {
    try {
      const path = await eventNotes(hold, e, focus);
      bump();
      nav.openFile(path, undefined, openOpts(ev));
    } catch (err) {
      reportError(err);
    }
  };

  return (
    <li className={`event${past ? " past" : ""}${live ? " live" : ""}${e.tentative ? " tentative" : ""}`} style={{ "--cal": e.calendar.color } as React.CSSProperties}>
      <span className="event-time">{eventSpan(e)}</span>
      <div className="event-main">
        <span className="event-title">
          {e.title}
          {e.recurring && <Repeat size={11} className="event-icon" aria-label="Recurring" />}
        </span>
        <span className="event-meta">
          <span className="event-cal">{e.calendar.name}</span>
          {where && (
            <span>
              <MapPin size={11} aria-hidden="true" /> {where}
            </span>
          )}
          {e.attendees.length > 0 && (
            <span title={e.attendees.join("\n")}>
              <Users size={11} aria-hidden="true" /> {e.attendees.length}
            </span>
          )}
          {e.tentative && <span>Tentative</span>}
        </span>
      </div>
      <div className="event-actions">
        {e.joinUrl && !past && (
          <button className={live ? "primary" : ""} onClick={() => void openUrl(e.joinUrl!).catch(reportError)} title={e.joinUrl}>
            <Video size={14} aria-hidden="true" /> Join
          </button>
        )}
        <button onClick={notes} title={note ? `Open “${note.title}”` : "Create a meeting note from this event"}>
          {note ? <FileText size={14} aria-hidden="true" /> : <FilePlus size={14} aria-hidden="true" />}
          {note ? "Notes" : "Start notes"}
        </button>
      </div>
    </li>
  );
}
