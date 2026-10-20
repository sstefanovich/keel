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
  hours: "Hours → today's log",
  task: "Task → today's log",
  reminder: "Reminder → today's log",
  log: "Log entry → today's log",
};

export function QuickCapture({ onSubmit, onClose }: { onSubmit: (text: string) => Promise<void>; onClose: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEscape(onClose);
  useEffect(() => input.current?.focus(), []);
  const parsed = parseCapture(text);

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
  submitLabel: string;
  onSubmit: (value: string, date: string) => Promise<void>;
}

export function PromptModal({ spec, onClose }: { spec: PromptSpec; onClose: () => void }) {
  const [value, setValue] = useState("");
  const [date, setDate] = useState(today());
  const input = useRef<HTMLInputElement>(null);
  useEscape(onClose);
  useEffect(() => input.current?.focus(), []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    await spec.onSubmit(value.trim(), date);
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="modal" role="dialog" aria-label={spec.title} onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{spec.title}</h2>
        <label>
          {spec.label}
          <input ref={input} value={value} placeholder={spec.placeholder} onChange={(e) => setValue(e.target.value)} />
        </label>
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
