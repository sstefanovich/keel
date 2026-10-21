import { useEffect, useState } from "react";
import { addDays, formatLong, today } from "../../core/dates";
import { confirmDialog } from "../../lib/platform";
import { FlagBoard } from "../FlagBoard";
import { WorkPanel } from "../WorkPanel";
import { useHold } from "../HoldContext";
import { Editor } from "../editor/Editor";
import { useNav } from "../nav";
import { ChartView } from "./ChartView";

export function FileView({ path, line }: { path: string; line?: number }) {
  const { hold, bump, reportError } = useHold();
  const nav = useNav();
  const file = hold.get(path);
  const backlinks = hold.backlinks(path);
  const isLog = file?.kind === "log" && !!file.date;
  const hasChart = file?.kind === "client" || file?.kind === "project";
  // charts open on the Chart tab unless we're jumping to a specific line
  const [mode, setMode] = useState<"chart" | "edit">(hasChart && line == null ? "chart" : "edit");
  useEffect(() => setMode(hasChart && line == null ? "chart" : "edit"), [path, hasChart, line]);

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

  const backlinkList =
    backlinks.length > 0 ? (
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
    ) : null;

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
        {hasChart && (
          <div className="seg" role="tablist">
            <button role="tab" aria-selected={mode === "chart"} className={mode === "chart" ? "on" : ""} onClick={() => setMode("chart")}>
              Chart
            </button>
            <button role="tab" aria-selected={mode === "edit"} className={mode === "edit" ? "on" : ""} onClick={() => setMode("edit")}>
              Edit
            </button>
          </div>
        )}
        <span className="file-path muted">{path}</span>
        <button className="ghost danger" onClick={remove} title="Delete file">
          Delete
        </button>
      </header>
      <div className="file-body">
        {isLog && file.date === today() && <FlagBoard compact />}
        {isLog ? (
          // Work panel beside the editor (below it when narrow): it re-renders as you type
          // work lines, so it must never sit above the text and shift it under the cursor
          <div className="log-layout">
            <div className="log-main">
              <Editor key={path} path={path} line={line} onOpenLink={nav.openLink} />
              {backlinkList}
            </div>
            <aside className="log-side">
              <WorkPanel file={file} />
            </aside>
          </div>
        ) : (
          <>
            {mode === "chart" && hasChart ? <ChartView path={path} /> : <Editor key={path} path={path} line={line} onOpenLink={nav.openLink} />}
            {backlinkList}
          </>
        )}
      </div>
    </div>
  );
}
