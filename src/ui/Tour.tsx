import { Clock, Compass, LucideIcon, NotebookPen, Zap } from "lucide-react";
import { ReactNode, useEffect, useState } from "react";
import { ClaudeIcon } from "./ClaudePanel";
import { KeelLogo } from "./Sidebar";

const DONE_KEY = "keel.tourDone";

export function tourSeen(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === "1";
  } catch {
    return true; // can't remember it, so don't nag on every launch
  }
}

function markSeen() {
  try {
    localStorage.setItem(DONE_KEY, "1");
  } catch {
    // ignore
  }
}

interface Step {
  icon: LucideIcon | "logo" | "claude";
  title: string;
  body: ReactNode;
}

const STEPS: Step[] = [
  {
    icon: "logo",
    title: "Welcome to Keel",
    body: (
      <>
        <p>Your day, your work and your notes, kept as plain markdown files in your Keel folder, so they stay readable in any editor.</p>
        <p>Here's a one-minute tour of the parts you'll use every day.</p>
      </>
    ),
  },
  {
    icon: Zap,
    title: "Capture anything, from anywhere",
    body: (
      <>
        <p>
          Press <kbd>Ctrl</kbd>+<kbd>K</kbd> in Keel, or <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>K</kbd> anywhere in Windows. Keel works out what
          you typed:
        </p>
        <ul>
          <li>
            <code>6h @project</code> logs hours · <code>@project what you did</code> adds to the day's work
          </li>
          <li>
            <code>todo …</code> · <code>wait Jordan: …</code> · <code>remind me 3pm …</code> · <code>flag …</code>
          </li>
          <li>
            <code>yesterday …</code> or <code>fri: …</code> for another day · <code>? question</code> asks Claude
          </li>
        </ul>
        <p>
          <kbd>Tab</kbd> switches the type if Keel guesses wrong, and <code>@</code> suggests your projects.
        </p>
      </>
    ),
  },
  {
    icon: NotebookPen,
    title: "One log per day",
    body: (
      <>
        <p>
          <b>Today</b> opens the day's log. Under <b>Work</b>, give each project one line with the day's hours, and list what you did under it.
          The <b>Work</b> panel beside the log does the same with a form.
        </p>
        <p>Unfinished tasks carry over to the next day on their own.</p>
      </>
    ),
  },
  {
    icon: Clock,
    title: "Timesheet and Dispatch",
    body: (
      <>
        <p>
          <b>Timesheet</b> lays your week out as projects × days, ready to copy into your time system: one cell, a row, the whole grid, or a
          project's tasks for one day with <b>☰</b>.
        </p>
        <p>
          <b>Dispatch</b> turns a client's week into a status update you can paste into an email.
        </p>
      </>
    ),
  },
  {
    icon: Compass,
    title: "Find your way around",
    body: (
      <ul>
        <li>
          <kbd>Ctrl</kbd>+<kbd>P</kbd> jumps to any note, log, project or client
        </li>
        <li>
          <kbd>Ctrl</kbd>+click opens things in a new tab · <kbd>Ctrl</kbd>+<kbd>W</kbd> closes one
        </li>
        <li>
          <kbd>Ctrl</kbd>+<kbd>B</kbd> folds the sidebar to icons
        </li>
        <li>
          <b>Charts</b> keep each client's URLs, servers and resource groups one click from the clipboard
        </li>
      </ul>
    ),
  },
  {
    icon: "claude",
    title: "Ask Claude",
    body: (
      <>
        <p>
          The spark at the bottom of the sidebar (or <kbd>Ctrl</kbd>+<kbd>`</kbd>) opens Claude Code right inside Keel, working in your Keel
          folder with your Claude account. Ask it to log hours, summarise a week or tidy up notes.
        </p>
        <p>You can replay this tour any time from Settings.</p>
      </>
    ),
  },
];

/** A short first-run walkthrough. Shown once; reopen from Settings. */
export function Tour({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;
  const close = () => {
    markSeen();
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") setI((n) => Math.min(n + 1, STEPS.length - 1));
      else if (e.key === "ArrowLeft") setI((n) => Math.max(n - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const Icon = step.icon;
  return (
    <div className="modal-backdrop">
      <div className="modal tour" role="dialog" aria-modal="true" aria-label="Keel tour">
        <div className="tour-icon">
          {Icon === "logo" ? <KeelLogo size={34} /> : Icon === "claude" ? <ClaudeIcon size={30} /> : <Icon size={28} aria-hidden="true" />}
        </div>
        <h2>{step.title}</h2>
        <div className="tour-body">{step.body}</div>
        <div className="tour-foot">
          <div className="tour-dots" aria-label={`Step ${i + 1} of ${STEPS.length}`}>
            {STEPS.map((_, n) => (
              <button key={n} className={n === i ? "on" : ""} onClick={() => setI(n)} aria-label={`Go to step ${n + 1}`} />
            ))}
          </div>
          <span className="spacer" />
          {!last && (
            <button className="ghost" onClick={close}>
              Skip
            </button>
          )}
          {i > 0 && <button onClick={() => setI(i - 1)}>Back</button>}
          <button className="primary" onClick={() => (last ? close() : setI(i + 1))} autoFocus>
            {last ? "Start using Keel" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
