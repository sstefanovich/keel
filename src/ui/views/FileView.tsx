import { useEffect, useState } from "react";
import { addDays, formatLong, today } from "../../core/dates";
import { confirmDialog, isTauri } from "../../lib/platform";
import { HistoryPanel } from "../HistoryPanel";
import { OPEN_HISTORY_EVENT } from "../commands";
import { FlagBoard } from "../FlagBoard";
import { WorkPanel } from "../WorkPanel";
import { Briefing } from "../Briefing";
import { Outline } from "../Outline";
import { Glance } from "../Glance";
import { useHold } from "../HoldContext";
import { Editor, SaveStatus } from "../editor/Editor";
import { Check, FileX, History, Trash2 } from "lucide-react";
import { EmptyState } from "../EmptyState";
import { useNav } from "../nav";
import { ChartView } from "./ChartView";

export function FileView({ path, line }: { path: string; line?: number }) {
  const { hold, bump, reportError } = useHold();
  const nav = useNav();
  const file = hold.get(path);
  const backlinks = hold.backlinks(path);
  const isLog = file?.kind === "log" && !!file.date;
  const hasChart = file?.kind === "client" || file?.kind === "project";
  // notes and meetings tied to a project show it in the header
  const ownerKey = file && file.kind !== "project" ? hold.fileProject(file) : undefined;
  const ownerProject = ownerKey ? { name: hold.projectName(ownerKey), path: hold.projectByKey(ownerKey)?.path } : undefined;
  // charts open on the Chart tab unless we're jumping to a specific line
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  useEffect(() => setSaveStatus("saved"), [path]);
  const [history, setHistory] = useState(false);
  useEffect(() => setHistory(false), [path]);
  useEffect(() => {
    const open = () => setHistory(true);
    window.addEventListener(OPEN_HISTORY_EVENT, open);
    return () => window.removeEventListener(OPEN_HISTORY_EVENT, open);
  }, []);
  const [mode, setMode] = useState<"chart" | "edit">(hasChart && line == null ? "chart" : "edit");
  useEffect(() => setMode(hasChart && line == null ? "chart" : "edit"), [path, hasChart, line]);

  // Alt+←/→ steps between days in a log
  useEffect(() => {
    if (!isLog) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      if ((e.target as Element | null)?.closest?.(".claude-panel")) return; // word-jumps in the terminal
      e.preventDefault();
      nav.openLog(addDays(file!.date!, e.key === "ArrowLeft" ? -1 : 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isLog, file, nav]);

  if (!file) {
    return (
      <div className="page">
        <EmptyState icon={FileX} title="This file no longer exists" actions={<button onClick={() => nav.openToday()}>Go to today</button>}>
          <p>
            <code>{path}</code> was moved or deleted outside Keel.
          </p>
        </EmptyState>
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
      {history && <HistoryPanel path={path} onClose={() => setHistory(false)} />}
      <header className="file-head">
        {isLog ? (
          <div className="day-nav">
            <button onClick={() => nav.openLog(addDays(file.date!, -1))} aria-label="Previous day" title="Previous day (Alt+←)">
              ‹
            </button>
            <span className="file-title" title={path}>
              {formatLong(file.date!)}
              {file.date === today() && <span className="chip chip-accent">Today</span>}
            </span>
            <button onClick={() => nav.openLog(addDays(file.date!, 1))} aria-label="Next day" title="Next day (Alt+→)">
              ›
            </button>
          </div>
        ) : (
          <span className="file-title" title={path}>{file.title}</span>
        )}
        {ownerProject && (
          <button
            className="project-chip small"
            onClick={() => ownerProject.path && nav.openFile(ownerProject.path)}
            title={`Part of project ${ownerProject.name}. Set by "project:" in the frontmatter`}
          >
            ↳ {ownerProject.name}
          </button>
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
        <span className="file-path muted" title={path}>
          {path}
        </span>
        {(mode === "edit" || !hasChart) && (
          <span className={`save-status ${saveStatus}`} role="status" aria-live="polite">
            {saveStatus === "saved" ? <Check size={13} aria-hidden="true" /> : <span className="save-dot" aria-hidden="true" />}
            {saveStatus === "saved" ? "Saved" : saveStatus === "saving" ? "Saving…" : "Edited"}
          </span>
        )}
        {(mode === "edit" || !hasChart) && <Outline content={file.content} onJump={(l) => nav.openFile(path, l)} />}
        {isTauri && (
          <button className="ghost icon-text" onClick={() => setHistory(true)} title="Earlier versions of this file">
            <History size={14} aria-hidden="true" />
            History
          </button>
        )}
        <button className="ghost danger icon-text" onClick={remove} title="Delete file">
          <Trash2 size={14} aria-hidden="true" />
          Delete
        </button>
      </header>
      <div className="file-body">
        {isLog ? (
          // Work panel beside the editor (below it when narrow): it re-renders as you type
          // work lines, so it must never sit above the text and shift it under the cursor
          <div className="log-layout">
            <div className="log-main">
              <Glance file={file} />
              {file.date === today() && <FlagBoard compact />}
              <Editor key={path} path={path} line={line} isLog onOpenLink={(t, newTab) => nav.openLink(t, { newTab })} onStatus={setSaveStatus} />
              {backlinkList}
            </div>
            <aside className="log-side">
              {file.date === today() && <Briefing file={file} />}
              <WorkPanel file={file} />
            </aside>
          </div>
        ) : (
          <>
            {mode === "chart" && hasChart ? (
              <ChartView path={path} />
            ) : (
              <Editor key={path} path={path} line={line} onOpenLink={(t, newTab) => nav.openLink(t, { newTab })} onStatus={setSaveStatus} />
            )}
            {backlinkList}
          </>
        )}
      </div>
    </div>
  );
}
