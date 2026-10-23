import { getSpace } from "./space";
import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { FLAG_COLORS, FlagColor } from "../core/hold";
import { ParsedFile } from "../core/parse";
import { useHold } from "./HoldContext";
import { useNav } from "./nav";

const colorOf = (f: ParsedFile): FlagColor =>
  FLAG_COLORS.includes(f.frontmatter.color as FlagColor) ? (f.frontmatter.color as FlagColor) : "yellow";

function age(created: unknown): string {
  const d = typeof created === "string" ? new Date(created.replace(" ", "T")) : null;
  if (!d || isNaN(d.getTime())) return "";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "1 day" : `${days} days`;
}

/** Textarea that grows with its content. Enter saves, Shift+Enter adds a line, Esc cancels. */
function FlagEditor({ initial, onSave, onCancel, placeholder }: { initial: string; onSave: (t: string) => void; onCancel: () => void; placeholder?: string }) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  // Enter saves and unmounts; a trailing blur must not save a second time
  const finished = useRef(false);
  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const t = text.trim();
    if (save && t && t !== initial) onSave(t);
    else onCancel();
  };
  useEffect(() => {
    const el = ref.current!;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  useEffect(() => {
    const el = ref.current!;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (text.trim()) finish(true);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      finish(false);
    }
  };
  return (
    <textarea
      ref={ref}
      className="flag-input"
      value={text}
      placeholder={placeholder}
      rows={2}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={onKey}
      onBlur={() => finish(true)}
    />
  );
}

function FlagCard({ flag }: { flag: ParsedFile }) {
  const { hold, bump, reportError, toast } = useHold();
  const nav = useNav();
  const [editing, setEditing] = useState(false);
  const color = colorOf(flag);

  const update = async (change: Parameters<typeof hold.updateFlag>[1]) => {
    try {
      await hold.updateFlag(flag.path, change);
      bump();
    } catch (e) {
      reportError(e);
    }
  };

  const nextColor = FLAG_COLORS[(FLAG_COLORS.indexOf(color) + 1) % FLAG_COLORS.length];

  return (
    <div className={`flag flag-${color}`}>
      {editing ? (
        <FlagEditor
          initial={flag.body}
          onSave={(t) => {
            setEditing(false);
            void update({ body: t });
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <button className="flag-text" onClick={() => setEditing(true)} title="Click to edit">
          {flag.body}
        </button>
      )}
      <div className="flag-foot">
        <span className="flag-age">{age(flag.frontmatter.created)}</span>
        <button className="flag-btn flag-swatch" onClick={() => update({ color: nextColor })} title={`Color: ${color} (click to change)`} aria-label="Change color" />
        <button className="flag-btn" onClick={() => nav.openFile(flag.path)} title="Open as a file" aria-label="Open as a file">
          ↗
        </button>
        <button
          className="flag-btn flag-lower"
          onClick={async () => {
            await update({ lowered: true });
            toast("Flag lowered");
          }}
          title="Done: lower this flag"
        >
          ✓ Done
        </button>
      </div>
    </div>
  );
}

/** Sticky notes that stay pinned until lowered. */
export function FlagBoard({ compact = false }: { compact?: boolean }) {
  const { hold, bump, reportError, focus } = useHold();
  const [adding, setAdding] = useState(false);
  const flags = hold.flags(focus, getSpace());

  const hoist = async (text: string) => {
    setAdding(false);
    try {
      await hold.hoistFlag(text, "yellow", focus, getSpace());
      bump();
    } catch (e) {
      reportError(e);
    }
  };

  if (compact && !flags.length && !adding) {
    return (
      <div className="flag-board compact empty-board">
        <button className="flag-add-inline" onClick={() => setAdding(true)}>
          + Hoist a flag
        </button>
      </div>
    );
  }

  return (
    <div className={`flag-board${compact ? " compact" : ""}`}>
      {flags.map((f) => (
        <FlagCard key={f.path} flag={f} />
      ))}
      {adding ? (
        <div className="flag flag-yellow">
          <FlagEditor initial="" placeholder="What needs to stay in view?" onSave={hoist} onCancel={() => setAdding(false)} />
          <div className="flag-foot">
            <span className="flag-age">Enter to hoist · Shift+Enter for a new line</span>
          </div>
        </div>
      ) : (
        <button className="flag flag-new" onClick={() => setAdding(true)}>
          + Hoist a flag
        </button>
      )}
    </div>
  );
}
