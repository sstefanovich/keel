import { parse as parseYaml } from "yaml";
import { ISODate, isISODate } from "./dates";
import { RemindRule, parseRemind } from "./schedule";

export type FileKind = "log" | "meeting" | "note" | "client" | "reminders" | "template";

/** [ ] open, [x] done, [>] migrated to a later log, [-] cancelled */
export type TaskStatus = "open" | "done" | "migrated" | "cancelled";

export interface Task {
  file: string;
  /** 0-based line index in the file */
  line: number;
  raw: string;
  /** Text with @due/@remind tokens removed */
  text: string;
  status: TaskStatus;
  indent: number;
  due?: ISODate;
  remind?: RemindRule;
  tags: string[];
}

export interface HoursEntry {
  file: string;
  line: number;
  date: ISODate;
  hours: number;
  client: string;
  description: string;
}

export interface Reminder {
  file: string;
  line: number;
  text: string;
  rule: RemindRule;
  /** Set when the reminder is attached to a task */
  taskStatus?: TaskStatus;
}

export interface ParsedFile {
  path: string;
  kind: FileKind;
  title: string;
  date?: ISODate;
  frontmatter: Record<string, unknown>;
  content: string;
  mtime: number;
  tasks: Task[];
  hours: HoursEntry[];
  reminders: Reminder[];
  links: string[];
  tags: string[];
}

const STATUS_CHARS: Record<string, TaskStatus> = { " ": "open", x: "done", X: "done", ">": "migrated", "-": "cancelled" };
export const STATUS_CHAR: Record<TaskStatus, string> = { open: " ", done: "x", migrated: ">", cancelled: "-" };

export const TASK_RE = /^(\s*)[-*+] \[([ xX>\-])\] (.*)$/;
export const HOURS_RE = /^\s*[-*+]\s+(?:(\d+(?:\.\d+)?)h)?(?:(\d+)m)?\s+@([\w.-]+)\s*(?:[-–:]\s*)?(.*)$/i;
const BULLET_RE = /^\s*[-*+]\s+(.*)$/;
const DUE_RE = /@due\((\d{4}-\d{2}-\d{2})\)/;
const REMIND_RE = /@remind\(([^)]*)\)/;
const TAG_RE = /(?:^|\s)#([A-Za-z][\w/-]*)/g;
const LINK_RE = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g;

export function kindOf(path: string): FileKind {
  if (path.startsWith("logs/")) return "log";
  if (path.startsWith("meetings/")) return "meeting";
  if (path.startsWith("clients/")) return "client";
  if (path.startsWith("templates/")) return "template";
  if (path === "reminders.md") return "reminders";
  return "note";
}

export function basename(path: string): string {
  return path.split("/").pop()!.replace(/\.md$/i, "");
}

/** Splits leading YAML frontmatter. Returns the number of lines it occupied. */
export function splitFrontmatter(content: string, parse = true): { data: Record<string, unknown>; lines: number } {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { data: {}, lines: 0 };
  const lines = m[0].split(/\r?\n/).length - (m[0].endsWith("\n") ? 1 : 0);
  if (!parse) return { data: {}, lines };
  let data: Record<string, unknown> = {};
  try {
    const parsed = parseYaml(m[1]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
  } catch {
    // malformed frontmatter: treat as empty rather than failing the whole file
  }
  return { data, lines };
}

function fileDate(path: string, fm: Record<string, unknown>): ISODate | undefined {
  if (isISODate(fm.date)) return fm.date;
  const m = basename(path).match(/^(\d{4}-\d{2}-\d{2})/);
  return m && isISODate(m[1]) ? m[1] : undefined;
}

function stripTokens(s: string): string {
  return s.replace(DUE_RE, "").replace(REMIND_RE, "").replace(/\s{2,}/g, " ").trim();
}

function tagsIn(s: string): string[] {
  return [...s.matchAll(TAG_RE)].map((m) => m[1].toLowerCase());
}

export function parseFile(path: string, content: string, mtime = 0): ParsedFile {
  const kind = kindOf(path);
  const { data: frontmatter, lines: fmLines } = splitFrontmatter(content, kind !== "template");
  const date = fileDate(path, frontmatter);
  const lines = content.split(/\r?\n/);

  const tasks: Task[] = [];
  const hours: HoursEntry[] = [];
  const reminders: Reminder[] = [];
  const links = new Set<string>();
  const tags = new Set<string>();
  let title = typeof frontmatter.title === "string" ? frontmatter.title : "";
  if (Array.isArray(frontmatter.tags)) frontmatter.tags.forEach((t) => tags.add(String(t).toLowerCase()));

  let inFence = false;
  for (let i = fmLines; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (!title) {
      const h = line.match(/^#\s+(.+)$/);
      if (h) title = h[1].trim();
    }
    // tokens inside `inline code` are examples, not data
    const scan = line.replace(/`[^`]*`/g, (m) => " ".repeat(m.length));
    for (const m of scan.matchAll(LINK_RE)) links.add(m[1].trim());
    if (kind === "template") continue;
    tagsIn(scan.replace(/^#+\s.*$/, "")).forEach((t) => tags.add(t));

    const t = line.match(TASK_RE);
    if (t) {
      const body = t[3];
      const tokens = scan.match(TASK_RE)![3];
      const text = stripTokens(body);
      if (!text) continue;
      const due = tokens.match(DUE_RE)?.[1];
      const remindSpec = tokens.match(REMIND_RE)?.[1];
      const remind = remindSpec ? parseRemind(remindSpec, date) ?? undefined : undefined;
      const task: Task = {
        file: path,
        line: i,
        raw: line,
        text,
        status: STATUS_CHARS[t[2]],
        indent: t[1].replace(/\t/g, "    ").length,
        due: isISODate(due) ? due : undefined,
        remind,
        tags: tagsIn(tokens),
      };
      tasks.push(task);
      if (remind) reminders.push({ file: path, line: i, text, rule: remind, taskStatus: task.status });
      continue;
    }

    const h = scan.match(HOURS_RE);
    if (h && (h[1] || h[2])) {
      const amount = (h[1] ? Number(h[1]) : 0) + (h[2] ? Number(h[2]) / 60 : 0);
      if (amount > 0 && date) {
        hours.push({ file: path, line: i, date, hours: amount, client: h[3].toLowerCase(), description: h[4].trim() });
      }
      continue;
    }

    const b = line.match(BULLET_RE);
    const remindSpec = scan.match(REMIND_RE)?.[1];
    if (b && remindSpec) {
      const rule = parseRemind(remindSpec, kind === "reminders" ? undefined : date);
      if (rule) reminders.push({ file: path, line: i, text: stripTokens(b[1]), rule });
    }
  }

  return {
    path,
    kind,
    title: title || basename(path),
    date,
    frontmatter,
    content,
    mtime,
    tasks,
    hours,
    reminders,
    links: [...links],
    tags: [...tags],
  };
}

/** Replace the checkbox character of a task line. */
export function setTaskChar(line: string, status: TaskStatus): string {
  return line.replace(/^(\s*[-*+] \[)[ xX>\-](\] )/, `$1${STATUS_CHAR[status]}$2`);
}

/**
 * Insert `text` (one or more lines) at the end of the section under a heading
 * named `heading` (any level, case-insensitive). Appends the section if missing.
 */
export function appendToSection(content: string, heading: string, text: string): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const want = heading.trim().toLowerCase();
  const idx = lines.findIndex((l) => {
    const m = l.match(/^(#{1,6})\s+(.*?)\s*$/);
    return m && m[2].toLowerCase() === want;
  });
  const newLines = text.split(/\r?\n/);
  if (idx === -1) {
    while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    lines.push("", `## ${heading}`, ...newLines, "");
    return lines.join(eol);
  }
  const level = lines[idx].match(/^#+/)![0].length;
  let end = lines.length;
  for (let i = idx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s/);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  let at = end;
  while (at - 1 > idx && lines[at - 1].trim() === "") at--;
  lines.splice(at, 0, ...newLines);
  const after = at + newLines.length;
  if (after < lines.length && /^#{1,6}\s/.test(lines[after])) lines.splice(after, 0, "");
  if (after >= lines.length) lines.push("");
  return lines.join(eol);
}
