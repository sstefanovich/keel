import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, keymap } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { basename } from "../../core/parse";
import { useHold } from "../HoldContext";
import { keelClicks, keelCompletions, keelDecorations, keelHighlight, mermaidPreview, refreshMermaid } from "./keelSyntax";
import { onThemeChange } from "../theme";

interface Props {
  path: string;
  line?: number;
  onOpenLink: (target: string) => void;
}

const SAVE_DELAY = 500;

/** Markdown editor for one file. Autosaves; reloads when the file changes on disk. */
const flushers = new Set<() => Promise<void>>();

/** Save any unsaved typing in open editors. Await this before writing to a file an editor may have open. */
export async function flushEditors(): Promise<void> {
  await Promise.all([...flushers].map((f) => f()));
}

export function Editor({ path, line, onOpenLink }: Props) {
  const { hold, version, bump, reportError } = useHold();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const saved = useRef({ content: "", mtime: 0 });
  const timer = useRef<number | undefined>(undefined);
  const linkRef = useRef(onOpenLink);
  linkRef.current = onOpenLink;

  const flush = async () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    const v = view.current;
    if (!v) return;
    const content = v.state.doc.toString();
    if (content === saved.current.content) return;
    saved.current.content = content;
    try {
      await hold.save(path, content);
      saved.current.mtime = hold.get(path)?.mtime ?? 0;
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
          keelClicks((t) => linkRef.current(t)),
          autocompletion({
            override: [
              keelCompletions(
                () => [...new Set(hold.all().filter((f) => f.kind !== "template").map((f) => basename(f.path)))].sort(),
                () => [...new Set([...hold.clients().keys(), ...hold.all().flatMap((f) => f.hours.map((h) => h.client))])].sort(),
              ),
            ],
          }),
          keymap.of([
            ...closeBracketsKeymap,
            ...completionKeymap,
            ...searchKeymap,
            ...historyKeymap,
            indentWithTab,
            ...defaultKeymap,
          ]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ spellcheck: "true" }),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
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
    if (f.content !== v.state.doc.toString()) {
      const sel = v.state.selection.main.head;
      v.dispatch({
        changes: { from: 0, to: v.state.doc.length, insert: f.content },
        selection: { anchor: Math.min(sel, f.content.length) },
      });
      window.clearTimeout(timer.current);
      timer.current = undefined;
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

function jumpTo(v: EditorView, line?: number) {
  if (line == null) {
    v.focus();
    return;
  }
  const l = v.state.doc.line(Math.min(Math.max(1, line + 1), v.state.doc.lines));
  v.dispatch({ selection: { anchor: l.to }, effects: EditorView.scrollIntoView(l.from, { y: "center" }) });
  v.focus();
}
