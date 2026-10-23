import { parse as parseYaml } from "yaml";
import { ISODate, isISODate } from "./dates";
import { RemindRule, parseRemind } from "./schedule";

export type FileKind = "log" | "meeting" | "note" | "client" | "project" | "flag" | "reminders" | "template";

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
  /** Who this is waiting on: @waiting(Name), or "Name: …" before a bare @waiting. "" if unknown. */
  waiting?: string;
  /** When the item was first logged: @since(date), else the file's date */
  since?: ISODate;
  /** Completion date from @done(date) */
  doneOn?: ISODate;
}

export interface HoursEntry {
  file: string;
  line: number;
  date: ISODate;
  hours: number;
  /** The @key as written, lowercased: a client key, a project key, or "client/project" */
  client: string;
  description: string;
  /** What was done: the description plus bullets (and ticked tasks) indented under the line */
  items: string[];
  /** Last line of the block (the hours line itself if it has no children) */
  end: number;
}

/** A fenced code block on a client/project Chart (CLI commands, config, diagrams). */
export interface Snippet {
  file: string;
  /** 0-based line of the opening fence */
  line: number;
  section: string;
  lang: string;
  code: string;
  /** Text line just above the fence, if any ("Log in to the tenant:") */
  title?: string;
}

export interface Reminder {
  file: string;
  line: number;
  text: string;
  rule: RemindRule;
  /** Set when the reminder is attached to a task */
  taskStatus?: TaskStatus;
}

/** A reference entry on a client/project Chart (URL, server, resource group, …). */
export interface ChartItem {
  file: string;
  line: number;
  /** Heading the item sits under ("" before the first ## heading) */
  section: string;
  label?: string;
  value: string;
  /** First URL in the value, if any */
  url?: string;
  indent: number;
}

export interface ParsedFile {
  path: string;
  kind: FileKind;
  title: string;
  date?: ISODate;
  frontmatter: Record<string, unknown>;
  content: string;
  /** Content without frontmatter, trimmed */
  body: string;
  mtime: number;
  tasks: Task[];
  hours: HoursEntry[];
  reminders: Reminder[];
  chart: ChartItem[];
  snippets: Snippet[];
  links: string[];
  tags: string[];
}

const STATUS_CHARS: Record<string, TaskStatus> = { " ": "open", x: "done", X: "done", ">": "migrated", "-": "cancelled" };
export const STATUS_CHAR: Record<TaskStatus, string> = { open: " ", done: "x", migrated: ">", cancelled: "-" };

export const TASK_RE = /^(\s*)[-*+] \[([ xX>\-])\] (.*)$/;
/**
 * A duration: "6h", "6 hours", "1.5 hrs", "6h30m", "6h 30m", "90 min". Two groups: hours, minutes.
 * Shared by the parser, quick capture and editor highlighting.
 */
export const DURATION_SRC = String.raw`(?:(\d*\.?\d+)\s?(?:h|hrs?|hours?)(?![a-z]))?\s?(?:(\d+)\s?(?:m|mins?|minutes?)(?![a-z]))?`;

/**
 * "- 6h @key description" / "- Work .25 hours @client/project" / "- Worked 2h on @key" / "- @key"
 * Groups: indent, hours, minutes, key, description.
 */
export const HOURS_RE = new RegExp(
  String.raw`^(\s*)[-*+]\s+(?:work(?:ed)?:?\s+)?(?:${DURATION_SRC}\s+)?(?:on\s+)?@([\w.-]+(?:\/[\w.-]+)?)\s*(?:[-–:]\s*)?(.*)$`,
  "i",
);

const indentOf = (s: string) => s.replace(/\t/g, "    ").match(/^\s*/)![0].length;
const BULLET_RE = /^\s*[-*+]\s+(.*)$/;
const DUE_RE = /@due\((\d{4}-\d{2}-\d{2})\)/;
const REMIND_RE = /@remind\(([^)]*)\)/;
const WAITING_RE = /@waiting(?:\(([^)]*)\))?/;
/** A capitalised @Name on a task is the person it's waiting on (client and project keys are lowercase) */
const OWNER_RE = /(?:^|\s)@([A-Z][\w.'-]*[\w])(?=$|[\s,;:!?)])/;
const SINCE_RE = /@since\((\d{4}-\d{2}-\d{2})\)/;
const DONE_RE = /@done\((\d{4}-\d{2}-\d{2})\)/;
const TAG_RE = /(?:^|\s)#([A-Za-z][\w/-]*)/g;
const LINK_RE = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g;

export function kindOf(path: string): FileKind {
  if (path.startsWith("logs/")) return "log";
  if (path.startsWith("meetings/")) return "meeting";
  if (path.startsWith("clients/")) return "client";
  if (path.startsWith("projects/")) return "project";
  if (path.startsWith("flags/")) return "flag";
  if (path.startsWith("templates/")) return "template";
  if (path === "reminders.md") return "reminders";
  // guide for Claude Code: treated like a template so its examples aren't read as tasks or notes
  if (path === "CLAUDE.md") return "template";
  return "note";
}

export function basename(path: string): string {
  return path.split("/").pop()!.replace(/\.md$/i, "");
}

/**
 * YAML can't start a plain value with "@", so "project: @flis-retain-pa" would make the whole
 * frontmatter unreadable. Quote such values (and @items in inline lists) before parsing.
 */
function quoteMentions(yamlText: string): string {
  return yamlText
    .replace(/^(\s*[\w-]+:[ \t]*)(@[^\s#,\[\]{}"']+)[ \t]*$/gm, '$1"$2"')
    .replace(/^(\s*[\w-]+:[ \t]*\[)([^\]\n]*)\]/gm, (_m, head: string, items: string) =>
      `${head}${items.replace(/(^|,)(\s*)(@[^\s,\]"']+)/g, '$1$2"$3"')}]`,
    )
    .replace(/^(\s*-[ \t]+)(@[^\s#"']+)[ \t]*$/gm, '$1"$2"');
}

/** Splits leading YAML frontmatter. Returns the number of lines it occupied. */
export function splitFrontmatter(content: string, parse = true): { data: Record<string, unknown>; lines: number } {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { data: {}, lines: 0 };
  const lines = m[0].split(/\r?\n/).length - (m[0].endsWith("\n") ? 1 : 0);
  if (!parse) return { data: {}, lines };
  let data: Record<string, unknown> = {};
  try {
    const parsed = parseYaml(quoteMentions(m[1]));
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
  return s
    .replace(DUE_RE, "")
    .replace(REMIND_RE, "")
    .replace(WAITING_RE, "")
    .replace(SINCE_RE, "")
    .replace(DONE_RE, "")
    .replace(/\s{2,}/g, " ")
    .trim();
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

  const chart: ChartItem[] = [];
  const hasChart = kind === "client" || kind === "project";
  let section = "";

  const snippets: Snippet[] = [];
  let fence: { line: number; lang: string; code: string[]; title?: string } | null = null;
  // the hours line whose indented children we're collecting
  let block: { entry: HoursEntry; indent: number } | null = null;

  for (let i = fmLines; i < lines.length; i++) {
    const line = lines[i];
    const f = line.match(/^\s*(?:```|~~~)\s*([\w+#.-]*)/);
    if (f) {
      if (!fence) {
        let j = i - 1;
        while (j >= fmLines && !lines[j].trim()) j--;
        const prev = j >= fmLines ? lines[j].trim() : "";
        const title = prev && !/^(#|[-*+]\s|```|~~~|---)/.test(prev) ? prev.replace(/[:*_`]+$/g, "").replace(/^[*_]+/, "").trim() : undefined;
        fence = { line: i, lang: f[1].toLowerCase(), code: [], title };
      } else {
        if (hasChart) snippets.push({ file: path, line: fence.line, section, lang: fence.lang, code: fence.code.join("\n"), title: fence.title });
        fence = null;
      }
      continue;
    }
    if (fence) {
      fence.code.push(line);
      continue;
    }
    if (!title) {
      const h = line.match(/^#\s+(.+)$/);
      if (h) title = h[1].trim();
    }
    // bullets indented under an hours line are what was done for that project that day
    if (block && line.trim()) {
      const child = indentOf(line) > block.indent ? line.match(BULLET_RE) : null;
      if (child) {
        block.entry.end = i;
        const ct = line.match(TASK_RE);
        // plain bullets and ticked tasks count as work done; open or carried-over tasks don't
        const text = ct ? (/[xX]/.test(ct[2]) ? stripTokens(ct[3]) : "") : stripTokens(child[1]);
        if (text) block.entry.items.push(text);
      } else block = null;
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
      const w = tokens.match(WAITING_RE);
      const since = tokens.match(SINCE_RE)?.[1];
      const doneOn = tokens.match(DONE_RE)?.[1];
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
        // explicit @waiting(Name), else a person named on the task ("send the deck @Jordan")
        waiting: w ? (w[1]?.trim() || text.match(/^([^:]{1,40}):\s/)?.[1].trim() || "") : tokens.match(OWNER_RE)?.[1],
        since: isISODate(since) ? since : date,
        doneOn: isISODate(doneOn) ? doneOn : undefined,
      };
      tasks.push(task);
      if (remind) reminders.push({ file: path, line: i, text, rule: remind, taskStatus: task.status });
      continue;
    }

    const h = scan.match(HOURS_RE);
    // "- 6h @key …" always; a bare "- @key" (hours to fill in later) only when nothing follows it
    if (h && (h[2] || h[3] || !h[5].trim())) {
      const amount = (h[2] ? Number(h[2]) : 0) + (h[3] ? Number(h[3]) / 60 : 0);
      if (date) {
        const description = line.match(HOURS_RE)?.[5].trim() ?? "";
        const entry: HoursEntry = {
          file: path,
          line: i,
          end: i,
          date,
          hours: amount,
          client: h[4].toLowerCase(),
          description,
          items: description ? [stripTokens(description)] : [],
        };
        hours.push(entry);
        block = { entry, indent: indentOf(line) };
      }
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      section = heading[1].length === 1 ? "" : heading[2];
      continue;
    }

    const b = line.match(BULLET_RE);
    const remindSpec = scan.match(REMIND_RE)?.[1];
    if (b && remindSpec) {
      const rule = parseRemind(remindSpec, kind === "reminders" ? undefined : date);
      if (rule) reminders.push({ file: path, line: i, text: stripTokens(b[1]), rule });
      continue;
    }
    if (b && hasChart && b[1].trim()) {
      chart.push({ file: path, line: i, section, indent: line.length - line.trimStart().length, ...parseChartItem(b[1].trim()) });
    }
  }

  const body = lines.slice(fmLines).join("\n").trim();
  if (!title && kind === "flag") title = body.split("\n")[0].replace(/^[#\-*\s]+/, "").slice(0, 80);

  return {
    path,
    kind,
    title: title || basename(path),
    date,
    frontmatter,
    content,
    body,
    mtime,
    tasks,
    hours,
    reminders,
    chart,
    snippets,
    links: [...links],
    tags: [...tags],
  };
}

const URL_RE = /\bhttps?:\/\/[^\s<>()`"']+[^\s<>()`"'.,;:!?]/;

/**
 * One line of a client/project Chart: "- Label: value", "- [Label](url)" or just "- value".
 * Backticks around the value are dropped so copy gives the bare text.
 */
export function parseChartItem(text: string): { label?: string; value: string; url?: string } {
  const md = text.match(/^\[([^\]]+)\]\((\S+?)\)\s*$/);
  if (md) return { label: md[1], value: md[2], url: URL_RE.test(md[2]) ? md[2] : undefined };
  const kv = text.match(/^([^:`]{1,60}?):\s+(.+)$/);
  const label = kv ? kv[1].trim() : undefined;
  const value = (kv ? kv[2] : text).trim().replace(/^`([^`]*)`$/, "$1").replace(/^<(.+)>$/, "$1");
  return { label, value, url: value.match(URL_RE)?.[0] };
}

/** Level 2+ headings in document order (outside code fences). */
/** Headings (# to ######) with their level and 0-based line, outside code blocks and frontmatter. */
export function outlineOf(content: string): { level: number; text: string; line: number }[] {
  const out: { level: number; text: string; line: number }[] = [];
  const lines = content.split(/\r?\n/);
  const { lines: fm } = splitFrontmatter(content, false);
  let inFence = false;
  for (let i = fm; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) inFence = !inFence;
    const m = !inFence && lines[i].match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (m && m[2]) out.push({ level: m[1].length, text: m[2], line: i });
  }
  return out;
}

export function headingsOf(content: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const line of content.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = !inFence && line.match(/^#{2,6}\s+(.*?)\s*#*\s*$/);
    if (m) out.push(m[1]);
  }
  return out;
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

/**
 * Set (or with value undefined, remove) one top-level frontmatter key, editing
 * lines in place so the rest of the file's formatting is untouched.
 */
export function setFrontmatterField(content: string, key: string, value: string | number | undefined): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const { lines: fmLines } = splitFrontmatter(content, false);
  const entry = value === undefined ? [] : [`${key}: ${value}`];
  if (fmLines === 0) {
    return entry.length ? ["---", ...entry, "---", ...lines].join(eol) : content;
  }
  const close = fmLines - 1;
  const idx = lines.slice(1, close).findIndex((l) => l.startsWith(`${key}:`));
  if (idx === -1) lines.splice(close, 0, ...entry);
  else lines.splice(idx + 1, 1, ...entry);
  return lines.join(eol);
}

/** A YAML scalar for a frontmatter value, quoted when plain text would be misread ("Acme: EU", "#1", "yes"). */
export function yamlScalar(v: string | number): string {
  if (typeof v === "number") return String(v);
  const plain = /^[^\s#&*!|>'"%@`\[\]{},?:-][^#]*$/.test(v) && !/:\s|\s$/.test(v) && !/^(true|false|yes|no|null|~|on|off|-?\d[\d.]*)$/i.test(v);
  return plain ? v : JSON.stringify(v);
}

/** Replace everything after the frontmatter. */
export function replaceBody(content: string, body: string): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const { lines: fmLines } = splitFrontmatter(content, false);
  const text = body.replace(/\r?\n/g, eol).trimEnd();
  return [...lines.slice(0, fmLines), text, ""].join(eol);
}
