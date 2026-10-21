import { useEffect, useRef, useState } from "react";
import { CAPTURE_KINDS, Capture, CaptureKind, parseCapture } from "../core/capture";
import { formatShort, today } from "../core/dates";
import { useHold } from "./HoldContext";

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
  note: { label: "Note", hint: "> Note name: what to add" },
  ask: { label: "Ask", hint: "? what did I do on FLIS this week" },
};

/** Quick capture: one box that logs, adds tasks/work/flags, appends to notes, or asks Claude. */
export function QuickCapture({ onSubmit, onClose, focus }: { onSubmit: (c: Capture) => Promise<void>; onClose: () => void; focus?: string }) {
  const { hold } = useHold();
  const [text, setText] = useState("");
  const [force, setForce] = useState<CaptureKind | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEscape(onClose);
  useEffect(() => input.current?.focus(), []);
  const parsed = parseCapture(text, undefined, focus, force);
  const current = parsed?.kind ?? force ?? "log";

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
    if (c.kind === "ask") return "Claude";
    if (c.kind === "flag") return "the Flags board";
    if (c.kind === "note") {
      const path = c.note ? hold.resolveLink(c.note) : undefined;
      return path ? `note “${hold.get(path)?.title ?? c.note}”` : `new note “${c.note}”`;
    }
    return c.date ? `${formatShort(c.date)} log` : "today's log";
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal capture" role="dialog" aria-label="Quick capture" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          value={text}
          placeholder="Type anything · Tab changes the type · ? asks Claude · > Note: adds to a note · yesterday …"
          onChange={(e) => {
            setText(e.target.value);
            if (!e.target.value.trim()) setForce(undefined);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
            else if (e.key === "Tab") {
              e.preventDefault();
              cycle(e.shiftKey ? -1 : 1);
            }
          }}
        />
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
        <div className={`capture-preview${parsed?.error ? " error" : ""}`}>
          {parsed ? (
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
    </div>
  );
}

export interface PromptSpec {
  title: string;
  label: string;
  placeholder?: string;
  withDate?: boolean;
  /** Optional dropdown (e.g. which client a project belongs to) */
  choice?: { label: string; options: { value: string; label: string }[]; initial?: string };
  submitLabel: string;
  onSubmit: (value: string, date: string, choice: string) => Promise<void>;
}

export function PromptModal({ spec, onClose }: { spec: PromptSpec; onClose: () => void }) {
  const [value, setValue] = useState("");
  const [date, setDate] = useState(today());
  const [choice, setChoice] = useState(spec.choice?.initial ?? spec.choice?.options[0]?.value ?? "");
  const input = useRef<HTMLInputElement>(null);
  useEscape(onClose);
  useEffect(() => input.current?.focus(), []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    await spec.onSubmit(value.trim(), date, choice);
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="modal" role="dialog" aria-label={spec.title} onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{spec.title}</h2>
        <label>
          {spec.label}
          <input ref={input} value={value} placeholder={spec.placeholder} onChange={(e) => setValue(e.target.value)} />
        </label>
        {spec.choice && (
          <label>
            {spec.choice.label}
            <select value={choice} onChange={(e) => setChoice(e.target.value)}>
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
          <button type="submit" className="primary" disabled={!value.trim()}>
            {spec.submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
