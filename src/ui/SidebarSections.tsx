import {
  Archive,
  ArchiveRestore,
  ArrowDownAZ,
  ChevronRight,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  FolderTree,
  LayoutList,
  Pencil,
  Pin,
  PinOff,
  Plus,
  SquareArrowOutUpRight,
  Trash2,
} from "lucide-react";
import { DragEvent, MouseEvent, ReactNode, useEffect, useState } from "react";
import { parseISO, today } from "../core/dates";
import { Hold } from "../core/hold";
import { ParsedFile, basename } from "../core/parse";
import { confirmDialog } from "../lib/platform";
import { MenuEntry, SEP, useContextMenu } from "./ContextMenu";
import { useHold } from "./HoldContext";
import { LogTree } from "./LogTree";
import { Nav, openOpts, useNav } from "./nav";
import { NotesMode, useNotesMode, useOpen, useRecent } from "./sidebarStore";
import { FILE_ICONS } from "./viewMeta";

const DRAG_TYPE = "application/x-keel-path";

// ---------- building blocks ----------

/** A collapsible sidebar section with a count and optional header actions. */
export function Section({
  id,
  title,
  count,
  defaultOpen = true,
  actions,
  onHeaderMenu,
  onDropFile,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  defaultOpen?: boolean;
  actions?: ReactNode;
  onHeaderMenu?: (e: MouseEvent) => void;
  onDropFile?: (path: string) => void;
  children: ReactNode;
}) {
  const [open, toggle] = useOpen(`section:${id}`, defaultOpen);
  const [over, setOver] = useState(false);
  const drop = onDropFile
    ? {
        onDragOver: (e: DragEvent) => {
          if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
          e.preventDefault();
          setOver(true);
        },
        onDragLeave: () => setOver(false),
        onDrop: (e: DragEvent) => {
          setOver(false);
          const p = e.dataTransfer.getData(DRAG_TYPE);
          if (p) onDropFile(p);
        },
      }
    : {};
  return (
    <div className={`side-section${open ? " open" : ""}`}>
      <div className={`side-section-head${over ? " drop" : ""}`} onContextMenu={onHeaderMenu} {...drop}>
        <button className="side-section-toggle" onClick={toggle} aria-expanded={open}>
          <ChevronRight size={13} className="side-chevron" aria-hidden="true" />
          <span>{title}</span>
          {count !== undefined && count > 0 && <span className="side-count">{count}</span>}
        </button>
        {actions && <span className="side-section-actions">{actions}</span>}
      </div>
      {open && <div className="side-section-body">{children}</div>}
    </div>
  );
}

/** A collapsible group inside a section (a folder, a month, a client). */
function Group({
  id,
  label,
  count,
  depth,
  defaultOpen = false,
  icon,
  onMenu,
  onDropFile,
  children,
}: {
  id: string;
  label: string;
  count?: number;
  depth: number;
  defaultOpen?: boolean;
  icon?: "folder";
  onMenu?: (e: MouseEvent) => void;
  onDropFile?: (path: string) => void;
  children: ReactNode;
}) {
  const [open, toggle] = useOpen(id, defaultOpen);
  const [over, setOver] = useState(false);
  const FolderIcon = open ? FolderOpen : Folder;
  return (
    <div>
      <button
        className={`file-item tree-branch${over ? " drop" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={toggle}
        onContextMenu={onMenu}
        aria-expanded={open}
        onDragOver={
          onDropFile
            ? (e) => {
                if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
                e.preventDefault();
                setOver(true);
              }
            : undefined
        }
        onDragLeave={() => setOver(false)}
        onDrop={
          onDropFile
            ? (e) => {
                setOver(false);
                const p = e.dataTransfer.getData(DRAG_TYPE);
                if (p) onDropFile(p);
              }
            : undefined
        }
      >
        <span className="tree-label">
          <ChevronRight size={12} className={`tree-caret${open ? " open" : ""}`} aria-hidden="true" />
          {icon === "folder" && <FolderIcon size={14} className="tree-folder" aria-hidden="true" />}
          <span className="tree-text">{label}</span>
        </span>
        {count !== undefined && <span className="tree-hours">{count}</span>}
      </button>
      {open && children}
    </div>
  );
}

/** One file in the sidebar: opens on click (Ctrl/middle-click: new tab), right-click menu, draggable notes. */
export function FileRow({ file, label, depth = 0, current }: { file: ParsedFile; label?: string; depth?: number; current?: string }) {
  const nav = useNav();
  const { hold, bump, reportError } = useHold();
  const openMenu = useContextMenu();
  const Icon = FILE_ICONS[file.kind];
  const pinned = hold.isPinned(file.path);
  return (
    <button
      className={`file-item file-row${current === file.path ? " active" : ""}`}
      style={{ paddingLeft: 10 + depth * 14 }}
      title={file.path}
      draggable={file.kind === "note"}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, file.path);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={(e) => nav.openFile(file.path, undefined, openOpts(e))}
      onAuxClick={(e) => e.button === 1 && nav.openFile(file.path, undefined, { newTab: true })}
      onContextMenu={(e) => openMenu(e, fileMenu(file, hold, nav, bump, reportError))}
    >
      <Icon size={14} className="file-row-icon" aria-hidden="true" />
      <span className="file-row-label">{label ?? file.title}</span>
      {pinned && <Pin size={11} className="file-row-pin" aria-label="Pinned" />}
    </button>
  );
}

// ---------- menus ----------

function folderLabel(path: string) {
  return path === "notes" ? "Notes (top level)" : path.replace(/^notes\//, "").split("/").join(" › ");
}

/** Right-click actions for a file. */
export function fileMenu(f: ParsedFile, hold: Hold, nav: Nav, bump: () => void, reportError: (e: unknown) => void): MenuEntry[] {
  const run = (fn: () => Promise<unknown>) => () => {
    fn()
      .then(bump)
      .catch(reportError);
  };
  const pinned = hold.isPinned(f.path);
  const archived = hold.isArchived(f);
  const canRename = f.kind === "note" || f.kind === "meeting" || f.kind === "flag";
  const entries: MenuEntry[] = [
    { label: "Open in new tab", icon: SquareArrowOutUpRight, onSelect: () => nav.openFile(f.path, undefined, { newTab: true }) },
    pinned
      ? { label: "Unpin", icon: PinOff, onSelect: run(() => hold.setPinned(f.path, false)) }
      : { label: "Pin to top", icon: Pin, onSelect: run(() => hold.setPinned(f.path, true)) },
    SEP,
  ];
  if (canRename || f.kind === "client" || f.kind === "project") {
    entries.push({
      label: "Rename…",
      icon: Pencil,
      disabled: !canRename,
      hint: canRename ? undefined : "Its file name is its @tag, which your logged hours use",
      onSelect: () =>
        nav.prompt({
          title: `Rename ${f.kind}`,
          label: "New name (links to it are updated too)",
          initial: f.title.replace(/^\d{4}-\d{2}-\d{2}\s+/, ""),
          submitLabel: "Rename",
          onSubmit: async (v) => {
            await hold.renameFile(f.path, v);
            bump();
          },
        }),
    });
  }
  if (f.kind === "note") {
    entries.push({
      label: "Move to folder…",
      icon: FolderInput,
      onSelect: async () => {
        const folders = ["notes", ...(await hold.noteFolders())];
        const here = f.path.split("/").slice(0, -1).join("/");
        nav.prompt({
          title: `Move “${f.title}”`,
          label: "",
          noText: true,
          choice: { label: "Folder", options: folders.map((d) => ({ value: d, label: folderLabel(d) })), initial: here },
          submitLabel: "Move",
          onSubmit: async (_v, _d, folder) => {
            await hold.moveFile(f.path, folder);
            bump();
          },
        });
      },
    });
  }
  if (f.kind === "note" || f.kind === "meeting" || f.kind === "project") {
    const label = f.kind === "project" ? (archived ? "Reopen project" : "Mark project done") : archived ? "Unarchive" : "Archive";
    entries.push({ label, icon: archived ? ArchiveRestore : Archive, onSelect: run(() => hold.setArchived(f.path, !archived)) });
  }
  if (f.kind === "client") {
    entries.push({ label: "New project…", icon: Plus, onSelect: () => nav.newItem("project", basename(f.path).toLowerCase()) });
  }
  if (f.kind === "project") {
    entries.push({ label: "New note in this project…", icon: Plus, onSelect: () => nav.newItem("note", undefined, hold.fileProject(f)) });
  }
  entries.push(SEP, {
    label: "Delete…",
    icon: Trash2,
    danger: true,
    onSelect: async () => {
      if (!(await confirmDialog(`Delete “${f.title}”? The file is removed from disk.`, "Delete"))) return;
      run(async () => {
        if (pinned) await hold.setPinned(f.path, false);
        await hold.remove(f.path);
      })();
    },
  });
  return entries;
}

// ---------- sections ----------

export function PinnedSection({ current }: { current?: string }) {
  const { hold } = useHold();
  const pinned = hold.pins.map((p) => hold.get(p)).filter((f): f is ParsedFile => !!f);
  if (!pinned.length) return null;
  return (
    <Section id="pinned" title="Pinned" count={pinned.length}>
      {pinned.map((f) => (
        <FileRow key={f.path} file={f} current={current} label={f.kind === "log" && f.date ? f.date : undefined} />
      ))}
    </Section>
  );
}

export function RecentSection({ current }: { current?: string }) {
  const { hold } = useHold();
  const recent = useRecent()
    .filter((p) => !hold.isPinned(p))
    .map((p) => hold.get(p))
    .filter((f): f is ParsedFile => !!f && f.kind !== "template")
    .slice(0, 6);
  if (!recent.length) return null;
  return (
    <Section id="recent" title="Recent" defaultOpen={true}>
      {recent.map((f) => (
        <FileRow key={f.path} file={f} current={current} />
      ))}
    </Section>
  );
}

const monthLabel = (ym: string) => parseISO(`${ym}-01`).toLocaleDateString(undefined, { month: "long", year: "numeric" });

export function MeetingsSection({ meetings, current }: { meetings: ParsedFile[]; current?: string }) {
  const nav = useNav();
  const thisMonth = today().slice(0, 7);
  const months = new Map<string, ParsedFile[]>();
  for (const m of meetings) {
    const ym = (m.date ?? "").slice(0, 7) || "Undated";
    months.set(ym, [...(months.get(ym) ?? []), m]);
  }
  return (
    <Section
      id="meetings"
      title="Meetings"
      count={meetings.length}
      actions={
        <button className="icon-btn" onClick={() => nav.newItem("meeting")} title="New meeting" aria-label="New meeting">
          <Plus size={14} />
        </button>
      }
    >
      {!meetings.length && <span className="file-item muted">None yet</span>}
      {[...months].map(([ym, ms]) => (
        <Group key={ym} id={`month:${ym}`} label={ym === "Undated" ? ym : monthLabel(ym)} count={ms.length} depth={0} defaultOpen={ym === thisMonth}>
          {ms.map((m) => (
            <FileRow key={m.path} file={m} depth={1} current={current} label={m.title.replace(/^\d{4}-\d{2}-\d{2}\s*/, "") || m.title} />
          ))}
        </Group>
      ))}
    </Section>
  );
}

const MODE_INFO: Record<NotesMode, { next: NotesMode; label: string; Icon: typeof FolderTree }> = {
  folders: { next: "project", label: "Grouped by folder", Icon: FolderTree },
  project: { next: "az", label: "Grouped by client & project", Icon: LayoutList },
  az: { next: "folders", label: "A–Z", Icon: ArrowDownAZ },
};

export function NotesSection({ notes, current }: { notes: ParsedFile[]; current?: string }) {
  const nav = useNav();
  const { hold, version, bump, reportError } = useHold();
  const openMenu = useContextMenu();
  const [mode, setMode] = useNotesMode();
  const [folders, setFolders] = useState<string[]>([]);
  useEffect(() => {
    hold.noteFolders().then(setFolders).catch(() => {});
  }, [hold, version]);

  const move = (path: string, folder: string) =>
    hold
      .moveFile(path, folder)
      .then(bump)
      .catch(reportError);

  const newFolder = (parent: string) =>
    nav.prompt({
      title: parent === "notes" ? "New folder" : `New folder in ${folderLabel(parent)}`,
      label: "Folder name",
      submitLabel: "Create",
      onSubmit: async (v) => {
        await hold.createFolder(parent, v);
        bump();
      },
    });

  const newNoteIn = (folder: string) =>
    nav.prompt({
      title: `New note in ${folderLabel(folder)}`,
      label: "Title",
      submitLabel: "Create",
      onSubmit: async (v) => {
        const p = await hold.createNote(v, folder);
        bump();
        nav.openFile(p);
      },
    });

  const folderMenu = (path: string, empty: boolean): MenuEntry[] => [
    { label: "New note here…", icon: Plus, onSelect: () => newNoteIn(path) },
    { label: "New folder inside…", icon: FolderPlus, onSelect: () => newFolder(path) },
    SEP,
    {
      label: "Rename folder…",
      icon: Pencil,
      onSelect: () =>
        nav.prompt({
          title: "Rename folder",
          label: "Folder name",
          initial: basename(path),
          submitLabel: "Rename",
          onSubmit: async (v) => {
            await hold.renameFolder(path, v);
            bump();
          },
        }),
    },
    {
      label: "Delete folder",
      icon: Trash2,
      danger: true,
      disabled: !empty,
      hint: empty ? undefined : "Move or delete its notes first",
      onSelect: () =>
        hold
          .deleteFolder(path)
          .then(bump)
          .catch(reportError),
    },
  ];

  const info = MODE_INFO[mode];
  const header = (
    <>
      <button className="icon-btn" onClick={() => setMode(info.next)} title={`${info.label}. Click to switch`} aria-label={`Notes: ${info.label}. Switch grouping`}>
        <info.Icon size={14} />
      </button>
      <button className="icon-btn" onClick={() => newFolder("notes")} title="New folder" aria-label="New folder">
        <FolderPlus size={14} />
      </button>
      <button className="icon-btn" onClick={() => nav.newItem("note")} title="New note (Ctrl+N)" aria-label="New note">
        <Plus size={14} />
      </button>
    </>
  );

  // folder tree: subfolders of notes/ plus any folder implied by a note's path
  const dirOf = (f: ParsedFile) => (f.path.startsWith("notes/") ? f.path.split("/").slice(0, -1).join("/") : "notes");
  const allFolders = [...new Set([...folders, ...notes.map(dirOf).filter((d) => d !== "notes")])];
  const childFolders = (parent: string) =>
    allFolders.filter((d) => d.startsWith(`${parent}/`) && !d.slice(parent.length + 1).includes("/")).sort((a, b) => a.localeCompare(b));
  const notesIn = (folder: string) => notes.filter((n) => dirOf(n) === folder).sort((a, b) => a.title.localeCompare(b.title));
  const countIn = (folder: string) => notes.filter((n) => dirOf(n) === folder || dirOf(n).startsWith(`${folder}/`)).length;

  const tree = (folder: string, depth: number): ReactNode => (
    <>
      {childFolders(folder).map((d) => (
        <Group
          key={d}
          id={`folder:${d}`}
          label={basename(d)}
          count={countIn(d)}
          depth={depth}
          icon="folder"
          onMenu={(e) => openMenu(e, folderMenu(d, countIn(d) === 0 && !childFolders(d).length))}
          onDropFile={(p) => move(p, d)}
        >
          {tree(d, depth + 1)}
        </Group>
      ))}
      {notesIn(folder).map((n) => (
        <FileRow key={n.path} file={n} depth={depth} current={current} />
      ))}
    </>
  );

  // by client › project
  const byProject = () => {
    const clients = hold.clients();
    const groups = new Map<string, Map<string, ParsedFile[]>>();
    for (const n of notes) {
      const c = hold.fileClient(n) ?? "";
      const p = hold.fileProject(n) ?? "";
      if (!groups.has(c)) groups.set(c, new Map());
      const g = groups.get(c)!;
      g.set(p, [...(g.get(p) ?? []), n]);
    }
    const sortedClients = [...groups.keys()].sort((a, b) => (!a ? 1 : !b ? -1 : (clients.get(a)?.name ?? a).localeCompare(clients.get(b)?.name ?? b)));
    return sortedClients.map((c) => {
      const projects = groups.get(c)!;
      const total = [...projects.values()].reduce((s, l) => s + l.length, 0);
      return (
        <Group key={c || "_none"} id={`np:${c}`} label={c ? clients.get(c)?.name ?? c : "No client or project"} count={total} depth={0} defaultOpen>
          {[...projects]
            .sort(([a], [b]) => (!a ? -1 : !b ? 1 : hold.projectName(a).localeCompare(hold.projectName(b))))
            .map(([p, list]) =>
              p ? (
                <Group key={p} id={`np:${c}/${p}`} label={hold.projectName(p)} count={list.length} depth={1} defaultOpen>
                  {list.map((n) => (
                    <FileRow key={n.path} file={n} depth={2} current={current} />
                  ))}
                </Group>
              ) : (
                list.map((n) => <FileRow key={n.path} file={n} depth={1} current={current} />)
              ),
            )}
        </Group>
      );
    });
  };

  return (
    <Section
      id="notes"
      title="Notes"
      count={notes.length}
      actions={header}
      onHeaderMenu={(e) => openMenu(e, [{ label: "New note…", icon: Plus, onSelect: () => newNoteIn("notes") }, { label: "New folder…", icon: FolderPlus, onSelect: () => newFolder("notes") }])}
      onDropFile={(p) => move(p, "notes")}
    >
      {!notes.length && !allFolders.length && <span className="file-item muted">None yet</span>}
      {mode === "folders" && tree("notes", 0)}
      {mode === "project" && byProject()}
      {mode === "az" && [...notes].sort((a, b) => a.title.localeCompare(b.title)).map((n) => <FileRow key={n.path} file={n} current={current} />)}
    </Section>
  );
}

export function LogsSection({ logs, current }: { logs: ParsedFile[]; current?: string }) {
  return (
    <Section id="logs" title="Logs">
      <LogTree logs={logs} current={current} />
    </Section>
  );
}

export function ChartsSection({ charts, current }: { charts: ParsedFile[]; current?: string }) {
  const nav = useNav();
  return (
    <Section
      id="charts"
      title="Charts"
      count={charts.filter((f) => f.kind === "client").length || undefined}
      actions={
        <button className="icon-btn" onClick={() => nav.newItem("client")} title="New client" aria-label="New client">
          <Plus size={14} />
        </button>
      }
    >
      {!charts.length && <span className="file-item muted">None yet</span>}
      {charts.map((f) => (
        <FileRow key={f.path} file={f} depth={f.kind === "project" ? 1 : 0} current={current} />
      ))}
    </Section>
  );
}

export function ArchiveSection({ items, current }: { items: ParsedFile[]; current?: string }) {
  if (!items.length) return null;
  return (
    <Section id="archive" title="Archive" count={items.length} defaultOpen={false}>
      {items.map((f) => (
        <FileRow key={f.path} file={f} current={current} />
      ))}
    </Section>
  );
}
