import { BriefcaseBusiness, Check, ChevronDown, FilePlus, FileText, MapPin, Repeat, Users, Video } from "lucide-react";
import { useState } from "react";
import { toISO, today } from "../core/dates";
import { isLogged, quarterHours } from "../core/meetingHours";
import { openUrl } from "../lib/platform";
import { CalItem, eventNotes, eventSpan } from "./calendars";
import { flushEditors } from "./editor/Editor";
import { useHold } from "./HoldContext";
import { openOpts, useNav } from "./nav";
import { learnProject, meetingOwner, ownerName, workOptions } from "./workProjects";

const isUrl = (s: string) => /^https?:\/\//i.test(s);

/**
 * "Add to Work": lists the meeting (and its time, for a timed one) under its project in today's
 * log, adding the project there if it isn't yet. Asks which project when the title doesn't say.
 */
function AddToWork({ event: e }: { event: CalItem }) {
  const { hold, bump, reportError, focus } = useHold();
  const [picking, setPicking] = useState(false);
  const day = today();
  const blocks = hold.get(hold.logPath(day))?.hours ?? [];
  const owner = meetingOwner(hold, e.title);
  const hours = e.allDay || e.free || e.end <= e.start ? undefined : quarterHours(e.end - e.start);
  const what = hours ? `${hours}h and “${e.title}”` : `“${e.title}”`;

  const add = async (key: string) => {
    setPicking(false);
    try {
      learnProject(e.title, key);
      await flushEditors();
      await hold.logMeetings(day, key, [e.title], hours);
      bump();
    } catch (err) {
      reportError(err);
    }
  };

  if (isLogged(e, blocks)) {
    return (
      <span className="event-in-work muted small" title="Listed under Work in today's log">
        <Check size={13} aria-hidden="true" /> In today's Work
      </span>
    );
  }

  const picker = picking && (
    <select
      className="event-work-pick"
      autoFocus
      value=""
      aria-label={`Which project was “${e.title}” for?`}
      onChange={(ev) => ev.target.value && void add(ev.target.value)}
      onBlur={() => setPicking(false)}
      onKeyDown={(ev) => ev.key === "Escape" && setPicking(false)}
    >
      <option value="">Which project? (remembered for next time)</option>
      {workOptions(hold, focus).map((o) => (
        <option key={o.key} value={o.key}>
          {o.text}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <span className="event-work">
        <button
          onClick={() => (owner ? void add(owner) : setPicking((p) => !p))}
          title={owner ? `Add ${what} to ${ownerName(hold, owner)} in today's Work` : `Add ${what} to today's Work: pick the project`}
        >
          <BriefcaseBusiness size={14} aria-hidden="true" /> Add to Work
        </button>
        {owner && (
          <button className="icon-btn" onClick={() => setPicking((p) => !p)} title="Add it to a different project" aria-label="Pick a different project" aria-expanded={picking}>
            <ChevronDown size={13} aria-hidden="true" />
          </button>
        )}
      </span>
      {picker}
    </>
  );
}

/** One calendar event: time, title, where, and buttons to join, take notes, or (with `addToWork`) log it. */
export function EventRow({ event: e, now = Date.now(), addToWork = false }: { event: CalItem; now?: number; addToWork?: boolean }) {
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
        {addToWork && <AddToWork event={e} />}
      </div>
    </li>
  );
}
