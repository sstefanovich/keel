import { CLAUDE_GUIDE, PREVIOUS_GUIDES } from "./claudeGuide";
import { STATUS_REPORT_SKILL, TIMECARD_SKILL } from "./claudeSkills";
import { ISODate, addDays, hhmm, toISO, today as todayISO } from "./dates";
import { HoldFs } from "./fs";
import {
  ChartItem,
  FileKind,
  HOURS_RE,
  HoursEntry,
  PERSONAL,
  Space,
  spaceOf,
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
import { DEFAULT_REMINDERS, DEFAULT_TEMPLATES, OLD_TEMPLATES, WELCOME_NOTE, fillTemplate, safeFileName, slugify } from "./templates";

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

/** Narrowing a search: file types, one client or project, and a date range (inclusive). */
export interface SearchFilter {
  kinds?: FileKind[];
  /** Only this space (both when unset) */
  space?: Space;
  client?: string;
  project?: string;
  from?: ISODate;
  to?: ISODate;
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
/** Seeded files that are replaced when still identical to an earlier default */
const UPGRADES: Record<string, string[]> = { ...OLD_TEMPLATES, "CLAUDE.md": PREVIOUS_GUIDES };

export class Hold {
  files = new Map<string, ParsedFile>();

  constructor(public fs: HoldFs) {}

  /** Create the folder skeleton on first use. */
  /** Index the hold; with `seed`, first write the default templates and guide files that are missing. */
  async init(seedFiles = true): Promise<void> {
    if (!seedFiles) {
      await this.reindex();
      await this.loadPins();
      return;
    }
    const seed: Record<string, string> = {
      ...DEFAULT_TEMPLATES,
      "reminders.md": DEFAULT_REMINDERS,
      "CLAUDE.md": CLAUDE_GUIDE,
      // Claude fills these in with the owner on first use, so they're never replaced
      ".claude/skills/timecard/SKILL.md": TIMECARD_SKILL,
      ".claude/skills/status-report/SKILL.md": STATUS_REPORT_SKILL,
      "notes/Welcome to Keel.md": WELCOME_NOTE,
    };
    const listing = await this.fs.list();
    const fresh = listing.length === 0;
    for (const [path, content] of Object.entries(seed)) {
      if (path.startsWith("notes/") && !fresh) continue;
      if (!(await this.fs.exists(path))) await this.fs.write(path, content);
      else if (UPGRADES[path]) {
        // an untouched copy of an older default gets the new one; edited copies are left alone
        const cur = (await this.fs.read(path)).replace(/\r\n/g, "\n");
        if (UPGRADES[path].includes(cur)) await this.fs.write(path, content);
      }
    }
    await this.reindex();
    await this.loadPins();
  }

  /** Re-read files whose mtime changed; drop deleted ones. Returns true if anything changed. */
  async reindex(): Promise<boolean> {
    // Keel's own saves must never look like outside edits: a reindex that overlaps one could
    // read a file just before the save writes it and put older text back in the index, which
    // makes an open editor "reload" under the cursor. So stage everything, and throw it away
    // if any save started or finished while this ran (the next poll picks up real changes).
    if (this.writing > 0) return false;
    const gen = this.writeGen;
    const listing = await this.fs.list();
    const updates = new Map<string, ParsedFile>();
    const seen = new Set<string>();
    for (const { path, mtime } of listing) {
      seen.add(path);
      const cur = this.files.get(path);
      if (cur && cur.mtime === mtime) continue;
      updates.set(path, parseFile(path, await this.fs.read(path), mtime));
      if (this.writeGen !== gen) return false;
    }
    if (this.writing > 0 || this.writeGen !== gen) return false;
    const removed = [...this.files.keys()].filter((p) => !seen.has(p));
    for (const [p, f] of updates) this.files.set(p, f);
    for (const p of removed) this.files.delete(p);
    return updates.size > 0 || removed.length > 0;
  }

  get(path: string): ParsedFile | undefined {
    return this.files.get(path);
  }

  all(): ParsedFile[] {
    return [...this.files.values()];
  }

  /** Write a file and update its index entry. */
  async save(path: string, content: string): Promise<void> {
    this.writing++;
    this.writeGen++;
    try {
      await this.fs.write(path, content);
      await this.refresh(path);
    } finally {
      this.writing--;
      this.writeGen++;
    }
  }

  /** Saves in progress; reindex waits for them. */
  private writing = 0;
  /** Bumped when any save starts or ends, so a reindex can tell it overlapped one. */
  private writeGen = 0;

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

  logPath(date: ISODate, space: Space = "work"): string {
    return `${space === "personal" ? PERSONAL : ""}logs/${date.slice(0, 4)}/${date}.md`;
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
  async ensureLog(date: ISODate, today: ISODate = todayISO(), space: Space = "work"): Promise<string> {
    // concurrent calls for the same day share one creation (no double migration)
    const key = `${space}:${date}`;
    const pending = this.creatingLog.get(key);
    if (pending) return pending;
    const p = this.createLog(date, today, space).finally(() => this.creatingLog.delete(key));
    this.creatingLog.set(key, p);
    return p;
  }

  private creatingLog = new Map<string, Promise<string>>();

  private async createLog(date: ISODate, today: ISODate, space: Space): Promise<string> {
    const path = this.logPath(date, space);
    if (!(await this.fs.exists(path))) await this.save(path, fillTemplate(await this.template(space === "personal" ? "personal-log" : "log"), { date }));
    // Runs on every open of today's log, not just creation, so a log made early
    // (by browsing ahead) still receives the carry-over. Repeating it is harmless:
    // carried tasks are marked [>] in the old log.
    if (date === today) await this.carryOver(path, date, space);
    return path;
  }

  /** Move open top-level tasks from the most recent earlier log (in the same space) into this one. */
  private async carryOver(path: string, date: ISODate, space: Space): Promise<void> {
    const prev = this.all()
      .filter((f) => f.kind === "log" && f.date && f.date < date && spaceOf(f.path) === space)
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

  /** A new meeting note; `extra` fills in what a calendar event knows (start time, attendees, project). */
  async createMeeting(
    title: string,
    date: ISODate = todayISO(),
    client?: string,
    extra: { time?: Date; attendees?: string[]; project?: string } = {},
  ): Promise<string> {
    const path = await this.freePath("meetings", `${date} ${title}`);
    let content = fillTemplate(await this.template("meeting"), { date, title, client, now: extra.time });
    if (extra.project) content = setFrontmatterField(content, "project", extra.project);
    else if (client) content = setFrontmatterField(content, "client", client);
    if (extra.attendees?.length) content = setFrontmatterField(content, "attendees", JSON.stringify(extra.attendees));
    await this.save(path, content);
    return path;
  }

  /** The meeting note for a date with this title, if one exists. */
  meetingNote(date: ISODate, title: string): ParsedFile | undefined {
    const want = title.trim().toLowerCase();
    return this.all().find(
      (f) => f.kind === "meeting" && f.date === date && f.title.replace(/^\d{4}-\d{2}-\d{2}\s+/, "").trim().toLowerCase() === want,
    );
  }

  /** The project (else client) a piece of text names, by name or key: "Hogan / FLIS sync" → that project. */
  guessOwner(text: string): { client?: string; project?: string } {
    const hay = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
    const has = (name: string) => {
      const n = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      return n.length >= 3 && hay.includes(` ${n} `) ? n.length : 0;
    };
    let best: { score: number; client?: string; project?: string } = { score: 0 };
    for (const p of this.all()) {
      if (p.kind !== "project" || String(p.frontmatter.status ?? "active") === "done") continue;
      const key = slugify(basename(p.path));
      const score = Math.max(has(p.title), has(key));
      if (score > best.score) best = { score, project: key, client: this.fileClient(p) };
    }
    if (best.project) return { client: best.client, project: best.project };
    for (const c of this.clients().values()) {
      const score = Math.max(has(c.name), has(c.key));
      if (score > best.score) best = { score, client: c.key };
    }
    return { client: best.client };
  }

  /** A new note; with a project it's tied to that project (and so to its client). */
  async createNote(title: string, folder = "notes", client?: string, project?: string): Promise<string> {
    const path = await this.freePath(folder, title);
    let content = fillTemplate(await this.template("note"), { date: todayISO(), title, client });
    if (project) content = setFrontmatterField(content, "project", project);
    else if (client) content = setFrontmatterField(content, "client", client);
    await this.save(path, content);
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

  // ---------- personal: lists and recipes ----------

  /** Checklists (Shopping, Gift ideas, …), most recently changed first. */
  lists(): ParsedFile[] {
    return this.all()
      .filter((f) => f.kind === "list")
      .sort((a, b) => b.mtime - a.mtime);
  }

  listPath(name: string): string {
    return `${PERSONAL}lists/${safeFileName(name) || "List"}.md`;
  }

  async createList(name: string): Promise<string> {
    const path = this.listPath(name);
    if (!(await this.fs.exists(path))) await this.save(path, `# ${name.trim()}\n\n`);
    return path;
  }

  /**
   * Add items to a list (created if needed), skipping any already on it and not ticked off.
   * Returns how many were added.
   */
  async addToList(name: string, items: string[]): Promise<number> {
    return this.addToListFile(await this.createList(name), items);
  }

  /** Add items to the list in this file (see addToList). */
  async addToListFile(path: string, items: string[]): Promise<number> {
    const have = new Set((this.get(path)?.tasks ?? []).filter((t) => t.status === "open").map((t) => t.text.toLowerCase()));
    const fresh: string[] = [];
    for (const raw of items) {
      const item = raw.replace(/^\s*(?:[-*+]\s+)?(?:\[[ xX]\]\s+)?/, "").trim();
      if (item && !have.has(item.toLowerCase())) {
        have.add(item.toLowerCase());
        fresh.push(`- [ ] ${item}`);
      }
    }
    if (!fresh.length) return 0;
    const content = (await this.fs.read(path)).replace(/\s+$/, "");
    await this.save(path, `${content}\n${fresh.join("\n")}\n`);
    return fresh.length;
  }

  /** Tick or untick a list item (no @done stamp: it's a shopping list, not a task log). */
  async toggleListItem(item: Task): Promise<void> {
    await this.editLines(item.file, (lines) => {
      if (lines[item.line] !== item.raw) throw new Error("That list changed; try again.");
      lines[item.line] = setTaskChar(item.raw, item.status === "done" ? "open" : "done");
    });
  }

  /** Remove ticked-off items from a list. Returns how many went. */
  async clearDone(path: string): Promise<number> {
    let n = 0;
    await this.editLines(path, (lines) => {
      const keep = lines.filter((l) => {
        const done = /^\s*[-*+] \[[xX]\]/.test(l);
        if (done) n++;
        return !done;
      });
      lines.splice(0, lines.length, ...keep);
    });
    return n;
  }

  recipes(): ParsedFile[] {
    return this.all()
      .filter((f) => f.kind === "recipe")
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  /** A recipe note from what a recipe page says (or just its title and link). */
  async createRecipe(r: { title: string; source?: string; ingredients?: string[]; steps?: string[]; servings?: string; time?: string; image?: string }): Promise<string> {
    const path = await this.freePath(`${PERSONAL}recipes`, r.title);
    const fm = ["---", `title: ${yamlScalar(r.title)}`];
    if (r.source) fm.push(`source: ${yamlScalar(r.source)}`);
    if (r.servings) fm.push(`servings: ${yamlScalar(r.servings)}`);
    if (r.time) fm.push(`time: ${yamlScalar(r.time)}`);
    if (r.image) fm.push(`image: ${yamlScalar(r.image)}`);
    fm.push(`created: ${todayISO()}`, "---");
    const body = [
      `# ${r.title}`,
      "",
      "## Ingredients",
      ...(r.ingredients?.length ? r.ingredients.map((i) => `- ${i}`) : ["- "]),
      "",
      "## Method",
      ...(r.steps?.length ? r.steps.map((s, i) => `${i + 1}. ${s}`) : ["1. "]),
      "",
      "## Notes",
      "",
    ];
    await this.save(path, [...fm, ...body].join("\n"));
    return path;
  }

  /** The bullet lines under a recipe's "## Ingredients" heading. */
  recipeIngredients(f: ParsedFile): string[] {
    const out: string[] = [];
    let inside = false;
    for (const line of f.content.split(/\r?\n/)) {
      if (/^#{1,6}\s/.test(line)) {
        inside = /^#{1,6}\s+ingredients\b/i.test(line);
        continue;
      }
      const m = inside && line.match(/^\s*[-*+]\s+(?:\[[ xX]\]\s+)?(.+)$/);
      if (m && m[1].trim()) out.push(m[1].trim());
    }
    return out;
  }

  /** Log meetings under a project: optionally add their hours, and list each title as a done item. */
  async logMeetings(date: ISODate, key: string, titles: string[], hours?: number): Promise<void> {
    if (!titles.length) return;
    await this.logWork(date, key, { hours, item: titles[0] });
    for (const t of titles.slice(1)) await this.logWork(date, key, { item: t });
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
    // in a project file, or a note/meeting with `project:` in its frontmatter
    const fileProj = f && this.fileProject(f);
    if (f && fileProj) {
      const client = this.fileClient(f);
      return client ? { client, project: fileProj } : undefined;
    }
    const clients = this.clients();
    for (const tag of t.tags) {
      if (tag.includes("/") || this.projectByKey(tag)) return this.resolveHours(tag);
      if (clients.has(tag)) return { client: tag };
    }
    // "@portal" works like "#portal", but only for known keys (@Jordan is a person)
    for (const key of t.mentions) {
      const [c, p] = key.split("/");
      if (this.projectByKey(p ?? c)) return this.resolveHours(key);
      if (!p && clients.has(c)) return { client: c };
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
      .filter((f) => f.kind === "project" && this.fileClient(f) === clientKey)
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
  flags(client?: string, space?: Space): ParsedFile[] {
    return this.all()
      .filter((f) => f.kind === "flag" && !f.frontmatter.lowered && (!space || spaceOf(f.path) === space))
      .filter((f) => !client || !this.fileClient(f) || this.fileClient(f) === client)
      .sort((a, b) => String(a.frontmatter.created ?? "").localeCompare(String(b.frontmatter.created ?? "")) || a.mtime - b.mtime);
  }

  loweredFlags(space?: Space): ParsedFile[] {
    return this.all()
      .filter((f) => f.kind === "flag" && !!f.frontmatter.lowered && (!space || spaceOf(f.path) === space))
      .sort((a, b) => String(b.frontmatter.lowered).localeCompare(String(a.frontmatter.lowered)));
  }

  async hoistFlag(text: string, color: FlagColor = "yellow", client?: string, space: Space = "work"): Promise<string> {
    const words = text.split(/\s+/).slice(0, 6).join(" ");
    const path = await this.freePath(space === "personal" ? `${PERSONAL}flags` : "flags", `${todayISO()} ${words}`);
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

  /** Add a line to the end of a note, found by name or title like a [[link]]; creates the note if needed. */
  async appendToNote(name: string, line: string): Promise<string> {
    const path = this.resolveLink(name) ?? (await this.createNote(name));
    const content = await this.fs.read(path);
    const eol = content.includes("\r\n") ? "\r\n" : "\n";
    await this.save(path, `${content.replace(/\s+$/, "")}${eol}${line}${eol}`);
    return path;
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
    const c = keyValue(f.frontmatter.client).split("/")[0];
    if (c) return c;
    // a note or meeting tied to a project belongs to that project's client
    // ("project: @client/project" names it directly)
    const raw = f.kind !== "project" ? keyValue(f.frontmatter.project) : "";
    if (raw.includes("/")) return raw.split("/")[0];
    const proj = raw ? this.projectByKey(raw) : undefined;
    return proj ? this.fileClient(proj) : undefined;
  }

  /** The project a file belongs to: the project file itself, or a `project:` key in frontmatter. */
  fileProject(f: ParsedFile): string | undefined {
    if (f.kind === "project") return slugify(basename(f.path));
    const p = keyValue(f.frontmatter.project);
    return (p.includes("/") ? p.split("/")[1] : p) || undefined;
  }

  /** Notes and meetings tied to a project with `project:` in their frontmatter, newest first. */
  notesOf(projectKey: string): ParsedFile[] {
    return this.all()
      .filter((f) => (f.kind === "note" || f.kind === "meeting") && this.fileProject(f) === projectKey)
      .sort((a, b) => (b.date ?? String(b.frontmatter.created ?? "")).localeCompare(a.date ?? String(a.frontmatter.created ?? "")) || b.mtime - a.mtime);
  }

  /** A task's client: from its file, else a #tag naming a client or project. */
  taskClient(t: Task): string | undefined {
    const f = this.files.get(t.file);
    const fromFile = f && this.fileClient(f);
    if (fromFile) return fromFile;
    const clients = this.clients();
    for (const tag of [...t.tags, ...t.mentions]) {
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

  /** The display name for "@client/project", "@project" or "@client", or undefined if it names neither. */
  keyName(key: string): string | undefined {
    const [c, p] = key.toLowerCase().split("/");
    const proj = this.projectByKey(p ?? c);
    if (proj) return proj.title;
    return this.clients().get(c)?.name;
  }

  /** Open tasks marked @waiting, oldest first. */
  waitingOn(client?: string, space?: Space): Task[] {
    return this.tasks(space)
      .filter((t) => t.status === "open" && t.waiting !== undefined && (!client || this.taskClient(t) === client))
      .sort((a, b) => (a.since ?? "").localeCompare(b.since ?? ""));
  }

  // ---------- organizing: pins, folders, move/rename, archive ----------

  /** Pinned file paths, kept in .keel/pins.json inside the hold so they travel with it. */
  pins: string[] = [];
  private renameListeners = new Set<(from: string, to: string) => void>();

  /** Called with each file's old and new path when files are renamed or moved. */
  onRename(cb: (from: string, to: string) => void): () => void {
    this.renameListeners.add(cb);
    return () => this.renameListeners.delete(cb);
  }

  private moved(pairs: [string, string][]) {
    if (!pairs.length) return;
    const map = new Map(pairs);
    this.pins = this.pins.map((p) => map.get(p) ?? p);
    for (const [from, to] of pairs) this.renameListeners.forEach((l) => l(from, to));
  }

  async loadPins(): Promise<void> {
    try {
      const raw = JSON.parse(await this.fs.read(PINS_PATH));
      this.pins = Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string") : [];
    } catch {
      this.pins = [];
    }
  }

  private async savePins() {
    await this.fs.write(PINS_PATH, JSON.stringify(this.pins, null, 2) + "\n");
  }

  isPinned(path: string): boolean {
    return this.pins.includes(path);
  }

  async setPinned(path: string, on: boolean): Promise<void> {
    this.pins = on ? [...this.pins.filter((p) => p !== path), path] : this.pins.filter((p) => p !== path);
    await this.savePins();
  }

  /** Every folder under notes/ (e.g. "notes/Clients/Hogan"), including empty ones. */
  async noteFolders(): Promise<string[]> {
    return (await this.fs.dirs()).filter((d) => d.startsWith("notes/")).sort((a, b) => a.localeCompare(b));
  }

  async createFolder(parent: string, name: string): Promise<string> {
    const clean = safeFileName(name);
    if (!clean) throw new Error("A folder needs a name.");
    const path = `${parent}/${clean}`;
    if (await this.fs.exists(path)) throw new Error(`“${clean}” already exists here.`);
    await this.fs.mkdir(path);
    return path;
  }

  async renameFolder(path: string, name: string): Promise<string> {
    const clean = safeFileName(name);
    if (!clean) throw new Error("A folder needs a name.");
    const to = `${path.split("/").slice(0, -1).join("/")}/${clean}`;
    if (to === path) return path;
    if (await this.fs.exists(to)) throw new Error(`“${clean}” already exists here.`);
    const inside = this.all().filter((f) => f.path.startsWith(`${path}/`)).map((f) => f.path);
    await this.fs.rename(path, to);
    await this.reindex();
    this.moved(inside.map((p) => [p, `${to}${p.slice(path.length)}`]));
    await this.savePins();
    return to;
  }

  /** Removes an empty folder (Keel never deletes notes this way). */
  async deleteFolder(path: string): Promise<void> {
    await this.fs.rmdir(path);
  }

  /** Move a file into a folder, keeping its name (links keep working: they match by name). */
  async moveFile(path: string, folder: string): Promise<string> {
    const from = path.split("/").slice(0, -1).join("/");
    if (from === folder) return path;
    const to = await this.freePath(folder, basename(path));
    await this.fs.rename(path, to);
    await this.refresh(path);
    await this.refresh(to);
    this.moved([[path, to]]);
    if (this.pins.includes(to)) await this.savePins();
    return to;
  }

  /**
   * Rename a note or meeting: the file, its # title (or frontmatter title) when it matched,
   * and every [[link]] to it elsewhere. Clients and projects can't be renamed: their file name
   * is their @tag, and logged hours point at it.
   */
  async renameFile(path: string, title: string): Promise<string> {
    const f = this.files.get(path);
    if (!f) throw new Error("That file no longer exists.");
    if (f.kind === "client" || f.kind === "project" || f.kind === "log") throw new Error(`A ${f.kind} can't be renamed.`);
    const newTitle = title.trim();
    if (!newTitle) throw new Error("A name can't be empty.");
    const dir = path.split("/").slice(0, -1).join("/");
    const oldBase = basename(path);
    // meetings keep their date prefix
    const datePrefix = f.kind === "meeting" ? oldBase.match(/^\d{4}-\d{2}-\d{2} /)?.[0] ?? "" : "";
    const newBase = safeFileName(datePrefix && !newTitle.startsWith(datePrefix.trim()) ? `${datePrefix}${newTitle}` : newTitle);
    const sameName = newBase === oldBase;
    const to = sameName ? path : await this.freePath(dir, newBase);
    const displayOld = f.title;
    const displayNew = newTitle.replace(/^\d{4}-\d{2}-\d{2}\s+/, "");

    // the file's own title
    let content = await this.fs.read(path);
    if (typeof f.frontmatter.title === "string" && f.frontmatter.title === displayOld) {
      content = setFrontmatterField(content, "title", yamlScalar(displayNew));
    }
    content = content.replace(/^#\s+(.+)$/m, (line, h: string) => (h.trim() === displayOld ? `# ${displayNew}` : line));
    await this.save(path, content);
    if (!sameName) {
      await this.fs.rename(path, to);
      await this.refresh(path);
      await this.refresh(to);
    }

    // links elsewhere: [[Old name]], [[Old title|label]], [[Old#heading]]
    const linkName = basename(to);
    const names = [...new Set([oldBase, displayOld])].filter((n) => n && n !== linkName);
    if (names.length) {
      const re = new RegExp(String.raw`\[\[\s*(?:${names.map(escapeRe).join("|")})\s*((?:#[^\]|]*)?)((?:\|[^\]]*)?)\]\]`, "gi");
      for (const other of this.all()) {
        if (other.kind === "template" || !other.content.includes("[[")) continue;
        const next = other.content.replace(re, (_m, hash: string, label: string) => `[[${linkName}${hash}${label}]]`);
        if (next !== other.content) await this.save(other.path, next);
      }
    }
    if (!sameName) {
      this.moved([[path, to]]);
      if (this.pins.includes(to)) await this.savePins();
    }
    return to;
  }

  /** Archive a note or meeting (archived: date in frontmatter), or mark a project done. */
  async setArchived(path: string, on: boolean): Promise<void> {
    const f = this.files.get(path);
    if (!f) return;
    if (f.kind === "project") return this.updateFrontmatter(path, { status: on ? "done" : "active" });
    await this.updateFrontmatter(path, { archived: on ? todayISO() : undefined });
  }

  isArchived(f: ParsedFile): boolean {
    return f.kind === "project" ? f.frontmatter.status === "done" : !!f.frontmatter.archived;
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

  /** Tasks (in one space, or both). List items and recipe lines are checklists, not tasks. */
  tasks(space?: Space): Task[] {
    return this.all()
      .filter((f) => f.kind !== "template" && f.kind !== "list" && f.kind !== "recipe" && (!space || spaceOf(f.path) === space))
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
  agenda(today: ISODate = todayISO(), horizonDays = 14, client?: string, space: Space = "work"): Agenda {
    const open = this.tasks(space).filter(
      (t) => t.status === "open" && (t.waiting === undefined || t.due) && (!client || this.taskClient(t) === client),
    );
    const todayLog = this.logPath(today, space);
    const horizon = addDays(today, horizonDays);
    const byDue = (a: Task, b: Task) => (a.due! < b.due! ? -1 : a.due! > b.due! ? 1 : 0);
    const isToday = (t: Task) => t.due === today || (!t.due && t.file === todayLog);
    return {
      overdue: open.filter((t) => t.due && t.due < today).sort(byDue),
      today: open.filter(isToday),
      reminders: this.remindersOn(today).filter((r) => spaceOf(r.file) === space),
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
      // hours are work: a personal log never reaches the timesheet
      .filter((f) => spaceOf(f.path) === "work")
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
  /** The date a file is "from" for search: its own date, else when it was created, else last saved. */
  fileDate(f: ParsedFile): ISODate {
    const created = String(f.frontmatter.created ?? "");
    return f.date ?? (/^\d{4}-\d{2}-\d{2}$/.test(created) ? created : toISO(new Date(f.mtime)));
  }

  search(query: string, limit = 200, filter: SearchFilter = {}): SearchHit[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits: SearchHit[] = [];
    const { kinds, client, project, from, to, space } = filter;
    // logs belong to no one, so there a line counts when it names the client or project
    const keys = project ? [project] : client ? [client, ...this.projectsOf(client).map((p) => slugify(basename(p.path)))] : [];
    const mentions = keys.length ? new RegExp(`[#@](?:${keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\w-])`, "i") : null;
    const owned = (f: ParsedFile) => (project ? this.fileProject(f) === project : client ? this.fileClient(f) === client : true);
    const files = this.all()
      .filter((f) => f.kind !== "template")
      .filter((f) => (!kinds?.length || kinds.includes(f.kind)) && (!space || spaceOf(f.path) === space))
      .filter((f) => (!from && !to) || ((!from || this.fileDate(f) >= from) && (!to || this.fileDate(f) <= to)))
      .filter((f) => !mentions || owned(f) || f.kind === "log")
      .sort((a, b) => b.mtime - a.mtime);
    // ...or sits in that project's (or client's) Work block
    const inBlock = (f: ParsedFile, i: number) =>
      f.hours.some((h) => {
        if (i < h.line || i > h.end) return false;
        const r = this.resolveHours(h.client);
        return project ? r.project === project : r.client === client;
      });
    const lineOk = (f: ParsedFile, line: string, i: number) => !mentions || owned(f) || mentions.test(line) || inBlock(f, i);
    if (/^#[\w/-]+$/.test(q)) {
      const tag = q.slice(1);
      for (const f of files) if (f.tags.includes(tag) && (owned(f) || !mentions || mentions.test(f.content))) hits.push({ path: f.path, title: f.title, line: 0, snippet: "" });
      return hits.slice(0, limit);
    }
    for (const f of files) {
      const lines = f.content.split(/\r?\n/);
      const titleHit = f.title.toLowerCase().includes(q) && owned(f);
      let found = false;
      lines.forEach((l, i) => {
        if (hits.length < limit && l.toLowerCase().includes(q) && lineOk(f, l, i)) {
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

/** A client/project key from frontmatter: "@Hogan-Lovells" → "hogan-lovells". */
function keyValue(v: unknown): string {
  return typeof v === "string" ? v.trim().replace(/^@/, "").toLowerCase() : "";
}

/** Where pins are stored, inside the hold (dot-folders aren't listed as notes). */
export const PINS_PATH = ".keel/pins.json";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
