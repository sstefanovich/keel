import { syntaxTree } from "@codemirror/language";
import { EditorState, Range, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { knownLinkTitle, linkText, singleUrl } from "../../core/links";

/**
 * Editor extras for pasting:
 * - images pasted or dropped are saved under attachments/ and linked with ![](…), and every
 *   ![](…) shows the image under its line;
 * - a single pasted URL becomes a named link: [selection](url) over selected text, a readable name
 *   for Azure DevOps / portal / GitHub / SharePoint links, else the page's title once fetched
 *   (Ctrl+Z goes back to the bare URL). Ctrl+Shift+V pastes exactly what was copied.
 */
export interface PasteOptions {
  /** Store an image; returns its path relative to the hold */
  saveImage: (file: File) => Promise<string>;
  /** Hold-relative image path → something an <img> can show */
  loadImage: (path: string) => Promise<string>;
  linkTitle: (url: string) => Promise<string | null>;
  onError: (e: unknown) => void;
}

const IMG = /!\[([^\]]*)\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g;

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly load: (path: string) => Promise<string>,
  ) {
    super();
  }
  eq(o: ImageWidget) {
    return o.src === this.src && o.alt === this.alt;
  }
  get estimatedHeight() {
    return 220;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-image";
    const img = document.createElement("img");
    img.alt = this.alt;
    img.title = `${this.alt ? `${this.alt} · ` : ""}${this.src} (click to enlarge)`;
    img.addEventListener("load", () => view.requestMeasure());
    img.addEventListener("click", () => wrap.classList.toggle("zoomed"));
    const fail = () => {
      wrap.classList.add("missing");
      wrap.textContent = `Image not found: ${this.src}`;
    };
    img.addEventListener("error", fail);
    if (/^(https?:|data:)/i.test(this.src)) img.src = this.src;
    else
      this.load(decodeURI(this.src.replace(/^\.?\//, "")))
        .then((url) => (img.src = url))
        .catch(fail);
    wrap.appendChild(img);
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

function imageDecorations(state: EditorState, load: (p: string) => Promise<string>): DecorationSet {
  const decos: Range<Decoration>[] = [];
  let inFence = false;
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    if (/^\s*(```|~~~)/.test(line.text)) inFence = !inFence;
    if (inFence || !line.text.includes("![")) continue;
    for (const m of line.text.matchAll(IMG)) {
      decos.push(Decoration.widget({ widget: new ImageWidget(m[2], m[1], load), block: true, side: 1 }).range(line.to));
    }
  }
  return Decoration.set(decos, true);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** attachments/2026-10-23-142530.png */
export function attachmentName(now: Date, ext: string, n = 0): string {
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `attachments/${stamp}${n ? `-${n}` : ""}.${ext}`;
}

/** Where a pasted URL must stay as typed: code, inside a link, or right after ( or <. */
function rawContext(state: EditorState, pos: number): boolean {
  const before = state.sliceDoc(Math.max(0, pos - 2), pos);
  if (/[(<]$/.test(before) || before.endsWith("]]") || /\[\[$/.test(before)) return true;
  let node = syntaxTree(state).resolveInner(pos, -1);
  for (let n: typeof node | null = node; n; n = n.parent) {
    if (["InlineCode", "FencedCode", "CodeBlock", "Link", "Image", "URL", "Autolink"].includes(n.name)) return true;
  }
  return false;
}

async function insertImages(view: EditorView, files: File[], at: number, opts: PasteOptions) {
  const links: string[] = [];
  for (const f of files) {
    try {
      const path = await opts.saveImage(f);
      links.push(`![](${path})`);
    } catch (e) {
      opts.onError(e);
    }
  }
  if (!links.length) return;
  const line = view.state.doc.lineAt(at);
  // each image on its own line
  const before = at > line.from && line.text.slice(0, at - line.from).trim() ? "\n" : "";
  const after = at < line.to && line.text.slice(at - line.from).trim() ? "\n" : "";
  const insert = before + links.join("\n") + after;
  view.dispatch({ changes: { from: at, insert }, selection: { anchor: at + insert.length }, userEvent: "input.paste", scrollIntoView: true });
}

function pasteLink(view: EditorView, url: string, opts: PasteOptions) {
  const sel = view.state.selection.main;
  const selected = view.state.sliceDoc(sel.from, sel.to);
  const named = (label: string) => `[${linkText(label)}](${url})`;
  if (!sel.empty && !selected.includes("\n")) {
    const insert = named(selected);
    view.dispatch({ changes: { from: sel.from, to: sel.to, insert }, selection: { anchor: sel.from + insert.length }, userEvent: "input.paste" });
    return;
  }
  const known = knownLinkTitle(url);
  if (known) {
    const insert = named(known);
    view.dispatch({ changes: { from: sel.from, to: sel.to, insert }, selection: { anchor: sel.from + insert.length }, userEvent: "input.paste" });
    return;
  }
  // paste the bare URL now; swap in the page title if one arrives (a separate step, so Ctrl+Z restores the URL)
  const from = sel.from;
  view.dispatch({ changes: { from, to: sel.to, insert: url }, selection: { anchor: from + url.length }, userEvent: "input.paste" });
  void opts.linkTitle(url).then((title) => {
    if (!title) return;
    const doc = view.state.doc.toString();
    // find it again near where it went (typing elsewhere may have moved it)
    let at = doc.indexOf(url, Math.max(0, from - 500));
    while (at >= 0 && (doc.slice(Math.max(0, at - 2), at) === "](" || doc[at - 1] === "<")) at = doc.indexOf(url, at + 1);
    if (at < 0 || at > from + 2000) return;
    const insert = named(title);
    const cursor = view.state.selection.main.head;
    view.dispatch({
      changes: { from: at, to: at + url.length, insert },
      // keep the cursor after the link if it was there
      selection: cursor === at + url.length ? { anchor: at + insert.length } : undefined,
      userEvent: "input.paste.title",
    });
  });
}

export function pasteAndImages(opts: PasteOptions) {
  let plainNext = false;
  const images = StateField.define<DecorationSet>({
    create: (state) => imageDecorations(state, opts.loadImage),
    update: (deco, tr) => (tr.docChanged ? imageDecorations(tr.state, opts.loadImage) : deco),
    provide: (f) => EditorView.decorations.from(f),
  });
  const handlers = EditorView.domEventHandlers({
    keydown(e) {
      // Ctrl+Shift+V: paste exactly as copied
      plainNext = (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "v";
      return false;
    },
    paste(e, view) {
      const plain = plainNext;
      plainNext = false;
      const dt = e.clipboardData;
      if (!dt) return false;
      const imgs = [...dt.files].filter((f) => f.type.startsWith("image/"));
      if (imgs.length && !dt.getData("text/plain").trim()) {
        e.preventDefault();
        void insertImages(view, imgs, view.state.selection.main.from, opts);
        return true;
      }
      if (plain) return false;
      const url = singleUrl(dt.getData("text/plain"));
      if (!url || rawContext(view.state, view.state.selection.main.from)) return false;
      e.preventDefault();
      pasteLink(view, url, opts);
      return true;
    },
    drop(e, view) {
      const imgs = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (!imgs.length) return false;
      e.preventDefault();
      const at = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.from;
      void insertImages(view, imgs, at, opts);
      return true;
    },
  });
  return [images, handlers];
}
