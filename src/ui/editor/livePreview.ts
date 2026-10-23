import { syntaxTree } from "@codemirror/language";
import { EditorState, Range } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { today } from "../../core/dates";
import { trailingOwner } from "../../core/parse";

/**
 * Live preview: hides markdown syntax (heading #, **, `, link URLs) except on the lines being
 * edited, draws task boxes as real checkboxes, bullets as •, and [[links]] as clickable chips.
 * The markdown on disk is never changed by any of this.
 */

const TASK = /^(\s*)([-*+]) \[([ xX>\-])\](?= )/;
const BULLET = /^(\s*)([-*+]) (?!\[[ xX>\-]\] )/;
const WIKI = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;

/** Toggle the task on a line between open and done, stamping/removing @done(date). */
export function toggleTaskLine(view: EditorView, lineFrom: number) {
  const line = view.state.doc.lineAt(lineFrom);
  const m = line.text.match(TASK);
  if (!m) return;
  const box = m[1].length + m[2].length + 2; // index of the status char
  const checking = m[3] === " " || m[3] === ">" || m[3] === "-";
  let next = line.text.slice(0, box) + (checking ? "x" : " ") + line.text.slice(box + 1);
  next = next.replace(/\s*@done\(\d{4}-\d{2}-\d{2}\)/, "");
  if (checking) next += ` @done(${today()})`;
  view.dispatch({ changes: { from: line.from, to: line.to, insert: next }, userEvent: "input.toggle" });
}

class CheckboxWidget extends WidgetType {
  constructor(readonly status: string) {
    super();
  }
  eq(o: CheckboxWidget) {
    return o.status === this.status;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("span");
    const done = /[xX]/.test(this.status);
    const kind = done ? "done" : this.status === ">" ? "moved" : this.status === "-" ? "cancelled" : "open";
    el.className = `cm-lp-check ${kind}`;
    el.setAttribute("role", "checkbox");
    el.setAttribute("aria-checked", String(done));
    el.title = kind === "moved" ? "Carried to a later day" : kind === "cancelled" ? "Cancelled" : done ? "Mark not done" : "Mark done";
    if (done) el.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    else if (kind === "moved") el.textContent = "›";
    else if (kind === "cancelled") el.textContent = "–";
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (kind === "moved" || kind === "cancelled") return;
      toggleTaskLine(view, view.posAtDOM(el));
    });
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-lp-bullet";
    el.textContent = "•";
    return el;
  }
}

class WikiLinkWidget extends WidgetType {
  constructor(
    readonly target: string,
    readonly label: string,
    readonly exists: boolean,
    readonly open: (target: string, newTab: boolean) => void,
  ) {
    super();
  }
  eq(o: WikiLinkWidget) {
    return o.target === this.target && o.label === this.label && o.exists === this.exists;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = `cm-lp-link${this.exists ? "" : " missing"}`;
    el.textContent = this.label;
    el.title = this.exists ? `Open ${this.target} (Ctrl+click: new tab)` : `${this.target} doesn't exist yet. Click to create it`;
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      this.open(this.target, e.ctrlKey || e.metaKey || e.button === 1);
    });
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

/** A task token (@due, @remind, @waiting, #project…) drawn as a small labelled chip. */
class TokenWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly kind: string,
    readonly title: string,
  ) {
    super();
  }
  eq(o: TokenWidget) {
    return o.text === this.text && o.kind === this.kind;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = `cm-lp-token ${this.kind}`;
    el.textContent = this.text;
    el.title = this.title;
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

const TOKEN = /(?<=^|\s)(?:@(due|remind|waiting|since|done)(?:\(([^)]*)\))?|@([A-Z][\w.'-]*[\w])|#([\w/-]+)|@([a-z0-9][\w.-]*(?:\/[\w.-]+)?))(?=$|[\s,;:!?)])/g;
const TASK_OR_WORK = /^\s*[-*+] (?:\[[ xX>\-]\] |\d|@)/;

function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function clock(t: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return t;
  return new Date(2000, 0, 1, Number(m[1]), Number(m[2])).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** The chip for one token on a task or work line, or null to leave it as typed. */
function tokenChip(m: RegExpMatchArray, done: boolean, opts: LivePreviewOptions): Decoration | null {
  const [raw, kw, arg, person, tag, key] = m;
  const chip = (text: string, kind: string) => Decoration.replace({ widget: new TokenWidget(text, kind, raw) });
  const t = today();
  switch (kw) {
    case "due":
      if (!arg || !/^\d{4}-\d{2}-\d{2}$/.test(arg)) return null;
      if (done) return chip(`due ${shortDate(arg)}`, "due");
      return arg < t ? chip(`overdue · ${shortDate(arg)}`, "due late") : chip(arg === t ? "due today" : `due ${shortDate(arg)}`, arg === t ? "due soon" : "due");
    case "remind":
      return arg ? chip(`🔔 ${arg.replace(/\d{1,2}:\d{2}/, clock)}`, "remind") : null;
    case "waiting":
      return chip(`⏳ ${arg?.trim() || "waiting"}`, "waiting");
    case "since":
      return Decoration.replace({}); // bookkeeping only
    case "done":
      return arg ? chip(`✓ ${shortDate(arg)}`, "done") : null;
  }
  if (person) return chip(`⏳ ${person}`, "waiting");
  if (tag) {
    const name = opts.label?.(tag.toLowerCase());
    return name ? chip(name, "project") : null;
  }
  if (key) {
    const name = opts.label?.(key.toLowerCase());
    return name ? chip(name, "project") : null;
  }
  return null;
}

function frontmatterEnd(state: EditorState): number {
  const doc = state.doc;
  if (doc.lines < 2 || doc.line(1).text.trim() !== "---") return -1;
  for (let n = 2; n <= Math.min(doc.lines, 200); n++) if (doc.line(n).text.trim() === "---") return doc.line(n).to;
  return -1;
}

function build(view: EditorView, opts: LivePreviewOptions): DecorationSet {
  const { state } = view;
  const decos: Range<Decoration>[] = [];
  // lines being edited stay raw
  const active = new Set<number>();
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    const b = state.doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) active.add(n);
  }
  const fmEnd = frontmatterEnd(state);
  const hide = Decoration.replace({});
  const skip = (pos: number) => pos <= fmEnd || active.has(state.doc.lineAt(pos).number);
  const taken: [number, number][] = [];
  const overlaps = (a: number, b: number) => taken.some(([x, y]) => a < y && b > x);
  const add = (from: number, to: number, d: Decoration) => {
    if (from >= to || overlaps(from, to)) return;
    taken.push([from, to]);
    decos.push(d.range(from, to));
  };

  for (const { from, to } of view.visibleRanges) {
    // line-based: tasks, bullets, [[links]]
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      if (skip(line.from)) continue;
      const task = line.text.match(TASK);
      if (task) {
        const start = line.from + task[1].length;
        // "- [ ]" → one checkbox
        add(start, start + task[2].length + 4, Decoration.replace({ widget: new CheckboxWidget(task[3]) }));
      } else {
        const b = line.text.match(BULLET);
        if (b && !/^\s*[-*+]\s*$/.test(line.text)) {
          const start = line.from + b[1].length;
          add(start, start + 1, Decoration.replace({ widget: new BulletWidget() }));
        }
      }
      for (const m of line.text.matchAll(WIKI)) {
        const s = line.from + m.index!;
        const target = m[1].trim();
        add(s, s + m[0].length, Decoration.replace({ widget: new WikiLinkWidget(target, (m[2] ?? target).trim(), opts.exists(target), opts.open) }));
      }
      // tokens on task and work lines as chips (not inside `code`)
      if (TASK_OR_WORK.test(line.text) || /^\s+[-*+] /.test(line.text)) {
        const masked = line.text.replace(/`[^`]*`/g, (c) => " ".repeat(c.length));
        const done = /^\s*[-*+] \[[xX]\]/.test(line.text);
        // only a task's trailing @Name is who it waits on; other @Names stay as written
        const owner = TASK.test(line.text) ? trailingOwner(masked) : null;
        for (const m of masked.matchAll(TOKEN)) {
          if (m[3] && m.index !== owner?.at) continue;
          const d = tokenChip(m, done, opts);
          if (!d) continue;
          const s = line.from + m.index!;
          // a hidden @since takes its leading space with it
          const from = m[1] === "since" && line.text[m.index! - 1] === " " ? s - 1 : s;
          add(from, s + m[0].length, d);
        }
      }
    }

    // syntax-tree based: heading marks, emphasis, inline code, markdown links
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (skip(node.from)) return;
        switch (node.name) {
          case "HeaderMark": {
            const after = state.doc.sliceString(node.to, node.to + 1) === " " ? 1 : 0;
            if (node.node.parent?.name.startsWith("ATXHeading")) add(node.from, node.to + after, hide);
            break;
          }
          case "EmphasisMark":
          case "StrikethroughMark":
            add(node.from, node.to, hide);
            break;
          case "CodeMark":
            if (node.node.parent?.name === "InlineCode") add(node.from, node.to, hide);
            break;
          case "LinkMark":
          case "URL":
            if (node.node.parent?.name === "Link") add(node.from, node.to, hide);
            break;
          case "FencedCode":
          case "CodeBlock":
            return false; // leave code blocks exactly as typed
        }
      },
    });
  }
  return Decoration.set(decos, true);
}

export interface LivePreviewOptions {
  /** Open a [[link]] (in a new tab when asked) */
  open: (target: string, newTab: boolean) => void;
  /** Whether a [[link]] target exists (missing ones are styled differently) */
  exists: (target: string) => boolean;
  /** A project or client key's display name ("flis-retain-pa" → "FLIS Retain PA"), or null */
  label?: (key: string) => string | null;
}

export function livePreview(opts: LivePreviewOptions) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view, opts);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged || u.heightChanged)
          this.decorations = build(u.view, opts);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

// ---------- the on/off setting ----------

const KEY = "keel.livePreview";
const listeners = new Set<() => void>();

export function livePreviewEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setLivePreview(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // ignore
  }
  listeners.forEach((l) => l());
}

export function onLivePreviewChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
