import { Check, Eraser, FilePlus, Flag, ListPlus, NotepadText, ScrollText } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { today } from "../../core/dates";
import { SCRATCH_PATH, linesOf, noteFromText, takeText } from "../../core/scratch";
import { confirmDialog } from "../../lib/platform";
import { useHold } from "../HoldContext";

const SAVE_DELAY = 400;

/**
 * One plain-text page for transient jottings (scratchpad.txt in the hold). No markdown.
 * Select text, or put the cursor on a line, and move it somewhere permanent.
 */
export function ScratchpadView() {
  const { hold, bump, reportError, toast } = useHold();
  const [text, setText] = useState<string | null>(null);
  const [status, setStatus] = useState<"saved" | "pending">("saved");
  const [hasSel, setHasSel] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef("");
  const saved = useRef("");

  const save = useCallback(async () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    if (latest.current === saved.current) return setStatus("saved");
    const content = latest.current;
    try {
      await hold.fs.write(SCRATCH_PATH, content);
      saved.current = content;
      if (latest.current === content) setStatus("saved");
    } catch (e) {
      reportError(e);
    }
  }, [hold, reportError]);

  // load, and reload when coming back to the window (Claude or another app may have edited it)
  useEffect(() => {
    const load = async () => {
      if (timer.current !== undefined) return; // don't clobber unsaved typing
      const content = (await hold.fs.exists(SCRATCH_PATH)) ? await hold.fs.read(SCRATCH_PATH) : "";
      if (content !== latest.current || text === null) {
        latest.current = saved.current = content;
        setText(content);
      }
    };
    void load().catch(reportError);
    window.addEventListener("focus", load);
    return () => {
      window.removeEventListener("focus", load);
      void save();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hold]);

  useEffect(() => {
    if (text !== null) area.current?.focus();
  }, [text === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (v: string) => {
    latest.current = v;
    setText(v);
    setStatus("pending");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(save, SAVE_DELAY);
  };

  /** Take the selection (or the cursor's line) out of the page and hand it to `use`. */
  const move = async (what: string, use: (taken: string) => Promise<string>) => {
    const el = area.current;
    if (!el) return;
    const { taken, rest, at } = takeText(el.value, el.selectionStart, el.selectionEnd);
    if (!taken) return toast("Select some text, or put the cursor on a line, first");
    try {
      const where = await use(taken);
      change(rest);
      await save();
      bump();
      toast(`${what} → ${where}`);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(at, at);
      });
    } catch (e) {
      reportError(e);
    }
  };

  const toNote = () =>
    move("Moved to a note", async (t) => {
      const { title, body } = noteFromText(t);
      const path = await hold.createNote(title);
      if (body) await hold.save(path, `${(await hold.fs.read(path)).replace(/\s+$/, "")}\n${body}\n`);
      return `“${hold.get(path)?.title ?? title}”`;
    });

  const toTasks = () =>
    move("Added as tasks", async (t) => {
      const log = await hold.ensureLog(today());
      await hold.appendTo(log, "Tasks", linesOf(t).map((l) => `- [ ] ${l}`).join("\n"));
      return "today's log";
    });

  const toLog = () =>
    move("Added to the log", async (t) => {
      const log = await hold.ensureLog(today());
      await hold.appendTo(log, "Log", linesOf(t).map((l) => `- ${l}`).join("\n"));
      return "today's log";
    });

  const toFlag = () =>
    move("Hoisted a flag", async (t) => {
      await hold.hoistFlag(t);
      return "the Flags board";
    });

  const clear = async () => {
    if (!text?.trim()) return;
    if (!(await confirmDialog("Clear the whole scratchpad? Anything you haven't moved is lost.", "Clear"))) return;
    change("");
    await save();
  };

  const syncSel = () => {
    const el = area.current;
    setHasSel(!!el && el.selectionStart !== el.selectionEnd);
  };
  const target = hasSel ? "selection" : "line";
  const words = text ? text.trim().split(/\s+/).filter(Boolean).length : 0;

  return (
    <div className="scratch-page">
      <header className="scratch-head">
        <div className="scratch-title">
          <NotepadText size={18} aria-hidden="true" />
          <h1>Scratchpad</h1>
          <span className={`save-status ${status}`} role="status">
            {status === "saved" ? <Check size={13} aria-hidden="true" /> : <span className="save-dot" aria-hidden="true" />}
            {status === "saved" ? "Saved" : "Edited"}
          </span>
        </div>
        <div className="scratch-actions" role="toolbar" aria-label={`Move the ${target}`}>
          <span className="muted small">Move {target} to:</span>
          <button onClick={toNote} title="New note: the first line becomes its title">
            <FilePlus size={14} aria-hidden="true" /> New note
          </button>
          <button onClick={toTasks} title="Each line becomes a task in today's log">
            <ListPlus size={14} aria-hidden="true" /> Tasks
          </button>
          <button onClick={toLog} title="Each line goes under Log in today's log">
            <ScrollText size={14} aria-hidden="true" /> Today's log
          </button>
          <button onClick={toFlag} title="Pin it as a Flag">
            <Flag size={14} aria-hidden="true" /> Flag
          </button>
          <span className="spacer" />
          <button className="ghost danger" onClick={clear} disabled={!text?.trim()} title="Empty the scratchpad">
            <Eraser size={14} aria-hidden="true" /> Clear
          </button>
        </div>
      </header>
      <textarea
        ref={area}
        className="scratch-area"
        value={text ?? ""}
        placeholder={"Jot anything here. No formatting, nothing to file.\n\nWhen something turns out to matter, select it (or put the cursor on its line) and move it with the buttons above."}
        spellCheck
        onChange={(e) => change(e.target.value)}
        onSelect={syncSel}
        onKeyUp={syncSel}
        onMouseUp={syncSel}
        onBlur={() => void save()}
        disabled={text === null}
        aria-label="Scratchpad"
      />
      <footer className="scratch-foot muted small">
        {words} word{words === 1 ? "" : "s"} · saved to <code>{SCRATCH_PATH}</code> in your Keel folder · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> opens it
      </footer>
    </div>
  );
}
