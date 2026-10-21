import {
  Bell,
  CalendarDays,
  Clock,
  Compass,
  Flag,
  Hourglass,
  ListChecks,
  LucideIcon,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Send,
  Settings,
  Sun,
  X,
  Zap,
} from "lucide-react";
import { MouseEvent, useState } from "react";
import { today } from "../core/dates";
import { ParsedFile, basename } from "../core/parse";
import { ClaudeIcon } from "./ClaudePanel";
import { useHold } from "./HoldContext";
import { LogTree } from "./LogTree";
import { OpenOpts, View, openOpts, useNav } from "./nav";
import { ThemePref, useTheme } from "./theme";

/** A nav row: icon + label (or just the icon with a tooltip when the sidebar is collapsed). */
function NavItem({
  icon: Icon,
  label,
  active,
  onOpen,
  badge,
  hint,
  collapsed,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onOpen: (o: OpenOpts) => void;
  badge?: number;
  hint?: string;
  collapsed: boolean;
}) {
  return (
    <button
      className={`nav-item${active ? " active" : ""}`}
      onClick={(e) => onOpen(openOpts(e))}
      onAuxClick={(e) => e.button === 1 && onOpen({ newTab: true })}
      title={collapsed ? `${label}${hint ? ` (${hint})` : ""}` : hint}
      aria-label={label}
      aria-current={active ? "page" : undefined}
    >
      <Icon size={17} className="nav-icon" aria-hidden="true" />
      {!collapsed && <span className="nav-label">{label}</span>}
      {badge ? <span className={`badge${collapsed ? " badge-dot" : ""}`}>{collapsed ? "" : badge}</span> : null}
    </button>
  );
}

function FileGroup({
  title,
  files,
  label,
  current,
  onAdd,
  addLabel,
  limit = 8,
}: {
  title: string;
  files: ParsedFile[];
  label: (f: ParsedFile) => string;
  current?: string;
  onAdd?: () => void;
  addLabel?: string;
  limit?: number;
}) {
  const nav = useNav();
  const [all, setAll] = useState(false);
  const shown = all ? files : files.slice(0, limit);
  const open = (f: ParsedFile, e: MouseEvent) => nav.openFile(f.path, undefined, openOpts(e));
  return (
    <div className="side-group">
      <div className="side-group-head">
        <span>{title}</span>
        {onAdd && (
          <button className="icon-btn" onClick={onAdd} aria-label={addLabel ?? `New ${title.toLowerCase()}`} title={addLabel ?? `New ${title.toLowerCase()}`}>
            <Plus size={14} />
          </button>
        )}
      </div>
      {shown.map((f) => (
        <button
          key={f.path}
          className={`file-item${current === f.path ? " active" : ""}${f.kind === "project" ? " sub" : ""}`}
          onClick={(e) => open(f, e)}
          onAuxClick={(e) => e.button === 1 && open(f, e)}
          title={f.path}
        >
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
const PREF_ICON: Record<ThemePref, LucideIcon> = { system: Monitor, light: Sun, dark: Moon };

/** Cycles System → Light → Dark. */
function ThemeToggle() {
  const { pref, setPref } = useTheme();
  const Icon = PREF_ICON[pref];
  return (
    <button
      className="side-icon-btn"
      onClick={() => setPref(NEXT_PREF[pref])}
      title={`${PREF_LABEL[pref]}. Click for ${PREF_LABEL[NEXT_PREF[pref]].toLowerCase()}`}
      aria-label={`${PREF_LABEL[pref]}. Switch to ${PREF_LABEL[NEXT_PREF[pref]].toLowerCase()}`}
    >
      <Icon size={16} />
    </button>
  );
}

export function KeelLogo({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <path d="M16 3.5 L16 12.5 L24 12.5 Z" fill="currentColor" opacity="0.9" />
      <path d="M14.5 6 L14.5 12.5 L9 12.5 Z" fill="currentColor" opacity="0.6" />
      <path d="M4.5 14.5h23l-3.6 7.2a5 5 0 0 1-4.5 2.8h-6.8a5 5 0 0 1-4.5-2.8z" fill="currentColor" />
      <path d="M14.7 24.4h2.6l-.6 4.4a.7.7 0 0 1-1.4 0z" fill="currentColor" />
    </svg>
  );
}

const byDateDesc = (a: ParsedFile, b: ParsedFile) => (b.date ?? "").localeCompare(a.date ?? "") || b.mtime - a.mtime;

export function Sidebar({ onResize }: { onResize: (width: number) => void }) {
  const { hold, focus, setFocus } = useHold();
  const nav = useNav();
  const collapsed = nav.sidebarCollapsed;
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
    ...clientFiles.filter(mine).flatMap((c) => [c, ...hold.projectsOf(basename(c.path).toLowerCase()).filter((p) => p.frontmatter.status !== "done")]),
    ...(focus ? [] : files.filter((f) => f.kind === "project" && !clientKeys.has(hold.fileClient(f) ?? ""))),
  ];
  const clients = [...hold.clients().values()].sort((a, b) => a.name.localeCompare(b.name));
  const focusName = focus ? clients.find((c) => c.key === focus)?.name ?? focus : undefined;

  const item = (icon: LucideIcon, label: string, active: boolean, onOpen: (o: OpenOpts) => void, extra: { badge?: number; hint?: string } = {}) => (
    <NavItem icon={icon} label={label} active={active} onOpen={onOpen} collapsed={collapsed} {...extra} />
  );

  const startResize = (e: MouseEvent) => {
    e.preventDefault();
    const move = (ev: globalThis.MouseEvent) => onResize(Math.min(420, Math.max(200, ev.clientX)));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.classList.remove("resizing");
    };
    document.body.classList.add("resizing");
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <aside className={`sidebar${collapsed ? " collapsed" : ""}`} aria-label="Navigation">
      <div className="brand">
        {collapsed ? (
          <button className="brand-mark" onClick={nav.toggleSidebar} title="Expand sidebar (Ctrl+\)" aria-label="Expand sidebar">
            <KeelLogo />
          </button>
        ) : (
          <>
            <span className="brand-mark">
              <KeelLogo />
            </span>
            <span className="brand-name">Keel</span>
            <button className="side-icon-btn" onClick={nav.toggleSidebar} title="Collapse sidebar (Ctrl+\)" aria-label="Collapse sidebar">
              <PanelLeftClose size={16} />
            </button>
          </>
        )}
      </div>

      {!collapsed && (
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
              <X size={14} />
            </button>
          )}
        </div>
      )}
      {collapsed && focus && (
        <button className="rail-focus" onClick={() => setFocus(undefined)} title={`Focused on ${focusName}. Click to clear`} aria-label={`Clear focus on ${focusName}`}>
          {focusName!.slice(0, 2)}
        </button>
      )}

      <button className="capture-btn" onClick={nav.capture} title="Quick capture (Ctrl+K, or Ctrl+Alt+K anywhere)" aria-label="Quick capture">
        <Zap size={16} className="nav-icon" aria-hidden="true" />
        {!collapsed && (
          <>
            <span>Capture…</span>
            <kbd>Ctrl K</kbd>
          </>
        )}
      </button>

      <nav className="nav">
        {item(Sun, "Today", current === todayPath, (o) => nav.openToday(o), { hint: "Ctrl+T" })}
        {item(ListChecks, "Agenda", v.kind === "agenda", (o) => nav.go({ kind: "agenda" }, o), { badge: agenda.overdue.length + agenda.today.length, hint: "Ctrl+J" })}
        {item(Flag, "Flags", v.kind === "flags", (o) => nav.go({ kind: "flags" }, o), { badge: flagCount })}
        {item(Hourglass, "Waiting on", v.kind === "waiting", (o) => nav.go({ kind: "waiting" }, o), { badge: waitingCount })}
        <div className="nav-sep" />
        {item(Clock, "Timesheet", v.kind === "timesheet", (o) => nav.go({ kind: "timesheet" }, o))}
        {item(Send, "Dispatch", v.kind === "dispatch", (o) => nav.go({ kind: "dispatch" }, o))}
        {item(Compass, "Charts", v.kind === "charts", (o) => nav.go({ kind: "charts" }, o))}
        <div className="nav-sep" />
        {item(CalendarDays, "Calendar", v.kind === "calendar", (o) => nav.go({ kind: "calendar" }, o))}
        {item(Search, "Search", v.kind === "search", (o) => nav.go({ kind: "search" }, o), { hint: "Ctrl+Shift+F" })}
        {item(Bell, "Reminders", current === "reminders.md", (o) => nav.openFile("reminders.md", undefined, o))}
      </nav>

      {!collapsed ? (
        <div className="side-scroll">
          <FileGroup title="Meetings" files={meetings} current={current} onAdd={() => nav.newItem("meeting")} label={(f) => f.title.replace(/^\d{4}-\d{2}-\d{2}\s*/, "") || f.title} />
          <FileGroup title="Notes" files={notes} current={current} onAdd={() => nav.newItem("note")} label={(f) => (f.path.split("/").length > 2 ? `${f.path.split("/").slice(1, -1).join("/")}/` : "") + f.title} limit={12} />
          <LogTree logs={logs} current={current} />
          <FileGroup title="Charts" files={charts} current={current} onAdd={() => nav.newItem("client")} addLabel="New client" label={(f) => f.title} limit={14} />
        </div>
      ) : (
        <div className="side-scroll" />
      )}

      <div className="side-foot">
        {item(Settings, "Settings", v.kind === "settings", (o) => nav.go({ kind: "settings" }, o))}
        <div className="side-foot-tools">
          <button
            className={`side-icon-btn claude-btn${nav.claudeOpen ? " on" : ""}`}
            onClick={nav.toggleClaude}
            title={`${nav.claudeOpen ? "Hide" : "Ask"} Claude (Ctrl+\`)`}
            aria-label={nav.claudeOpen ? "Hide Claude" : "Open Claude"}
            aria-pressed={nav.claudeOpen}
          >
            <ClaudeIcon size={17} />
          </button>
          <ThemeToggle />
          {collapsed && (
            <button className="side-icon-btn" onClick={nav.toggleSidebar} title="Expand sidebar (Ctrl+\)" aria-label="Expand sidebar">
              <PanelLeftOpen size={16} />
            </button>
          )}
        </div>
      </div>

      {!collapsed && <div className="sidebar-resize" onMouseDown={startResize} title="Drag to resize" aria-hidden="true" />}
    </aside>
  );
}
