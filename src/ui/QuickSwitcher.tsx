import { CornerDownLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatLong, formatShort, today } from "../core/dates";
import { ParsedFile } from "../core/parse";
import { useHold } from "./HoldContext";
import { View, useNav } from "./nav";
import { FILE_ICONS, VIEW_ICONS, VIEW_TITLES } from "./viewMeta";

interface Item {
  key: string;
  title: string;
  sub: string;
  view: View;
  Icon: (typeof VIEW_ICONS)[keyof typeof VIEW_ICONS];
  /** Higher sorts first when nothing is typed */
  recency: number;
}

/** Fuzzy-ish score: all query words must appear; earlier and word-start matches rank higher. */
function score(item: Item, words: string[]): number {
  const hay = `${item.title} ${item.sub}`.toLowerCase();
  let s = 0;
  for (const w of words) {
    const i = hay.indexOf(w);
    if (i < 0) return -1;
    s += (i === 0 ? 30 : /\W/.test(hay[i - 1] ?? " ") ? 15 : 5) + (item.title.toLowerCase().includes(w) ? 10 : 0);
  }
  return s;
}

/** Ctrl+P: jump to any note, log, meeting, client, project or view by typing part of its name. */
export function QuickSwitcher({ onClose }: { onClose: () => void }) {
  const { hold } = useHold();
  const nav = useNav();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => input.current?.focus(), []);

  const items = useMemo<Item[]>(() => {
    const views = (Object.keys(VIEW_TITLES) as (keyof typeof VIEW_TITLES)[]).map((k) => ({
      key: `view:${k}`,
      title: VIEW_TITLES[k],
      sub: "View",
      view: { kind: k } as View,
      Icon: VIEW_ICONS[k],
      recency: 0,
    }));
    const label = (f: ParsedFile) => {
      if (f.kind === "log" && f.date) return { title: f.date === today() ? `Today · ${formatShort(f.date)}` : formatLong(f.date), sub: "Log" };
      const client = hold.fileClient(f);
      const where = { meeting: "Meeting", note: "Note", client: "Client", project: "Project", flag: "Flag", reminders: "Reminders", template: "", log: "Log" }[f.kind];
      return { title: f.title, sub: [where, client && f.kind !== "client" ? hold.clients().get(client)?.name ?? client : ""].filter(Boolean).join(" · ") };
    };
    const files = hold
      .all()
      .filter((f) => f.kind !== "template" && !(f.kind === "flag" && f.frontmatter.lowered))
      .map((f) => ({ key: f.path, ...label(f), view: { kind: "file", path: f.path } as View, Icon: FILE_ICONS[f.kind], recency: f.mtime }));
    return [...views, ...files];
  }, [hold]);

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const results = words.length
    ? items
        .map((i) => ({ i, s: score(i, words) }))
        .filter((r) => r.s >= 0)
        .sort((a, b) => b.s - a.s || b.i.recency - a.i.recency)
        .slice(0, 50)
        .map((r) => r.i)
    : [...items].sort((a, b) => b.recency - a.recency).slice(0, 12);
  const current = Math.min(sel, Math.max(0, results.length - 1));

  useEffect(() => {
    list.current?.children[current]?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const open = (item: Item | undefined, newTab: boolean) => {
    if (!item) return;
    nav.go(item.view, { newTab });
    onClose();
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal switcher" role="dialog" aria-label="Go to" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          value={q}
          placeholder="Go to a note, log, project, client or view…"
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const n = results.length || 1;
              setSel((current + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
            } else if (e.key === "Enter") {
              e.preventDefault();
              open(results[current], e.ctrlKey || e.metaKey);
            } else if (e.key === "Escape") onClose();
          }}
        />
        <ul className="switcher-list" ref={list} role="listbox">
          {results.map((r, i) => (
            <li key={r.key}>
              <button
                role="option"
                aria-selected={i === current}
                className={i === current ? "on" : ""}
                onMouseEnter={() => setSel(i)}
                onClick={(e) => open(r, e.ctrlKey || e.metaKey)}
              >
                <r.Icon size={16} className="switcher-icon" aria-hidden="true" />
                <span className="switcher-title">{r.title}</span>
                <span className="switcher-sub">{r.sub}</span>
                {i === current && <CornerDownLeft size={14} className="switcher-enter" aria-hidden="true" />}
              </button>
            </li>
          ))}
          {!results.length && <li className="switcher-empty">Nothing matches “{q}”.</li>}
        </ul>
        <div className="switcher-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> to move
          </span>
          <span>
            <kbd>Enter</kbd> to open
          </span>
          <span>
            <kbd>Ctrl</kbd>+<kbd>Enter</kbd> in a new tab
          </span>
          <span>
            <kbd>Esc</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}
