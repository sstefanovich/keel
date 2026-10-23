import { useEffect, useState } from "react";
import { getAutostart, isTauri, loadSettings, notifyReminder, pickFolder, saveSettings, setAutostart } from "../../lib/platform";
import { useHold } from "../HoldContext";
import { useNav } from "../nav";
import { useTheme } from "../theme";
import { ClientsManager } from "../ClientsManager";
import { CalendarSettings } from "../CalendarSettings";
import { WEEKDAY_NAMES } from "../../core/dates";
import { setWeekStart, useWeekStart } from "../weekStart";
import { setDayTarget, useDayTarget } from "../dayTarget";
import { setHistoryEnabled, snapshotNow, useHistory } from "../history";
import { livePreviewEnabled, setLivePreview } from "../editor/livePreview";
import { setEditorWidth, useEditorWidth } from "../editorWidth";

export function SettingsView({ section }: { section?: string }) {
  const { dir, reportError, toast } = useHold();
  const nav = useNav();
  const [autostart, setAuto] = useState(false);
  const { pref, theme, setPref } = useTheme();
  const weekStart = useWeekStart();
  const target = useDayTarget();
  const history = useHistory();
  const [preview, setPreview] = useState(livePreviewEnabled);
  const width = useEditorWidth();

  useEffect(() => {
    getAutostart().then(setAuto).catch(() => {});
  }, []);

  useEffect(() => {
    if (section) document.getElementById(`settings-${section}`)?.scrollIntoView({ block: "start" });
  }, [section]);

  const changeHold = async () => {
    const picked = await pickFolder(dir);
    if (!picked || picked === dir) return;
    saveSettings({ ...loadSettings(), holdDir: picked });
    window.location.reload();
  };

  const toggleAuto = async () => {
    try {
      await setAutostart(!autostart);
      setAuto(!autostart);
    } catch (e) {
      reportError(e);
    }
  };

  return (
    <div className="page settings-page">
      <header className="page-head">
        <h1>Settings</h1>
      </header>

      <section className="panel">
        <h2>Hold</h2>
        <p className="muted">The folder where Keel keeps your markdown files.</p>
        <div className="setting-row">
          <code className="path">{dir}</code>
          <button onClick={changeHold} disabled={!isTauri}>
            Change…
          </button>
        </div>
      </section>

      <section className="panel" id="settings-history">
        <h2>File history</h2>
        <label className="setting-row check">
          <input type="checkbox" checked={history.enabled} onChange={(e) => setHistoryEnabled(e.target.checked)} disabled={!isTauri} />
          Keep a history of every file: Keel saves a snapshot of whatever changed every 10 minutes
        </label>
        <p className="muted">
          Use <b>History</b> at the top of any file to see earlier versions and restore one. Snapshots are kept in a hidden <code>.git</code> folder inside
          your Hold, only on this computer; nothing is uploaded. If your Hold is already a git repository, Keel adds its snapshots to it.
        </p>
        <div className="setting-row">
          <button onClick={async () => toast((await snapshotNow("Snapshot from Settings")) ? "Snapshot saved" : "Nothing changed since the last snapshot")} disabled={!isTauri || history.busy}>
            Save a snapshot now
          </button>
          <span className={`small ${history.error ? "error-text" : "muted"}`}>
            {history.error ?? (history.last ? `Last checked ${new Date(history.last).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : "")}
          </span>
        </div>
      </section>

      <section className="panel" id="settings-clients">
        <h2>Clients & projects</h2>
        <ClientsManager />
      </section>

      <section className="panel" id="settings-calendars">
        <h2>Calendars</h2>
        <CalendarSettings />
      </section>

      <section className="panel">
        <h2>Timesheet</h2>
        <label className="setting-row">
          Weeks start on
          <select value={weekStart} onChange={(e) => setWeekStart(Number(e.target.value))} aria-label="Timesheet week starts on">
            {WEEKDAY_NAMES.map((n, i) => (
              <option key={n} value={i}>
                {n}
              </option>
            ))}
          </select>
          <span className="muted small">
            {WEEKDAY_NAMES[weekStart]} – {WEEKDAY_NAMES[(weekStart + 6) % 7]}, used by the Timesheet and Dispatch
          </span>
        </label>
        <div className="setting-row">
          <label className="check-inline">
            Expect
            <input
              type="number"
              min="0"
              max="24"
              step="0.5"
              className="num-input"
              value={target.hours}
              onChange={(e) => setDayTarget({ ...target, hours: Math.max(0, Math.min(24, Number(e.target.value) || 0)) })}
              aria-label="Hours expected per working day"
            />
            hours on
          </label>
          <div className="seg days" role="group" aria-label="Working days">
            {WEEKDAY_NAMES.map((n, i) => {
              const on = target.workdays.includes(i);
              return (
                <button
                  key={n}
                  aria-pressed={on}
                  className={on ? "on" : ""}
                  onClick={() => setDayTarget({ ...target, workdays: on ? target.workdays.filter((d) => d !== i) : [...target.workdays, i].sort() })}
                >
                  {n.slice(0, 3)}
                </button>
              );
            })}
          </div>
          <span className="muted small">{target.hours ? "The Timesheet flags working days under this" : "Daily target check is off"}</span>
        </div>
      </section>

      <section className="panel">
        <h2>Appearance</h2>
        <div className="setting-row">
          <div className="seg" role="radiogroup" aria-label="Theme">
            {(["system", "light", "dark"] as const).map((p) => (
              <button key={p} role="radio" aria-checked={pref === p} className={pref === p ? "on" : ""} onClick={() => setPref(p)}>
                {p === "system" ? "System" : p === "light" ? "Light" : "Dark"}
              </button>
            ))}
          </div>
          {pref === "system" && <span className="muted small">Following Windows: currently {theme}</span>}
        </div>
        <div className="setting-row">
          <span>Text width</span>
          <div className="seg" role="radiogroup" aria-label="Text width">
            {(["readable", "full"] as const).map((w) => (
              <button key={w} role="radio" aria-checked={width === w} className={width === w ? "on" : ""} onClick={() => setEditorWidth(w)}>
                {w === "readable" ? "Readable" : "Full width"}
              </button>
            ))}
          </div>
          <span className="muted small">{width === "readable" ? "Lines stop at a comfortable length" : "Text uses the whole window"}</span>
        </div>
        <label className="setting-row check">
          <input
            type="checkbox"
            checked={preview}
            onChange={(e) => {
              setLivePreview(e.target.checked);
              setPreview(e.target.checked);
            }}
          />
          Live preview: hide markdown symbols (#, **, links) except on the line you're editing, and show task boxes as checkboxes
        </label>
      </section>

      <section className="panel">
        <h2>Startup & reminders</h2>
        <label className="setting-row check">
          <input type="checkbox" checked={autostart} onChange={toggleAuto} disabled={!isTauri} />
          Launch Keel when I sign in to Windows (starts in the tray so reminders keep running)
        </label>
        <p className="muted">Closing the window hides Keel to the tray. Use the tray icon's menu to quit.</p>
        <button onClick={() => notifyReminder("keel-test", "Test reminder", "Keel notifications are working")}>Send a test notification</button>
      </section>

      <section className="panel">
        <h2>Shortcuts</h2>
        <table className="table keys">
          <tbody>
            {[
              ["Ctrl+Alt+K", "Quick capture, from anywhere in Windows"],
              ["Ctrl+K", "Quick capture (inside Keel)"],
              ["Ctrl+`", "Show / hide Claude"],
              ["Ctrl+P", "Go to any note, log, project, client or view"],
              ["Ctrl+Shift+P", "Commands: log hours, copy the week, theme, focus… (or type > in Ctrl+P)"],
              ["Ctrl+B", "Collapse / expand the sidebar"],
              ["Ctrl+Shift+S", "Scratchpad"],
              ["Ctrl+click", "Open in a new tab (or middle-click)"],
              ["Ctrl+W", "Close tab"],
              ["Ctrl+Tab", "Next tab (Ctrl+Shift+Tab: previous)"],
              ["Ctrl+Shift+T", "Reopen closed tab"],
              ["Ctrl+[ / Ctrl+]", "Back / forward (or the mouse's side buttons)"],
              ["Ctrl+T", "Today's log"],
              ["Ctrl+J", "Agenda"],
              ["Ctrl+N", "New note"],
              ["Ctrl+Shift+M", "New meeting"],
              ["Ctrl+Shift+F", "Search"],
              ["Ctrl+F", "Find in the current file"],
              ["Ctrl+click", "Follow a [[link]]"],
              ["Alt+← / Alt+→", "Previous / next day (in a log)"],
            ].map(([k, d]) => (
              <tr key={k}>
                <td>
                  <kbd>{k}</kbd>
                </td>
                <td>{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="settings-links">
          <button className="link" onClick={() => nav.openLink("Welcome to Keel")}>
            Syntax guide
          </button>
          <button className="link" onClick={nav.openTour}>
            Show the tour again
          </button>
        </p>
      </section>
    </div>
  );
}
