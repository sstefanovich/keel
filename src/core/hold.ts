import { ISODate, addDays, today as todayISO } from "./dates";
import { HoldFs } from "./fs";
import { HoursEntry, ParsedFile, Reminder, Task, TaskStatus, appendToSection, basename, parseFile, setTaskChar } from "./parse";
import { occursOn } from "./schedule";
import { DEFAULT_REMINDERS, DEFAULT_TEMPLATES, WELCOME_NOTE, fillTemplate, safeFileName, slugify } from "./templates";

export interface Client {
  key: string;
  name: string;
  rate: number;
  currency: string;
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
  amount: number;
}

export interface Timesheet {
  entries: HoursEntry[];
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
    if (await this.fs.exists(path)) return path;
    let content = fillTemplate(await this.template("log"), { date });

    if (date === today) {
      const prev = this.all()
        .filter((f) => f.kind === "log" && f.date && f.date < date)
        .sort((a, b) => (a.date! < b.date! ? 1 : -1))[0];
      const carry = prev?.tasks.filter((t) => t.status === "open" && t.indent === 0) ?? [];
      if (prev && carry.length) {
        const prevLines = (await this.fs.read(prev.path)).split(/\r?\n/);
        const moved: string[] = [];
        for (const t of carry) {
          if (prevLines[t.line] !== t.raw) continue;
          moved.push(t.raw);
          prevLines[t.line] = setTaskChar(t.raw, "migrated");
        }
        if (moved.length) {
          content = appendToSection(content, "Tasks", moved.join("\n"));
          await this.save(prev.path, prevLines.join(prev.content.includes("\r\n") ? "\r\n" : "\n"));
        }
      }
    }
    await this.save(path, content);
    return path;
  }

  async createMeeting(title: string, date: ISODate = todayISO()): Promise<string> {
    const path = await this.freePath("meetings", `${date} ${title}`);
    await this.save(path, fillTemplate(await this.template("meeting"), { date, title }));
    return path;
  }

  async createNote(title: string, folder = "notes"): Promise<string> {
    const path = await this.freePath(folder, title);
    await this.save(path, fillTemplate(await this.template("note"), { date: todayISO(), title }));
    return path;
  }

  async createClient(name: string): Promise<string> {
    const path = `clients/${slugify(name)}.md`;
    if (!(await this.fs.exists(path))) {
      await this.save(path, fillTemplate(await this.template("client"), { date: todayISO(), title: name }));
    }
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
    lines[i] = setTaskChar(lines[i], status);
    await this.save(task.file, lines.join(eol));
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
        rate: Number(fm.rate) || 0,
        currency: typeof fm.currency === "string" ? fm.currency : "USD",
        path: f.path,
      });
    }
    return out;
  }

  agenda(today: ISODate = todayISO(), horizonDays = 14): Agenda {
    const open = this.tasks().filter((t) => t.status === "open");
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

  timesheet(from: ISODate, to: ISODate): Timesheet {
    const clients = this.clients();
    const entries = this.all()
      .flatMap((f) => f.hours)
      .filter((h) => h.date >= from && h.date <= to)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.line - b.line));
    const totals = new Map<string, ClientTotal>();
    const byDay = new Map<ISODate, number>();
    for (const e of entries) {
      const client = clients.get(e.client) ?? { key: e.client, name: e.client, rate: 0, currency: "USD" };
      const t = totals.get(e.client) ?? { client, hours: 0, amount: 0 };
      t.hours += e.hours;
      t.amount += e.hours * client.rate;
      totals.set(e.client, t);
      byDay.set(e.date, (byDay.get(e.date) ?? 0) + e.hours);
    }
    return {
      entries,
      byClient: [...totals.values()].sort((a, b) => b.hours - a.hours),
      byDay,
      totalHours: entries.reduce((s, e) => s + e.hours, 0),
    };
  }

  timesheetCsv(ts: Timesheet): string {
    const clients = this.clients();
    const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const rows = [["date", "client", "hours", "rate", "amount", "description", "file"].join(",")];
    for (const e of ts.entries) {
      const rate = clients.get(e.client)?.rate ?? 0;
      rows.push(
        [e.date, q(e.client), round2(e.hours), rate, round2(e.hours * rate), q(e.description), q(e.file)].join(","),
      );
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
