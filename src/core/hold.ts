import { ISODate, addDays, hhmm, today as todayISO } from "./dates";
import { HoldFs } from "./fs";
import {
  ChartItem,
  HOURS_RE,
  HoursEntry,
  ParsedFile,
  Reminder,
  Task,
  TaskStatus,
  appendToSection,
  basename,
  parseFile,
  replaceBody,
  setFrontmatterField,
  setTaskChar,
  yamlScalar,
} from "./parse";
import { occursOn } from "./schedule";
import { DEFAULT_REMINDERS, DEFAULT_TEMPLATES, WELCOME_NOTE, fillTemplate, safeFileName, slugify } from "./templates";

export const FLAG_COLORS = ["yellow", "orange", "pink", "blue", "green", "purple"] as const;
export type FlagColor = (typeof FLAG_COLORS)[number];

export interface Client {
  key: string;
  name: string;
  path?: string;
}

export interface Agenda {
  overdue: Task[];
  today: Task[];
  reminders: Reminder[];
  upcoming: Task[];
  open: Task[];
}

export interface ClientTotal {
  client: Client;
  hours: number;
  /** Hours per project key ("" = not tied to a project) */
  byProject: { key: string; name: string; hours: number }[];
}

/** An hours line with its @key resolved to client (+ project). */
export interface TimesheetEntry extends HoursEntry {
  project?: string;
}

export interface Timesheet {
  entries: TimesheetEntry[];
  byClient: ClientTotal[];
  byDay: Map<ISODate, number>;
  totalHours: number;
}

export interface SearchHit {
  path: string;
  title: string;
  line: number;
  snippet: string;
}

/**
 * The Hold: a folder of markdown files plus an in-memory index of them.
 * Files on disk are the only source of truth; the index is rebuilt from them.
 */
export class Hold {
  files = new Map<string, ParsedFile>();

  constructor(public fs: HoldFs) {}

  /** Create the folder skeleton on first use. */
  async init(): Promise<void> {
    const seed: Record<string, string> = {
      ...DEFAULT_TEMPLATES,
      "reminders.md": DEFAULT_REMINDERS,
      "notes/Welcome to Keel.md": WELCOME_NOTE,
    };
    const listing = await this.fs.list();
    const fresh = listing.length === 0;
    for (const [path, content] of Object.entries(seed)) {
      if (path.startsWith("notes/") && !fresh) continue;
      if (!(await this.fs.exists(path))) await this.fs.write(path, content);
    }
    await this.reindex();
  }

  /** Re-read files whose mtime changed; drop deleted ones. Returns true if anything changed. */
  async reindex(): Promise<boolean> {
    const listing = await this.fs.list();
    const seen = new Set<string>();
    let changed = false;
    for (const { path, mtime } of listing) {
      seen.add(path);
      const cur = this.files.get(path);
      if (cur && cur.mtime === mtime) continue;
      this.files.set(path, parseFile(path, await this.fs.read(path), mtime));
      changed = true;
    }
    for (const path of [...this.files.keys()]) {
      if (!seen.has(path)) {
        this.files.delete(path);
        changed = true;
      }
    }
    return changed;
  }

  get(path: string): ParsedFile | undefined {
    return this.files.get(path);
  }

  all(): ParsedFile[] {
    return [...this.files.values()];
  }

  /** Write a file and update its index entry. */
  async save(path: string, content: string): Promise<void> {
    await this.fs.write(path, content);
    await this.refresh(path);
  }

  async refresh(path: string): Promise<void> {
    const entry = (await this.fs.list()).find((f) => f.path === path);
    if (entry) this.files.set(path, parseFile(path, await this.fs.read(path), entry.mtime));
    else this.files.delete(path);
  }

  async remove(path: string): Promise<void> {
    await this.fs.remove(path);
    this.files.delete(path);
  }

  // ---------- paths & creation ----------

  logPath(date: ISODate): string {
    return `logs/${date.slice(0, 4)}/${date}.md`;
  }

  private async template(name: string): Promise<string> {
    const path = `templates/${name}.md`;
    return (await this.fs.exists(path)) ? this.fs.read(path) : DEFAULT_TEMPLATES[path] ?? "";
  }

  /** Path that doesn't exist yet: "x.md", "x 2.md", "x 3.md", … */
  private async freePath(dir: string, name: string): Promise<string> {
    const base = safeFileName(name) || "Untitled";
    for (let n = 1; ; n++) {
      const p = `${dir}/${n === 1 ? base : `${base} ${n}`}.md`;
      if (!(await this.fs.exists(p))) return p;
    }
  }

  /**
   * Open (creating if needed) the log for a date. Creating today's log carries
   * over top-level open tasks from the most recent earlier log and marks them [>].
   */
  async ensureLog(date: ISODate, today: ISODate = todayISO()): Promise<string> {
    // concurrent calls for the same day share one creation (no double migration)
    const pending = this.creatingLog.get(date);
    if (pending) return pending;
    const p = this.createLog(date, today).finally(() => this.creatingLog.delete(date));
    this.creatingLog.set(date, p);
    return p;
  }

  private creatingLog = new Map<ISODate, Promise<string>>();

  private async createLog(date: ISODate, today: ISODate): Promise<string> {
    const path = this.logPath(date);
    if (!(await this.fs.exists(path))) await this.save(path, fillTemplate(await this.template("log"), { date }));
    // Runs on every open of today's log, not just creation, so a log made early
    // (by browsing ahead) still receives the carry-over. Repeating it is harmless:
    // carried tasks are marked [>] in the old log.
    if (date === today) await this.carryOver(path, date);
    return path;
  }

  /** Move open top-level tasks from the most recent earlier log into this one. */
  private async carryOver(path: string, date: ISODate): Promise<void> {
    const prev = this.all()
      .filter((f) => f.kind === "log" && f.date && f.date < date)
      .sort((a, b) => (a.date! < b.date! ? 1 : -1))[0];
    const carry = prev?.tasks.filter((t) => t.status === "open" && t.indent === 0) ?? [];
    if (!prev || !carry.length) return;
    const prevLines = (await this.fs.read(prev.path)).split(/\r?\n/);
    const moved: string[] = [];
    for (const t of carry) {
      if (prevLines[t.line] !== t.raw) continue;
      // waiting items keep their original date so "days waiting" doesn't reset each morning
      const keepDate = t.waiting !== undefined && !/@since\(/.test(t.raw) && t.since;
      moved.push(keepDate ? `${t.raw} @since(${t.since})` : t.raw);
      prevLines[t.line] = setTaskChar(t.raw, "migrated");
    }
    if (!moved.length) return;
    // write the new copies first: if anything fails, tasks are duplicated rather than lost
    await this.appendTo(path, "Tasks", moved.join("\n"));
    await this.save(prev.path, prevLines.join(prev.content.includes("\r\n") ? "\r\n" : "\n"));
  }

  async createMeeting(title: string, date: ISODate = todayISO(), client?: string): Promise<string> {
    const path = await this.freePath("meetings", `${date} ${title}`);
    const content = fillTemplate(await this.template("meeting"), { date, title, client });
    await this.save(path, client ? setFrontmatterField(content, "client", client) : content);
    return path;
  }

  async createNote(title: string, folder = "notes", client?: string): Promise<string> {
    const path = await this.freePath(folder, title);
    const content = fillTemplate(await this.template("note"), { date: todayISO(), title, client });
    await this.save(path, client ? setFrontmatterField(content, "client", client) : content);
    return path;
  }

  async createClient(name: string): Promise<string> {
    const path = `clients/${slugify(name)}.md`;
    if (!(await this.fs.exists(path))) {
      await this.save(path, fillTemplate(await this.template("client"), { date: todayISO(), title: name }));
    }
    return path;
  }

  async createProject(name: string, client: string): Promise<string> {
    const path = await this.freePath("projects", name);
    await this.save(path, fillTemplate(await this.template("project"), { date: todayISO(), title: name, client }));
    return path;
  }

  // ---------- daily work blocks ("- 6h @project" with done items indented under it) ----------

  /** Log hours and/or a done item against a project for a day; adds to the day's block if there is one. */
  async logWork(date: ISODate, key: string, add: { hours?: number; item?: string }): Promise<void> {
    const path = await this.ensureLog(date);
    const k = key.replace(/^@/, "").toLowerCase();
    const block = this.get(path)?.hours.find((h) => h.client === k);
    if (block) {
      if (add.hours) await this.setWorkHours(block, block.hours + add.hours);
      if (add.item) await this.addWorkItem(this.get(path)!.hours.find((h) => h.client === k)!, add.item);
      return;
    }
    const head = add.hours ? `- ${round2(add.hours)}h @${k}` : `- @${k}`;
    const content = await this.fs.read(path);
    await this.appendTo(path, workHeading(content), add.item ? `${head}\n  - ${add.item}` : head);
  }

  /** Rewrite a block's hours (0 leaves "- @key" to fill in later). */
  async setWorkHours(entry: HoursEntry, hours: number): Promise<void> {
    await this.editLines(entry.file, (lines) => {
      const m = lines[entry.line]?.match(HOURS_RE);
      if (!m) throw new Error("That hours line changed on disk; reopen the log and try again.");
      const dur = hours > 0 ? `${round2(hours)}h ` : "";
      lines[entry.line] = `${m[1]}- ${dur}@${m[4]}${m[5] ? ` ${m[5]}` : ""}`;
    });
  }

  /** Add a done item under a block (after its last child). */
  async addWorkItem(entry: HoursEntry, text: string): Promise<void> {
    await this.editLines(entry.file, (lines) => {
      const m = lines[entry.line]?.match(HOURS_RE);
      if (!m) throw new Error("That hours line changed on disk; reopen the log and try again.");
      lines.splice(entry.end + 1, 0, `${m[1]}  - ${text.trim()}`);
    });
  }

  private async editLines(path: string, edit: (lines: string[]) => void): Promise<void> {
    const content = await this.fs.read(path);
    const eol = content.includes("\r\n") ? "\r\n" : "\n";
    const lines = content.split(/\r?\n/);
    edit(lines);
    await this.save(path, lines.join(eol));
  }

  /** The client and (if any) project a task's work counts toward. */
  taskProject(t: Task): { client: string; project?: string } | undefined {
    const f = this.files.get(t.file);
    if (f?.kind === "project") {
      const client = this.fileClient(f);
      return client ? { client, project: slugify(basename(f.path)) } : undefined;
    }
    const clients = this.clients();
    for (const tag of t.tags) {
      if (tag.includes("/") || this.projectByKey(tag)) return this.resolveHours(tag);
      if (clients.has(tag)) return { client: tag };
    }
    const c = this.taskClient(t);
    return c ? { client: c } : undefined;
  }

  /** Set or clear several frontmatter fields of one file. */
  async updateFrontmatter(path: string, fields: Record<string, string | number | undefined>): Promise<void> {
    let content = await this.fs.read(path);
    for (const [k, v] of Object.entries(fields)) {
      content = setFrontmatterField(content, k, v === undefined || v === "" ? undefined : yamlScalar(v));
    }
    await this.save(path, content);
  }

  /** Projects whose frontmatter names this client key. */
  projectsOf(clientKey: string): ParsedFile[] {
    return this.all()
      .filter((f) => f.kind === "project" && String(f.frontmatter.client ?? "").toLowerCase() === clientKey)
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  /** Every Chart item across clients and projects matching a query (label, value, section or file title). */
  chartSearch(query: string, client?: string, limit = 200): { item: ChartItem; file: ParsedFile }[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const out: { item: ChartItem; file: ParsedFile }[] = [];
    for (const file of this.all()) {
      if (client && this.fileClient(file) !== client) continue;
      for (const item of file.chart) {
        const hay = `${item.label ?? ""} ${item.value} ${item.section} ${file.title}`.toLowerCase();
        if (words.every((w) => hay.includes(w))) out.push({ item, file });
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  // ---------- flags ----------

  /** Flags still flying (not lowered), oldest first. With a client: that client's flags plus unassigned ones. */
  flags(client?: string): ParsedFile[] {
    return this.all()
      .filter((f) => f.kind === "flag" && !f.frontmatter.lowered && (!client || !this.fileClient(f) || this.fileClient(f) === client))
      .sort((a, b) => String(a.frontmatter.created ?? "").localeCompare(String(b.frontmatter.created ?? "")) || a.mtime - b.mtime);
  }

  loweredFlags(): ParsedFile[] {
    return this.all()
      .filter((f) => f.kind === "flag" && !!f.frontmatter.lowered)
      .sort((a, b) => String(b.frontmatter.lowered).localeCompare(String(a.frontmatter.lowered)));
  }

  async hoistFlag(text: string, color: FlagColor = "yellow", client?: string): Promise<string> {
    const words = text.split(/\s+/).slice(0, 6).join(" ");
    const path = await this.freePath("flags", `${todayISO()} ${words}`);
    const created = `${todayISO()} ${hhmm(new Date())}`;
    const clientLine = client ? `client: ${client}\n` : "";
    await this.save(path, `---\ncolor: ${color}\ncreated: ${created}\n${clientLine}---\n${text.trim()}\n`);
    return path;
  }

  async updateFlag(path: string, change: { body?: string; color?: FlagColor; lowered?: boolean }): Promise<void> {
    let content = await this.fs.read(path);
    if (change.body !== undefined) content = replaceBody(content, change.body);
    if (change.color) content = setFrontmatterField(content, "color", change.color);
    if (change.lowered !== undefined) content = setFrontmatterField(content, "lowered", change.lowered ? todayISO() : undefined);
    await this.save(path, content);
  }

  /** Append lines to a section of a file (creating today's log if that's the target). */
  async appendTo(path: string, heading: string, text: string): Promise<void> {
    const content = await this.fs.read(path);
    await this.save(path, appendToSection(content, heading, text));
  }

  async setTaskStatus(task: Task, status: TaskStatus): Promise<void> {
    const content = await this.fs.read(task.file);
    const eol = content.includes("\r\n") ? "\r\n" : "\n";
    const lines = content.split(/\r?\n/);
    let i = lines[task.line] === task.raw ? task.line : lines.indexOf(task.raw);
    if (i === -1) throw new Error("That task changed on disk; reopen the file and try again.");
    let line = setTaskChar(lines[i], status).replace(/\s*@done\(\d{4}-\d{2}-\d{2}\)/, "");
    if (status === "done") line += ` @done(${todayISO()})`;
    lines[i] = line;
    await this.save(task.file, lines.join(eol));
  }

  // ---------- client attribution ----------

  /** A project by its key: the slug of its file name ("Portal rebuild.md" → "portal-rebuild"). */
  projectByKey(key: string): ParsedFile | undefined {
    return this.all().find((f) => f.kind === "project" && slugify(basename(f.path)) === key);
  }

  /** Which client a file belongs to: the client file itself, or a `client:` in frontmatter. */
  fileClient(f: ParsedFile): string | undefined {
    if (f.kind === "client") return basename(f.path).toLowerCase();
    const c = typeof f.frontmatter.client === "string" ? f.frontmatter.client.trim().toLowerCase() : "";
    return c || undefined;
  }

  /** A task's client: from its file, else a #tag naming a client or project. */
  taskClient(t: Task): string | undefined {
    const f = this.files.get(t.file);
    const fromFile = f && this.fileClient(f);
    if (fromFile) return fromFile;
    const clients = this.clients();
    for (const tag of t.tags) {
      const root = tag.split("/")[0];
      if (clients.has(root)) return root;
      const p = this.projectByKey(root);
      if (p) return this.fileClient(p);
    }
    return undefined;
  }

  /** "@contoso/portal", "@portal" (a project key) or "@contoso" → client and optional project key. */
  resolveHours(key: string): { client: string; project?: string } {
    const [c, p] = key.split("/");
    if (p) return { client: c, project: p };
    const proj = this.projectByKey(c);
    if (proj) return { client: this.fileClient(proj) ?? c, project: c };
    return { client: c };
  }

  projectName(key: string): string {
    return this.projectByKey(key)?.title ?? key;
  }

  /** Open tasks marked @waiting, oldest first. */
  waitingOn(client?: string): Task[] {
    return this.tasks()
      .filter((t) => t.status === "open" && t.waiting !== undefined && (!client || this.taskClient(t) === client))
      .sort((a, b) => (a.since ?? "").localeCompare(b.since ?? ""));
  }

  // ---------- links ----------

  /** Resolve a [[link]] target to a file path (by basename or title, case-insensitive). */
  resolveLink(target: string): string | undefined {
    const t = target.trim().toLowerCase().replace(/\.md$/, "");
    const files = this.all().filter((f) => f.kind !== "template");
    return (
      files.find((f) => f.path.toLowerCase().replace(/\.md$/, "") === t)?.path ??
      files.find((f) => basename(f.path).toLowerCase() === t)?.path ??
      files.find((f) => f.title.toLowerCase() === t)?.path
    );
  }

  backlinks(path: string): ParsedFile[] {
    const target = this.files.get(path);
    if (!target) return [];
    return this.all().filter((f) => f.path !== path && f.links.some((l) => this.resolveLink(l) === path));
  }

  // ---------- queries ----------

  tasks(): Task[] {
    return this.all()
      .filter((f) => f.kind !== "template")
      .flatMap((f) => f.tasks);
  }

  clients(): Map<string, Client> {
    const out = new Map<string, Client>();
    for (const f of this.all()) {
      if (f.kind !== "client") continue;
      const key = basename(f.path).toLowerCase();
      const fm = f.frontmatter;
      out.set(key, {
        key,
        name: typeof fm.name === "string" && fm.name ? fm.name : f.title,
        path: f.path,
      });
    }
    return out;
  }

  /** Waiting items live on their own list, so the agenda leaves them out unless they have a due date. */
  agenda(today: ISODate = todayISO(), horizonDays = 14, client?: string): Agenda {
    const open = this.tasks().filter(
      (t) => t.status === "open" && (t.waiting === undefined || t.due) && (!client || this.taskClient(t) === client),
    );
    const todayLog = this.logPath(today);
    const horizon = addDays(today, horizonDays);
    const byDue = (a: Task, b: Task) => (a.due! < b.due! ? -1 : a.due! > b.due! ? 1 : 0);
    const isToday = (t: Task) => t.due === today || (!t.due && t.file === todayLog);
    return {
      overdue: open.filter((t) => t.due && t.due < today).sort(byDue),
      today: open.filter(isToday),
      reminders: this.remindersOn(today),
      upcoming: open.filter((t) => t.due && t.due > today && t.due <= horizon).sort(byDue),
      open: open.filter((t) => !t.due && !isToday(t)),
    };
  }

  /** Reminders that fire on a date, sorted by time, excluding finished tasks. */
  remindersOn(date: ISODate): Reminder[] {
    return this.all()
      .filter((f) => f.kind !== "template")
      .flatMap((f) => f.reminders)
      .filter((r) => (r.taskStatus === undefined || r.taskStatus === "open") && occursOn(r.rule, date))
      .sort((a, b) => (a.rule.time < b.rule.time ? -1 : a.rule.time > b.rule.time ? 1 : 0));
  }

  timesheet(from: ISODate, to: ISODate, onlyClient?: string): Timesheet {
    const clients = this.clients();
    const entries: TimesheetEntry[] = this.all()
      .flatMap((f) => f.hours)
      .filter((h) => h.date >= from && h.date <= to)
      .map((h) => {
        const r = this.resolveHours(h.client);
        return { ...h, client: r.client, project: r.project };
      })
      .filter((e) => !onlyClient || e.client === onlyClient)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.line - b.line));
    const totals = new Map<string, ClientTotal>();
    const byDay = new Map<ISODate, number>();
    for (const e of entries) {
      const client = clients.get(e.client) ?? { key: e.client, name: e.client };
      const t = totals.get(e.client) ?? { client, hours: 0, byProject: [] };
      t.hours += e.hours;
      const pk = e.project ?? "";
      let p = t.byProject.find((x) => x.key === pk);
      if (!p) {
        p = { key: pk, name: pk ? this.projectName(pk) : "", hours: 0 };
        t.byProject.push(p);
      }
      p.hours += e.hours;
      totals.set(e.client, t);
      byDay.set(e.date, (byDay.get(e.date) ?? 0) + e.hours);
    }
    for (const t of totals.values()) t.byProject.sort((a, b) => b.hours - a.hours);
    return {
      entries,
      byClient: [...totals.values()].sort((a, b) => b.hours - a.hours),
      byDay,
      totalHours: entries.reduce((s, e) => s + e.hours, 0),
    };
  }

  timesheetCsv(ts: Timesheet): string {
    const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const rows = [["date", "client", "project", "hours", "work done", "file"].join(",")];
    for (const e of ts.entries) {
      rows.push([e.date, q(e.client), q(e.project ? this.projectName(e.project) : ""), round2(e.hours), q(e.items.join("; ")), q(e.file)].join(","));
    }
    return rows.join("\r\n") + "\r\n";
  }

  /** Plain text search; a query like "#tag" matches tagged files. */
  search(query: string, limit = 200): SearchHit[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits: SearchHit[] = [];
    const files = this.all()
      .filter((f) => f.kind !== "template")
      .sort((a, b) => b.mtime - a.mtime);
    if (/^#[\w/-]+$/.test(q)) {
      const tag = q.slice(1);
      for (const f of files) if (f.tags.includes(tag)) hits.push({ path: f.path, title: f.title, line: 0, snippet: "" });
      return hits.slice(0, limit);
    }
    for (const f of files) {
      const lines = f.content.split(/\r?\n/);
      const titleHit = f.title.toLowerCase().includes(q);
      let found = false;
      lines.forEach((l, i) => {
        if (hits.length < limit && l.toLowerCase().includes(q)) {
          hits.push({ path: f.path, title: f.title, line: i, snippet: l.trim().slice(0, 200) });
          found = true;
        }
      });
      if (titleHit && !found) hits.push({ path: f.path, title: f.title, line: 0, snippet: "" });
      if (hits.length >= limit) break;
    }
    return hits;
  }
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Section that holds a log's work blocks: "Work" in new logs, "Hours" in older ones. */
export function workHeading(content: string): string {
  if (/^#{1,6}\s+work\s*$/im.test(content)) return "Work";
  if (/^#{1,6}\s+hours\s*$/im.test(content)) return "Hours";
  return "Work";
}
