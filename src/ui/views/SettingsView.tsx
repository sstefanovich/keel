import { useEffect, useState } from "react";
import { getAutostart, isTauri, loadSettings, notify, pickFolder, saveSettings, setAutostart } from "../../lib/platform";
import { useHold } from "../HoldContext";
import { useNav } from "../nav";
import { useTheme } from "../theme";
import { ClientsManager } from "../ClientsManager";

export function SettingsView({ section }: { section?: string }) {
  const { dir, reportError } = useHold();
  const nav = useNav();
  const [autostart, setAuto] = useState(false);
  const { pref, theme, setPref } = useTheme();

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

      <section className="panel" id="settings-clients">
        <h2>Clients & projects</h2>
        <ClientsManager />
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
      </section>

      <section className="panel">
        <h2>Startup & reminders</h2>
        <label className="setting-row check">
          <input type="checkbox" checked={autostart} onChange={toggleAuto} disabled={!isTauri} />
          Launch Keel when I sign in to Windows (starts in the tray so reminders keep running)
        </label>
        <p className="muted">Closing the window hides Keel to the tray. Use the tray icon's menu to quit.</p>
        <button onClick={() => notify("Test reminder", "Keel notifications are working")}>Send a test notification</button>
      </section>

      <section className="panel">
        <h2>Shortcuts</h2>
        <table className="table keys">
          <tbody>
            {[
              ["Ctrl+Alt+K", "Quick capture, from anywhere in Windows"],
              ["Ctrl+K", "Quick capture (inside Keel)"],
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
        <p>
          <button className="link" onClick={() => nav.openLink("Welcome to Keel")}>
            Syntax guide
          </button>
        </p>
      </section>
    </div>
  );
}
