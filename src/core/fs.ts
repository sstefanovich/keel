/** Storage the Hold reads and writes. Paths are relative to the hold root and use "/". */
export interface HoldFs {
  list(): Promise<{ path: string; mtime: number }[]>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  /** Moves a file, or a whole folder */
  rename(from: string, to: string): Promise<void>;
  /** Every folder, including empty ones (dot-folders excluded) */
  dirs(): Promise<string[]>;
  mkdir(path: string): Promise<void>;
  /** Removes an empty folder; fails if it has anything in it */
  rmdir(path: string): Promise<void>;
}

const parentsOf = (path: string) => {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
};

/** In-memory implementation for tests and for running the UI in a plain browser. */
export class MemoryFs implements HoldFs {
  files = new Map<string, { content: string; mtime: number }>();
  folders = new Set<string>();
  private clock = 1;

  constructor(initial: Record<string, string> = {}, private onChange?: () => void) {
    for (const [p, c] of Object.entries(initial)) this.files.set(p, { content: c, mtime: this.clock++ });
  }

  async list() {
    return [...this.files].filter(([p]) => !p.split("/").some((s) => s.startsWith("."))).map(([path, f]) => ({ path, mtime: f.mtime }));
  }
  async read(path: string) {
    const f = this.files.get(path);
    if (!f) throw new Error(`Not found: ${path}`);
    return f.content;
  }
  async write(path: string, content: string) {
    this.files.set(path, { content, mtime: this.clock++ });
    this.onChange?.();
  }
  async exists(path: string) {
    return this.files.has(path) || (await this.dirs()).includes(path);
  }
  async remove(path: string) {
    this.files.delete(path);
    this.onChange?.();
  }
  async rename(from: string, to: string) {
    if (await this.exists(to)) throw new Error(`Already exists: ${to}`);
    const f = this.files.get(from);
    if (f) {
      this.files.delete(from);
      this.files.set(to, { ...f, mtime: this.clock++ });
    } else if ((await this.dirs()).includes(from)) {
      for (const [p, file] of [...this.files]) {
        if (p.startsWith(`${from}/`)) {
          this.files.delete(p);
          this.files.set(`${to}${p.slice(from.length)}`, { ...file, mtime: this.clock++ });
        }
      }
      for (const d of [...this.folders]) {
        if (d === from || d.startsWith(`${from}/`)) {
          this.folders.delete(d);
          this.folders.add(`${to}${d.slice(from.length)}`);
        }
      }
    } else throw new Error(`Not found: ${from}`);
    this.onChange?.();
  }
  async dirs() {
    const all = new Set(this.folders);
    for (const p of this.files.keys()) parentsOf(p).forEach((d) => all.add(d));
    return [...all].filter((d) => !d.split("/").some((s) => s.startsWith(".")));
  }
  async mkdir(path: string) {
    parentsOf(`${path}/x`).forEach((d) => this.folders.add(d));
  }
  async rmdir(path: string) {
    const busy = [...this.files.keys()].some((p) => p.startsWith(`${path}/`)) || [...this.folders].some((d) => d.startsWith(`${path}/`));
    if (busy) throw new Error(`${path} isn't empty`);
    this.folders.delete(path);
  }
}
