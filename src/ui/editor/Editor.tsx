import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, keymap } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { Hold } from "../../core/hold";
import { basename } from "../../core/parse";
import { slugify } from "../../core/templates";
import { useHold } from "../HoldContext";
import { WorkTarget, keelClicks, keelCompletions, keelDecorations, keelHighlight, mermaidPreview, refreshMermaid } from "./keelSyntax";
import { onThemeChange } from "../theme";

interface Props {
  path: string;
  line?: number;
  onOpenLink: (target: string) => void;
}

const SAVE_DELAY = 500;

/** Markdown editor for one file. Autosaves; reloads when the file changes on disk. */
/** Active projects first (with their client), then clients, then other keys already used in hours lines. */
function workTargets(hold: Hold): WorkTarget[] {
  const clients = hold.clients();
  const projects = hold
    .all()
    .filter((f) => f.kind === "project" && f.frontmatter.status !== "done")
    .map((p) => {
      const client = hold.fileClient(p);
      const key = slugify(basename(p.path));
      return { key, project: key, client, detail: `${p.title} · ${client ? (clients.get(client)?.name ?? client) : "no client"}` };
    })
    .sort((a, b) => a.detail.localeCompare(b.detail));
  const clientTargets = [...clients.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ key: c.key, client: c.key, detail: `${c.name} (client)` }));
  const known = new Set([...projects.map((p) => p.key), ...clientTargets.map((c) => c.key)]);
  const others = [...new Set(hold.all().flatMap((f) => f.hours.map((h) => h.client)))]
    .filter((k) => !known.has(k) && !k.includes("/"))
    .sort()
    .map((k) => ({ key: k, detail: "used before" }));
  return [...projects, ...clientTargets, ...others];
}

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
                () => workTargets(hold),
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

function jumpTo(v: EditorView, line?: number) {
  if (line == null) {
    v.focus();
    return;
  }
  const l = v.state.doc.line(Math.min(Math.max(1, line + 1), v.state.doc.lines));
  v.dispatch({ selection: { anchor: l.to }, effects: EditorView.scrollIntoView(l.from, { y: "center" }) });
  v.focus();
}
