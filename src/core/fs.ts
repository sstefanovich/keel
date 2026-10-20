/** Storage the Hold reads and writes. Paths are relative to the hold root and use "/". */
export interface HoldFs {
  list(): Promise<{ path: string; mtime: number }[]>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

/** In-memory implementation for tests and for running the UI in a plain browser. */
export class MemoryFs implements HoldFs {
  files = new Map<string, { content: string; mtime: number }>();
  private clock = 1;

  constructor(initial: Record<string, string> = {}, private onChange?: () => void) {
    for (const [p, c] of Object.entries(initial)) this.files.set(p, { content: c, mtime: this.clock++ });
  }

  async list() {
    return [...this.files].map(([path, f]) => ({ path, mtime: f.mtime }));
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
    return this.files.has(path);
  }
  async remove(path: string) {
    this.files.delete(path);
    this.onChange?.();
  }
  async rename(from: string, to: string) {
    const f = this.files.get(from);
    if (!f) throw new Error(`Not found: ${from}`);
    if (this.files.has(to)) throw new Error(`Already exists: ${to}`);
    this.files.delete(from);
    this.files.set(to, f);
    this.onChange?.();
  }
}
