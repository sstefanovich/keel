import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { confirmDialog } from "../lib/platform";
import { CALENDAR_COLORS, addCalendar, refreshCalendar, removeCalendar, updateCalendar, useCalendars } from "./calendars";
import { useHold } from "./HoldContext";

function ago(ms: number): string {
  const min = Math.round((Date.now() - ms) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h}h ago` : new Date(ms).toLocaleDateString();
}

/** Settings → Calendars: subscribe to Outlook / Google calendars by their private ICS links. */
export function CalendarSettings() {
  const { toast } = useHold();
  const { sources, states } = useCalendars();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const s = await addCalendar(url, name);
      toast(`Added “${s.name}”`);
      setUrl("");
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, label: string) => {
    if (await confirmDialog(`Remove the “${label}” calendar from Keel? Your meeting notes stay.`, "Remove")) await removeCalendar(id);
  };

  return (
    <>
      <p className="muted">
        Show your Outlook and Google meetings in the Calendar, the Agenda and today's log. Keel only reads them. Links are kept on this computer,
        not in your Hold, and Keel checks for changes every 15 minutes.
      </p>

      {sources.length > 0 && (
        <ul className="cal-settings">
          {sources.map((s) => {
            const st = states.get(s.id);
            return (
              <li key={s.id}>
                <input type="checkbox" checked={s.enabled} onChange={(e) => updateCalendar(s.id, { enabled: e.target.checked })} aria-label={`Show ${s.name}`} />
                <div className="cal-colors" role="radiogroup" aria-label={`${s.name} colour`}>
                  {CALENDAR_COLORS.map((c) => (
                    <button
                      key={c}
                      role="radio"
                      aria-checked={s.color === c}
                      aria-label={c}
                      className={`cal-swatch${s.color === c ? " on" : ""}`}
                      style={{ background: c }}
                      onClick={() => updateCalendar(s.id, { color: c })}
                    />
                  ))}
                </div>
                <input className="cal-name" defaultValue={s.name} aria-label="Calendar name" onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && updateCalendar(s.id, { name: e.target.value.trim() })} />
                <span className={`small ${st?.status === "error" ? "error-text" : "muted"}`} title={st?.error}>
                  {st?.status === "loading"
                    ? "Refreshing…"
                    : st?.status === "error"
                      ? st.error
                      : st?.fetchedAt
                        ? `${st.cal?.events.length ?? 0} events · updated ${ago(st.fetchedAt)}`
                        : ""}
                </span>
                <span className="spacer" />
                <button className="icon-btn" onClick={() => void refreshCalendar(s.id)} disabled={st?.status === "loading"} title="Refresh now" aria-label={`Refresh ${s.name}`}>
                  <RefreshCw size={14} className={st?.status === "loading" ? "spin" : ""} aria-hidden="true" />
                </button>
                <button className="icon-btn danger" onClick={() => void remove(s.id, s.name)} title="Remove" aria-label={`Remove ${s.name}`}>
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <form className="cal-add" onSubmit={add}>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a calendar's ICS link (https://… or webcal://…)"
          aria-label="Calendar ICS link"
          spellCheck={false}
          autoComplete="off"
        />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" aria-label="Calendar name" className="cal-add-name" />
        <button type="submit" className="primary" disabled={busy || !url.trim()}>
          {busy ? <RefreshCw size={14} className="spin" aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />} Add
        </button>
      </form>
      {error && (
        <p className="error-text small" role="alert">
          {error}
        </p>
      )}

      <details className="cal-help">
        <summary>Where do I find the link?</summary>
        <div>
          <h3>Outlook / Microsoft 365</h3>
          <ol>
            <li>Open Outlook on the web (outlook.office.com) → Settings (gear) → Calendar → Shared calendars.</li>
            <li>
              Under <b>Publish a calendar</b>, pick your calendar and <b>Can view all details</b> (with "Can view when I'm busy" every meeting just
              says "Busy"), then Publish.
            </li>
            <li>
              Copy the <b>ICS</b> link (not the HTML one) and paste it above.
            </li>
          </ol>
          <p className="muted small">If "Publish a calendar" is missing, your organisation has turned publishing off.</p>
          <h3>Google Calendar</h3>
          <ol>
            <li>Open calendar.google.com → Settings (gear) → Settings → pick your calendar under "Settings for my calendars".</li>
            <li>
              Under <b>Integrate calendar</b>, copy <b>Secret address in iCal format</b> and paste it above.
            </li>
          </ol>
          <p className="muted small">
            Treat these links like passwords: anyone with one can read that calendar. You can reset them in Outlook or Google at any time (then
            remove and re-add the calendar here). Google and Outlook update these feeds periodically, so a meeting booked minutes ago can take a
            while to appear.
          </p>
        </div>
      </details>
    </>
  );
}
