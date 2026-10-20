import { useEffect } from "react";
import { addDays, formatLong, today } from "../../core/dates";
import { confirmDialog } from "../../lib/platform";
import { useHold } from "../HoldContext";
import { Editor } from "../editor/Editor";
import { useNav } from "../nav";

export function FileView({ path, line }: { path: string; line?: number }) {
  const { hold, bump, reportError } = useHold();
  const nav = useNav();
  const file = hold.get(path);
  const backlinks = hold.backlinks(path);
  const isLog = file?.kind === "log" && !!file.date;

  // Alt+←/→ steps between days in a log
  useEffect(() => {
    if (!isLog) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      e.preventDefault();
      nav.openLog(addDays(file!.date!, e.key === "ArrowLeft" ? -1 : 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isLog, file, nav]);

  if (!file) {
    return (
      <div className="page">
        <p className="empty">This file no longer exists: {path}</p>
      </div>
    );
  }

  const remove = async () => {
    if (!(await confirmDialog(`Delete "${file.title}"? The file is removed from disk.`, "Delete"))) return;
    try {
      await hold.remove(path);
      bump();
      nav.go({ kind: "agenda" });
    } catch (e) {
      reportError(e);
    }
  };

  return (
    <div className="file-view">
      <header className="file-head">
        {isLog ? (
          <div className="day-nav">
            <button onClick={() => nav.openLog(addDays(file.date!, -1))} aria-label="Previous day" title="Previous day (Alt+←)">
              ‹
            </button>
            <span className="file-title">
              {formatLong(file.date!)}
              {file.date === today() && <span className="chip chip-accent">Today</span>}
            </span>
            <button onClick={() => nav.openLog(addDays(file.date!, 1))} aria-label="Next day" title="Next day (Alt+→)">
              ›
            </button>
          </div>
        ) : (
          <span className="file-title">{file.title}</span>
        )}
        <span className="file-path muted">{path}</span>
        <button className="ghost danger" onClick={remove} title="Delete file">
          Delete
        </button>
      </header>
      <div className="file-body">
        <Editor key={path} path={path} line={line} onOpenLink={nav.openLink} />
        {backlinks.length > 0 && (
          <footer className="backlinks">
            <h4>Linked from</h4>
            <ul>
              {backlinks.map((b) => (
                <li key={b.path}>
                  <button className="link" onClick={() => nav.openFile(b.path)}>
                    {b.kind === "log" && b.date ? formatLong(b.date) : b.title}
                  </button>
                </li>
              ))}
            </ul>
          </footer>
        )}
      </div>
    </div>
  );
}
