import { ReactNode, useState } from "react";
import { today } from "../core/dates";
import { ParsedFile, basename } from "../core/parse";
import { useHold } from "./HoldContext";
import { View, useNav } from "./nav";
import { ThemePref, useTheme } from "./theme";
import { LogTree } from "./LogTree";
import { ClaudeIcon } from "./ClaudePanel";

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

/** Focus-picker entry that opens Settings → Clients & projects instead of focusing. */
const MANAGE = "__manage";

const NEXT_PREF: Record<ThemePref, ThemePref> = { system: "light", light: "dark", dark: "system" };
const PREF_LABEL: Record<ThemePref, string> = { system: "System theme", light: "Light theme", dark: "Dark theme" };

/** Cycles System → Light → Dark. */
function ThemeToggle() {
  const { pref, setPref } = useTheme();
  return (
    <button
      className="theme-toggle"
      onClick={() => setPref(NEXT_PREF[pref])}
      title={`${PREF_LABEL[pref]}: click for ${PREF_LABEL[NEXT_PREF[pref]].toLowerCase()}`}
      aria-label={`${PREF_LABEL[pref]}. Switch to ${PREF_LABEL[NEXT_PREF[pref]].toLowerCase()}`}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {pref === "light" && (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        )}
        {pref === "dark" && <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />}
        {pref === "system" && (
          <>
            <rect x="3" y="4" width="18" height="12" rx="2" />
            <path d="M8 20h8M12 16v4" />
          </>
        )}
      </svg>
      <span>{pref === "system" ? "System" : pref === "light" ? "Light" : "Dark"}</span>
    </button>
  );
}

const byDateDesc =(a: ParsedFile, b: ParsedFile) => (b.date ?? "").localeCompare(a.date ?? "") || b.mtime - a.mtime;

export function Sidebar() {
  const { hold, focus, setFocus } = useHold();
  const nav = useNav();
  const v: View = nav.view;
  const current = v.kind === "file" ? v.path : undefined;
  const files = hold.all();
  const t = today();
  const todayPath = hold.logPath(t);

  const mine = (f: ParsedFile) => !focus || hold.fileClient(f) === focus;
  const logs = files.filter((f) => f.kind === "log").sort(byDateDesc);
  const meetings = files.filter((f) => f.kind === "meeting" && mine(f)).sort(byDateDesc);
  const notes = files.filter((f) => f.kind === "note" && (!focus || !hold.fileClient(f) || mine(f))).sort((a, b) => a.title.localeCompare(b.title));
  const flagCount = hold.flags(focus).length;
  const waitingCount = hold.waitingOn(focus).length;
  const agenda = hold.agenda(t, 14, focus);
  // clients, each followed by its projects; projects without a known client at the end
  const clientFiles = files.filter((f) => f.kind === "client").sort((a, b) => a.title.localeCompare(b.title));
  const clientKeys = new Set(clientFiles.map((c) => basename(c.path).toLowerCase()));
  const charts = [
    ...clientFiles
      .filter(mine)
      .flatMap((c) => [c, ...hold.projectsOf(basename(c.path).toLowerCase()).filter((p) => p.frontmatter.status !== "done")]),
    ...(focus ? [] : files.filter((f) => f.kind === "project" && !clientKeys.has(hold.fileClient(f) ?? ""))),
  ];
  const clients = [...hold.clients().values()].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <aside className="sidebar">
      <div className="brand">
        <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
          <path d="M4 12h24l-4 9a6 6 0 0 1-5.5 3.6h-5A6 6 0 0 1 8 21z" fill="currentColor" />
          <path d="M16 24.5V30" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <path d="M16 3v8M16 4l7 7h-7" stroke="currentColor" strokeWidth="2" fill="none" strokeLinejoin="round" />
        </svg>
        <span>Keel</span>
        <button
          className={`claude-btn${nav.claudeOpen ? " on" : ""}`}
          onClick={nav.toggleClaude}
          title={`${nav.claudeOpen ? "Hide" : "Ask"} Claude (Ctrl+\`)`}
          aria-label={nav.claudeOpen ? "Hide Claude" : "Open Claude"}
          aria-pressed={nav.claudeOpen}
        >
          <ClaudeIcon size={18} />
        </button>
      </div>

      <div className={`focus-picker${focus ? " on" : ""}`}>
        <select
          value={focus ?? ""}
          onChange={(e) => {
            if (e.target.value === MANAGE) nav.go({ kind: "settings", section: "clients" });
            else setFocus(e.target.value || undefined);
          }}
          aria-label="Focus on a client"
          title="Focus on one client"
        >
          <option value="">All clients</option>
          {clients.map((c) => (
            <option key={c.key} value={c.key}>
              Focus: {c.name}
            </option>
          ))}
          <option value={MANAGE}>{clients.length ? "Manage clients…" : "Add a client…"}</option>
        </select>
        {focus && (
          <button className="icon-btn" onClick={() => setFocus(undefined)} aria-label="Clear focus" title="Clear focus">
            ×
          </button>
        )}
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
        <NavItem active={v.kind === "waiting"} onClick={() => nav.go({ kind: "waiting" })} badge={waitingCount}>
          Waiting on
        </NavItem>
        <NavItem active={v.kind === "charts"} onClick={() => nav.go({ kind: "charts" })}>
          Charts
        </NavItem>
        <NavItem active={v.kind === "dispatch"} onClick={() => nav.go({ kind: "dispatch" })}>
          Dispatch
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
        <LogTree logs={logs} current={current} />
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
        <ThemeToggle />
      </div>
    </aside>
  );
}
