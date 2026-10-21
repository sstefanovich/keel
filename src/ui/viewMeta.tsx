import {
  Bell,
  Building2,
  CalendarDays,
  Clock,
  Compass,
  FileText,
  Flag,
  FolderKanban,
  Hourglass,
  ListChecks,
  LucideIcon,
  NotebookPen,
  Search,
  Send,
  Settings,
  Sun,
  Users,
} from "lucide-react";
import { formatShort, today } from "../core/dates";
import { Hold } from "../core/hold";
import { FileKind, basename } from "../core/parse";
import { View } from "./nav";

export const VIEW_ICONS: Record<Exclude<View["kind"], "file">, LucideIcon> = {
  agenda: ListChecks,
  flags: Flag,
  waiting: Hourglass,
  dispatch: Send,
  charts: Compass,
  timesheet: Clock,
  calendar: CalendarDays,
  search: Search,
  settings: Settings,
};

export const VIEW_TITLES: Record<Exclude<View["kind"], "file">, string> = {
  agenda: "Agenda",
  flags: "Flags",
  waiting: "Waiting on",
  dispatch: "Dispatch",
  charts: "Charts",
  timesheet: "Timesheet",
  calendar: "Calendar",
  search: "Search",
  settings: "Settings",
};

export const FILE_ICONS: Record<FileKind, LucideIcon> = {
  log: NotebookPen,
  meeting: Users,
  note: FileText,
  client: Building2,
  project: FolderKanban,
  flag: Flag,
  reminders: Bell,
  template: FileText,
};

/** Title and icon for a view (a tab, a switcher row, …). */
export function viewMeta(view: View, hold: Hold): { title: string; Icon: LucideIcon } {
  if (view.kind !== "file") return { title: VIEW_TITLES[view.kind], Icon: VIEW_ICONS[view.kind] };
  const f = hold.get(view.path);
  if (!f) return { title: basename(view.path), Icon: FileText };
  if (f.kind === "log" && f.date) return { title: f.date === today() ? "Today" : formatShort(f.date), Icon: f.date === today() ? Sun : NotebookPen };
  if (f.kind === "reminders") return { title: "Reminders", Icon: Bell };
  return { title: f.title.replace(/^\d{4}-\d{2}-\d{2}\s+/, ""), Icon: FILE_ICONS[f.kind] };
}
