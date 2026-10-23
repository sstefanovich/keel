import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { foldGutter, foldKeymap, syntaxHighlighting } from "@codemirror/language";
import { fetchLinkTitle, imageUrl, saveImage } from "../../lib/platform";
import { attachmentName, pasteAndImages } from "./pasteAndImages";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, keymap } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { basename } from "../../core/parse";
import { useHold } from "../HoldContext";
import { keelClicks, keelCompletions, keelDecorations, keelHighlight, mermaidPreview, propertiesView, refreshMermaid } from "./keelSyntax";
import { workTargets } from "../workTargets";
import { onThemeChange } from "../theme";
import { LivePreviewOptions, livePreview, livePreviewEnabled, onLivePreviewChange } from "./livePreview";

interface Props {
  path: string;
  line?: number;
  onOpenLink: (target: string, newTab?: boolean) => void;
  /** Save state for the header: unsaved typing, a save in flight, or everything saved */
  onStatus?: (s: SaveStatus) => void;
}

const SAVE_DELAY = 500;

const flushers = new Set<() => Promise<void>>();

/** Save any unsaved typing in open editors. Await this before writing to a file an editor may have open. */
export async function flushEditors(): Promise<void> {
  await Promise.all([...flushers].map((f) => f()));
}

export type SaveStatus = "saved" | "pending" | "saving";

/** Markdown editor for one file. Autosaves; reloads when the file changes on disk. */
export function Editor({ path, line, onOpenLink, onStatus }: Props) {
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;
  const { hold, dir, version, bump, reportError } = useHold();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const saved = useRef({ content: "", mtime: 0 });
  const timer = useRef<number | undefined>(undefined);
  const linkRef = useRef(onOpenLink);
  const previewSlot = useRef(new Compartment());
  const previewOpts: LivePreviewOptions = {
    open: (target, newTab) => linkRef.current(target, newTab),
    exists: (target) => !!hold.resolveLink(target),
  };
  linkRef.current = onOpenLink;

  const flush = async () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    const v = view.current;
    if (!v) return;
    const content = v.state.doc.toString();
    if (content === saved.current.content) return;
    saved.current.content = content;
    statusRef.current?.("saving");
    try {
      await hold.save(path, content);
      saved.current.mtime = hold.get(path)?.mtime ?? 0;
      if (v.state.doc.toString() === content) statusRef.current?.("saved");
      bump();
    } catch (e) {
      reportError(e);
    }
  };

  // create the editor for this file
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const content = await hold.fs.read(path).catch(() => hold.get(path)?.content ?? "");
      if (cancelled || !host.current) return;
      saved.current = { content, mtime: hold.get(path)?.mtime ?? 0 };
      const state = EditorState.create({
        doc: content,
        extensions: [
          history(),
          drawSelection(),
          highlightActiveLine(),
          closeBrackets(),
          search({ top: true }),
          highlightSelectionMatches(),
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(keelHighlight),
          keelDecorations,
          mermaidPreview,
          propertiesView,
          keelClicks((t) => linkRef.current(t)),
          foldGutter({ openText: "▾", closedText: "▸" }),
          pasteAndImages({
            saveImage: async (file) => {
              const ext = { "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp" }[file.type] ?? "png";
              const now = new Date();
              let name = attachmentName(now, ext);
              for (let n = 2; await hold.fs.exists(name); n++) name = attachmentName(now, ext, n);
              await saveImage(dir, name, await toBase64(file));
              return name;
            },
            loadImage: (p) => imageUrl(dir, p),
            linkTitle: fetchLinkTitle,
            onError: reportError,
          }),
          previewSlot.current.of(livePreviewEnabled() ? livePreview(previewOpts) : []),
          autocompletion({
            override: [
              keelCompletions(
                () => [...new Set(hold.all().filter((f) => f.kind !== "template").map((f) => basename(f.path)))].sort(),
                () => workTargets(hold),
              ),
            ],
          }),
          keymap.of([
            ...closeBracketsKeymap,
            ...completionKeymap,
            ...foldKeymap,
            ...searchKeymap,
            ...historyKeymap,
            indentWithTab,
            ...defaultKeymap,
          ]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ spellcheck: "true" }),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            if (u.transactions.some((tr) => tr.isUserEvent("input") || tr.isUserEvent("delete") || tr.isUserEvent("undo") || tr.isUserEvent("redo") || tr.isUserEvent("move"))) statusRef.current?.("pending");
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(flush, SAVE_DELAY);
          }),
        ],
      });
      const v = new EditorView({ state, parent: host.current });
      view.current = v;
      jumpTo(v, line);
    })();
    return () => {
      cancelled = true;
      void flush().finally(() => {
        view.current?.destroy();
        view.current = null;
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // live preview on/off from Settings, applied to the open editor straight away
  useEffect(
    () =>
      onLivePreviewChange(() =>
        view.current?.dispatch({ effects: previewSlot.current.reconfigure(livePreviewEnabled() ? livePreview(previewOpts) : []) }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // re-render diagrams in the new colors when the theme changes
  useEffect(() => onThemeChange(() => view.current?.dispatch({ effects: refreshMermaid.of(null) })), []);

  // jump when asked to open the same file at another line
  useEffect(() => {
    if (view.current) jumpTo(view.current, line);
  }, [line]);

  // pick up edits made outside the editor (agenda checkboxes, quick capture, other apps)
  useEffect(() => {
    const v = view.current;
    const f = hold.get(path);
    if (!v || !f || f.mtime === saved.current.mtime || timer.current !== undefined) return;
    const doc = v.state.doc.toString();
    // typing that hasn't been saved yet (e.g. while a save is in flight): never reload over it
    if (doc !== saved.current.content) return;
    if (f.content !== doc) {
      // replace only the changed span so the cursor and scroll position map through the edit
      let start = 0;
      while (start < doc.length && start < f.content.length && doc[start] === f.content[start]) start++;
      let endOld = doc.length;
      let endNew = f.content.length;
      while (endOld > start && endNew > start && doc[endOld - 1] === f.content[endNew - 1]) {
        endOld--;
        endNew--;
      }
      v.dispatch({ changes: { from: start, to: endOld, insert: f.content.slice(start, endNew) } });
    }
    saved.current = { content: f.content, mtime: f.mtime };
  }, [version, hold, path]);

  // save before the window hides/closes, and before quick capture writes to disk
  useEffect(() => {
    const h = () => void flush();
    window.addEventListener("blur", h);
    window.addEventListener("keel-flush", h);
    flushers.add(flush);
    return () => {
      window.removeEventListener("blur", h);
      window.removeEventListener("keel-flush", h);
      flushers.delete(flush);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  return <div className="editor" ref={host} />;
}

/** A file's bytes as base64 (no data: prefix). */
function toBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function jumpTo(v: EditorView, line?: number) {
  if (line == null) {
    // start just below the frontmatter, so it shows as the properties bar rather than raw
    const doc = v.state.doc;
    if (doc.lines > 2 && doc.line(1).text.trim() === "---") {
      for (let n = 2; n <= Math.min(doc.lines, 200); n++) {
        if (doc.line(n).text.trim() === "---") {
          v.dispatch({ selection: { anchor: n < doc.lines ? doc.line(n + 1).from : doc.length } });
          break;
        }
      }
    }
    v.focus();
    return;
  }
  const l = v.state.doc.line(Math.min(Math.max(1, line + 1), v.state.doc.lines));
  v.dispatch({ selection: { anchor: l.to }, effects: EditorView.scrollIntoView(l.from, { y: "center" }) });
  v.focus();
}
