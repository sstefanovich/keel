import { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { HighlightStyle } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { addDays, today } from "../../core/dates";

const TASK = /^(\s*[-*+] \[)([ xX>\-])(\])/;
const HOURS = /^(\s*[-*+]\s+)((?:\d+(?:\.\d+)?h)?(?:\d+m)?)(\s+)(@[\w.-]+)/;
const TOKENS = /@due\((\d{4}-\d{2}-\d{2})\)|@remind\([^)]*\)|\[\[[^\]]+\]\]|(?<=^|\s)#[A-Za-z][\w/-]*/g;

const mark = (cls: string) => Decoration.mark({ class: cls });
const lineDeco = (cls: string) => Decoration.line({ class: cls });

function build(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const now = today();
  const doc = view.state.doc;
  // frontmatter: lines 1..n when line 1 is "---"
  let fmEnd = 0;
  if (doc.lines > 1 && doc.line(1).text.trim() === "---") {
    for (let n = 2; n <= Math.min(doc.lines, 200); n++) {
      if (doc.line(n).text.trim() === "---") {
        fmEnd = n;
        break;
      }
    }
  }
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = doc.lineAt(pos);
      const text = line.text;
      if (line.number <= fmEnd) {
        b.add(line.from, line.from, lineDeco("cm-k-frontmatter"));
        pos = line.to + 1;
        continue;
      }
      const ranges: [number, number, Decoration][] = [];

      const task = text.match(TASK);
      if (task) {
        const st = task[2];
        if (st !== " ") b.add(line.from, line.from, lineDeco(st === ">" ? "cm-k-migrated" : "cm-k-done"));
        const start = line.from + task[1].length - 1;
        ranges.push([start, start + 3, mark(`cm-k-box${st === " " ? "" : " cm-k-box-checked"}`)]);
      } else {
        const h = text.match(HOURS);
        if (h && h[2]) {
          const s = line.from + h[1].length;
          ranges.push([s, s + h[2].length, mark("cm-k-dur")]);
          const c = s + h[2].length + h[3].length;
          ranges.push([c, c + h[4].length, mark("cm-k-client")]);
        }
      }

      if (!/^\s*(```|~~~)/.test(text)) {
        for (const m of text.matchAll(TOKENS)) {
          const s = line.from + m.index!;
          const tok = m[0];
          let cls = "cm-k-tag";
          if (tok.startsWith("@due")) cls = m[1] && m[1] < now && task?.[2] === " " ? "cm-k-due cm-k-overdue" : "cm-k-due";
          else if (tok.startsWith("@remind")) cls = "cm-k-remind";
          else if (tok.startsWith("[[")) cls = "cm-k-link";
          ranges.push([s, s + tok.length, mark(cls)]);
        }
      }

      ranges.sort((a, z) => a[0] - z[0]);
      for (const [s, e, d] of ranges) b.add(s, e, d);
      pos = line.to + 1;
    }
  }
  return b.finish();
}

export const keelDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = build(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

/** Click a [ ] to toggle it; Ctrl+click a [[link]] to follow it. */
export function keelClicks(onOpenLink: (target: string) => void) {
  return EditorView.domEventHandlers({
    mousedown(e, view) {
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos == null) return false;
      const line = view.state.doc.lineAt(pos);
      const off = pos - line.from;

      if (e.ctrlKey || e.metaKey) {
        for (const m of line.text.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) {
          if (off >= m.index! && off <= m.index! + m[0].length) {
            e.preventDefault();
            onOpenLink(m[1].trim());
            return true;
          }
        }
      }

      const task = line.text.match(TASK);
      if (task && e.button === 0) {
        const box = task[1].length - 1;
        if (off >= box && off <= box + 3) {
          const ch = task[2] === " " ? "x" : " ";
          view.dispatch({ changes: { from: line.from + box + 1, to: line.from + box + 2, insert: ch } });
          e.preventDefault();
          return true;
        }
      }
      return false;
    },
  });
}

/** Autocomplete for [[links]], @client on hours lines, and @due/@remind on tasks. */
export function keelCompletions(getNames: () => string[], getClients: () => string[]) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const link = ctx.matchBefore(/\[\[[^\]]*/);
    if (link) {
      return {
        from: link.from + 2,
        options: getNames().map((n) => ({ label: n, apply: `${n}]]`, type: "text" })),
        validFor: /^[^\]]*$/,
      };
    }
    const at = ctx.matchBefore(/@[\w.-]*/);
    if (!at) return null;
    const lineText = ctx.state.doc.lineAt(ctx.pos).text;
    if (/^\s*[-*+]\s+(?:\d+(?:\.\d+)?h)?(?:\d+m)?\s+@[\w.-]*$/.test(lineText.slice(0, ctx.pos - ctx.state.doc.lineAt(ctx.pos).from))) {
      return {
        from: at.from + 1,
        options: getClients().map((c) => ({ label: c, type: "variable", detail: "client" })),
        validFor: /^[\w.-]*$/,
      };
    }
    if (TASK.test(lineText) || /^\s*[-*+]\s/.test(lineText)) {
      const d0 = today();
      return {
        from: at.from + 1,
        options: [
          { label: `due(${d0})`, detail: "today" },
          { label: `due(${addDays(d0, 1)})`, detail: "tomorrow" },
          { label: `due(${addDays(d0, 7)})`, detail: "in a week" },
          { label: "remind(09:00)", detail: "at a time" },
          { label: "remind(daily 09:00)", detail: "recurring" },
          { label: "remind(weekdays 09:00)", detail: "recurring" },
        ].map((o) => ({ ...o, type: "keyword" })),
        validFor: /^[\w(]*$/,
      };
    }
    return null;
  };
}

export const keelHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.6em", fontWeight: "700" },
  { tag: t.heading2, fontSize: "1.3em", fontWeight: "650" },
  { tag: t.heading3, fontSize: "1.12em", fontWeight: "600" },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "600" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, class: "cm-k-url" },
  { tag: t.url, class: "cm-k-url" },
  { tag: t.monospace, class: "cm-k-code" },
  { tag: t.quote, class: "cm-k-quote" },
  { tag: [t.processingInstruction, t.meta], class: "cm-k-meta" },
  { tag: t.contentSeparator, class: "cm-k-meta" },
  { tag: t.list, class: "cm-k-meta" },
]);
