import { ReactNode, useState } from "react";
import { formatShort, today } from "../core/dates";
import { ParsedFile, basename } from "../core/parse";
import { useHold } from "./HoldContext";
import { View, useNav } from "./nav";

function NavItem({ active, onClick, children, badge, hint }: { active?: boolean; onClick: () => void; children: ReactNode; badge?: number; hint?: string }) {
  return (
    <button className={`nav-item${active ? " active" : ""}`} onClick={onClick} title={hint}>
      <span>{children}</span>
      {badge ? <span className="badge">{badge}</span> : null}
    </button>
  );
}

function FileGroup({ title, files, label, current, onAdd, addLabel, limit = 8 }: { title: string; files: ParsedFile[]; label: (f: ParsedFile) => string; current?: string; onAdd?: () => void; addLabel?: string; limit?: number }) {
  const nav = useNav();
  const [all, setAll] = useState(false);
  const shown = all ? files : files.slice(0, limit);
  return (
    <div className="side-group">
      <div className="side-group-head">
        <span>{title}</span>
        {onAdd && (
          <button className="icon-btn" onClick={onAdd} aria-label={addLabel ?? `New ${title.toLowerCase()}`} title={addLabel ?? `New ${title.toLowerCase()}`}>
            +
          </button>
        )}
      </div>
      {shown.map((f) => (
        <button key={f.path} className={`file-item${current === f.path ? " active" : ""}${f.kind === "project" ? " sub" : ""}`} onClick={() => nav.openFile(f.path)} title={f.path}>
          {label(f)}
        </button>
      ))}
      {files.length > limit && (
        <button className="file-item more" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${files.length}`}
        </button>
      )}
      {!files.length && <span className="file-item muted">None yet</span>}
    </div>
  );
}

const byDateDesc = (a: ParsedFile, b: ParsedFile) => (b.date ?? "").localeCompare(a.date ?? "") || b.mtime - a.mtime;

export function Sidebar() {
  const { hold } = useHold();
  const nav = useNav();
  const v: View = nav.view;
  const current = v.kind === "file" ? v.path : undefined;
  const files = hold.all();
  const t = today();
  const agenda = hold.agenda(t);
  const todayPath = hold.logPath(t);

  const logs = files.filter((f) => f.kind === "log").sort(byDateDesc);
  const meetings = files.filter((f) => f.kind === "meeting").sort(byDateDesc);
  const notes = files.filter((f) => f.kind === "note").sort((a, b) => a.title.localeCompare(b.title));
  const flagCount = hold.flags().length;
  // clients, each followed by its projects; projects without a known client at the end
  const clients = files.filter((f) => f.kind === "client").sort((a, b) => a.title.localeCompare(b.title));
  const clientKeys = new Set(clients.map((c) => basename(c.path).toLowerCase()));
  const charts = [
    ...clients.flatMap((c) => [c, ...hold.projectsOf(basename(c.path).toLowerCase())]),
    ...files.filter((f) => f.kind === "project" && !clientKeys.has(String(f.frontmatter.client ?? "").toLowerCase())),
  ];

  return (
    <aside className="sidebar">
      <div className="brand">
        <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
          <path d="M4 12h24l-4 9a6 6 0 0 1-5.5 3.6h-5A6 6 0 0 1 8 21z" fill="currentColor" />
          <path d="M16 24.5V30" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <path d="M16 3v8M16 4l7 7h-7" stroke="currentColor" strokeWidth="2" fill="none" strokeLinejoin="round" />
        </svg>
        <span>Keel</span>
      </div>

      <button className="capture-btn" onClick={nav.capture} title="Quick capture (Ctrl+K, or Ctrl+Alt+K anywhere)">
        <span>Capture…</span>
        <kbd>Ctrl K</kbd>
      </button>

      <nav className="nav">
        <NavItem active={current === todayPath} onClick={nav.openToday} hint="Ctrl+T">
          Today
        </NavItem>
        <NavItem active={v.kind === "agenda"} onClick={() => nav.go({ kind: "agenda" })} badge={agenda.overdue.length + agenda.today.length} hint="Ctrl+J">
          Agenda
        </NavItem>
        <NavItem active={v.kind === "flags"} onClick={() => nav.go({ kind: "flags" })} badge={flagCount}>
          Flags
        </NavItem>
        <NavItem active={v.kind === "charts"} onClick={() => nav.go({ kind: "charts" })}>
          Charts
        </NavItem>
        <NavItem active={v.kind === "timesheet"} onClick={() => nav.go({ kind: "timesheet" })}>
          Timesheet
        </NavItem>
        <NavItem active={v.kind === "calendar"} onClick={() => nav.go({ kind: "calendar" })}>
          Calendar
        </NavItem>
        <NavItem active={v.kind === "search"} onClick={() => nav.go({ kind: "search" })} hint="Ctrl+Shift+F">
          Search
        </NavItem>
        <NavItem active={current === "reminders.md"} onClick={() => nav.openFile("reminders.md")}>
          Reminders
        </NavItem>
      </nav>

      <div className="side-scroll">
        <FileGroup title="Meetings" files={meetings} current={current} onAdd={() => nav.newItem("meeting")} label={(f) => f.title.replace(/^\d{4}-\d{2}-\d{2}\s*/, "") || f.title} />
        <FileGroup title="Notes" files={notes} current={current} onAdd={() => nav.newItem("note")} label={(f) => (f.path.split("/").length > 2 ? `${f.path.split("/").slice(1, -1).join("/")}/` : "") + f.title} limit={12} />
        <FileGroup title="Logs" files={logs} current={current} label={(f) => (f.date ? formatShort(f.date) : f.title)} limit={5} />
        <FileGroup
          title="Charts"
          files={charts}
          current={current}
          onAdd={() => nav.newItem("client")}
          addLabel="New client"
          label={(f) => f.title}
          limit={14}
        />
      </div>

      <div className="side-foot">
        <NavItem active={v.kind === "settings"} onClick={() => nav.go({ kind: "settings" })}>
          Settings
        </NavItem>
      </div>
    </aside>
  );
}
