import { useEffect, useRef, useState } from "react";
import { parseCapture } from "../core/capture";
import { today } from "../core/dates";

function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
}

const KIND_LABEL = {
  hours: "Hours → today's work",
  work: "Done item → today's work",
  task: "Task → today's log",
  reminder: "Reminder → today's log",
  log: "Log entry → today's log",
  flag: "Flag → pinned on the board",
  waiting: "Waiting on → today's log",
};

export function QuickCapture({ onSubmit, onClose, focus }: { onSubmit: (text: string) => Promise<void>; onClose: () => void; focus?: string }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEscape(onClose);
  useEffect(() => input.current?.focus(), []);
  const parsed = parseCapture(text, undefined, focus);

  const submit = async () => {
    if (!parsed || busy) return;
    setBusy(true);
    try {
      await onSubmit(text);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal capture" role="dialog" aria-label="Quick capture" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          value={text}
          placeholder="2h @acme refactor · todo buy ink · remind me 3pm call bank · or just a thought"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <div className="capture-preview">
          {parsed ? (
            <>
              <span className={`chip chip-${parsed.kind}`}>{KIND_LABEL[parsed.kind]}</span>
              <code>{parsed.line}</code>
            </>
          ) : (
            <span className="muted">Enter to save · Esc to cancel</span>
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
