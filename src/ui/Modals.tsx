import { useEffect, useMemo, useRef, useState } from "react";
import { CAPTURE_KINDS, Capture, CaptureKind, parseCapture } from "../core/capture";
import { formatShort, today } from "../core/dates";
import { useHold } from "./HoldContext";
import { useSpace } from "./space";
import { mentionAt, workTargets } from "./workTargets";

function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
}

const KIND_INFO: Record<CaptureKind, { label: string; hint: string }> = {
  log: { label: "Log", hint: "a timestamped line in the day's log" },
  task: { label: "Task", hint: "todo buy printer ink" },
  work: { label: "Work", hint: "6h @project · @project what you did" },
  waiting: { label: "Waiting", hint: "wait Jordan: firewall rules" },
  reminder: { label: "Remind", hint: "remind me 3pm call the bank" },
  flag: { label: "Flag", hint: "flag renew the TLS cert" },
  list: { label: "List", hint: "+ milk, eggs  ·  +Hardware: screws" },
  note: { label: "Note", hint: "> Note name: what to add" },
  scratch: { label: "Scratch", hint: "scratch: anything, added to the end of the scratchpad" },
  ask: { label: "Ask", hint: "? what did I do on FLIS this week" },
};

/** Quick capture: one box that logs, adds tasks/work/flags, appends to notes, or asks Claude. */
export function QuickCapture({
  onSubmit,
  onClose,
  focus,
  standalone,
  status,
  boxRef,
  initialKind,
}: {
  onSubmit: (c: Capture) => Promise<void>;
  onClose: () => void;
  focus?: string;
  /** In its own window: no backdrop */
  standalone?: boolean;
  /** Replaces the preview line (a confirmation or an error) */
  status?: { text: string; error?: boolean };
  boxRef?: React.Ref<HTMLDivElement>;
  /** Start on this type (e.g. "Log hours…" from the command list) */
  initialKind?: CaptureKind;
}) {
  const { hold } = useHold();
  const mode = useSpace();
  const [text, setText] = useState("");
  const [force, setForce] = useState<CaptureKind | undefined>(initialKind);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEscape(onClose);
  useEffect(() => input.current?.focus(), []);
  const parsed = parseCapture(text, undefined, focus, force);
  const current = parsed?.kind ?? force ?? "log";

  // @project / @client suggestions for the word at the caret
  const [caret, setCaret] = useState(0);
  const [sel, setSel] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const targets = useMemo(() => workTargets(hold), [hold]);
  const mention = mentionAt(text, caret, targets);
  const suggestions = mention && mention.options.length && dismissedAt !== mention.from ? mention : null;
  const syncCaret = () => setCaret(input.current?.selectionStart ?? text.length);

  const accept = (i: number) => {
    if (!suggestions) return;
    const opt = suggestions.options[i];
    const after = text.slice(suggestions.to);
    const insert = after.startsWith(" ") ? opt.insert : `${opt.insert} `;
    const next = text.slice(0, suggestions.from) + insert + after;
    const pos = suggestions.from + insert.length;
    setText(next);
    setCaret(pos);
    setSel(0);
    requestAnimationFrame(() => input.current?.setSelectionRange(pos, pos));
  };

  const submit = async () => {
    if (!parsed || parsed.error || busy) return;
    setBusy(true);
    try {
      await onSubmit(parsed);
    } finally {
      setBusy(false);
    }
  };

  const cycle = (dir: 1 | -1) => {
    const i = CAPTURE_KINDS.indexOf(current);
    const next = CAPTURE_KINDS[(i + dir + CAPTURE_KINDS.length) % CAPTURE_KINDS.length];
    setForce(next === parsed?.auto ? undefined : next);
  };

  const where = (c: Capture): string => {
    const space = c.kind === "work" ? "work" : (c.space ?? mode);
    // name the space only when it isn't the one Keel is in
    const sp = space !== mode ? `${space} ` : "";
    if (c.kind === "ask") return "Claude";
    if (c.kind === "flag") return `the ${sp}Flags board`;
    if (c.kind === "scratch") return "the scratchpad";
    if (c.kind === "list") return `${c.list?.name ?? "Shopping"} list`;
    if (c.kind === "note") {
      const path = c.note ? hold.resolveLink(c.note) : undefined;
      return path ? `note “${hold.get(path)?.title ?? c.note}”` : `new note “${c.note}”`;
    }
    return c.date ? `${formatShort(c.date)} ${sp}log` : `today's ${sp}log`;
  };

  const box = (
      <div ref={boxRef} className={`modal capture${standalone ? " standalone" : ""}`} role="dialog" aria-label="Quick capture" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          readOnly={busy}
          value={text}
          placeholder="Type anything · Tab changes the type · ? asks Claude · > Note: adds to a note · yesterday …"
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            setSel(0);
            if (!e.target.value.trim()) setForce(undefined);
          }}
          onSelect={syncCaret}
          onKeyDown={(e) => {
            if (suggestions) {
              const n = suggestions.options.length;
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => (s + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
                return;
              }
              if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
                e.preventDefault();
                accept(Math.min(sel, n - 1));
                return;
              }
              if (e.key === "Escape") {
                // close the list, not the whole capture box
                e.preventDefault();
                e.stopPropagation();
                setDismissedAt(suggestions.from);
                return;
              }
            }
            if (e.key === "Enter") void submit();
            else if (e.key === "Tab") {
              e.preventDefault();
              cycle(e.shiftKey ? -1 : 1);
            }
          }}
        />
        {suggestions && (
          <ul className="mention-list" role="listbox" aria-label="Projects and clients">
            {suggestions.options.map((o, i) => (
              <li key={o.insert}>
                <button
                  role="option"
                  aria-selected={i === sel}
                  className={i === sel ? "on" : ""}
                  onMouseDown={(e) => e.preventDefault()} // keep focus in the input
                  onMouseEnter={() => setSel(i)}
                  onClick={() => accept(i)}
                >
                  <code>{o.insert}</code>
                  <span className="muted small">{o.target.detail}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="capture-kinds" role="radiogroup" aria-label="Capture type">
          {CAPTURE_KINDS.map((k) => (
            <button
              key={k}
              role="radio"
              aria-checked={current === k}
              className={`capture-kind${current === k ? " on" : ""}${parsed?.auto === k && force && force !== k ? " auto" : ""}`}
              title={`${KIND_INFO[k].label}: ${KIND_INFO[k].hint}`}
              onMouseDown={(e) => e.preventDefault()} // keep focus in the input
              onClick={() => setForce(k === parsed?.auto ? undefined : k)}
            >
              {KIND_INFO[k].label}
            </button>
          ))}
        </div>
        <div className={`capture-preview${parsed?.error || status?.error ? " error" : ""}${status && !status.error ? " done" : ""}`} role="status">
          {status ? (
            <span>{status.error ? status.text : `✓ ${status.text}`}</span>
          ) : parsed ? (
            parsed.error ? (
              <span>{parsed.error}</span>
            ) : (
              <>
                <span className={`chip chip-${parsed.kind}`}>→ {where(parsed)}</span>
                <code>{parsed.kind === "ask" ? `“${parsed.ask}”` : parsed.line}</code>
              </>
            )
          ) : (
            <span className="muted">
              Enter to save · Tab / Shift+Tab to change type · Esc to cancel · e.g. <code>{KIND_INFO[current].hint}</code>
            </span>
          )}
        </div>
      </div>
  );
  if (standalone) return box;
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      {box}
    </div>
  );
}

export interface PromptSpec {
  title: string;
  label: string;
  /** Pre-filled value (selected, ready to overwrite) */
  initial?: string;
  /** Only the dropdown, no text box (e.g. "Move to folder") */
  noText?: boolean;
  placeholder?: string;
  withDate?: boolean;
  /** Optional dropdown (e.g. which client a project belongs to) */
  choice?: { label: string; options: { value: string; label: string }[]; initial?: string };
  submitLabel: string;
  onSubmit: (value: string, date: string, choice: string) => Promise<void>;
}

export function PromptModal({ spec, onClose }: { spec: PromptSpec; onClose: () => void }) {
  const [value, setValue] = useState(spec.initial ?? "");
  const [date, setDate] = useState(today());
  const [choice, setChoice] = useState(spec.choice?.initial ?? spec.choice?.options[0]?.value ?? "");
  const input = useRef<HTMLInputElement>(null);
  useEscape(onClose);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!spec.noText && !value.trim()) return;
    await spec.onSubmit(value.trim(), date, choice);
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="modal" role="dialog" aria-label={spec.title} onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{spec.title}</h2>
        {!spec.noText && (
          <label>
            {spec.label}
            <input ref={input} value={value} placeholder={spec.placeholder} onChange={(e) => setValue(e.target.value)} />
          </label>
        )}
        {spec.choice && (
          <label>
            {spec.choice.label}
            <select value={choice} onChange={(e) => setChoice(e.target.value)} autoFocus={spec.noText}>
              {spec.choice.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {spec.withDate && (
          <label>
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        )}
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!spec.noText && !value.trim()}>
            {spec.submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
