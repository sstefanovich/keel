import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../lib/platform";

/** Minimise / maximise / close for Keel's own title bar (the tab strip). Close hides to the tray. */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri) return;
    const w = getCurrentWindow();
    void w.isMaximized().then(setMaximized);
    const un = w.onResized(() => void w.isMaximized().then(setMaximized));
    return () => {
      un.then((f) => f());
    };
  }, []);

  if (!isTauri) return null;
  const w = getCurrentWindow();
  return (
    <div className="window-controls">
      <button className="wc-btn" onClick={() => void w.minimize()} aria-label="Minimise" title="Minimise">
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5h10" />
        </svg>
      </button>
      <button className="wc-btn" onClick={() => void w.toggleMaximize()} aria-label={maximized ? "Restore" : "Maximise"} title={maximized ? "Restore" : "Maximise"}>
        {maximized ? (
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2.5 2.5V0.5h7v7h-2M0.5 2.5h7v7h-7z" />
          </svg>
        ) : (
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0.5 0.5h9v9h-9z" />
          </svg>
        )}
      </button>
      <button className="wc-btn wc-close" onClick={() => void w.close()} aria-label="Close to the tray" title="Close (Keel keeps running in the tray)">
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 0l10 10M10 0L0 10" />
        </svg>
      </button>
    </div>
  );
}
