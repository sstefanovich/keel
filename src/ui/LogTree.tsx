import { ReactNode, useState } from "react";
import { addDays, formatShort, parseISO, startOfWeek, today } from "../core/dates";
import { round2 } from "../core/hold";
import { ParsedFile } from "../core/parse";
import { openOpts, useNav } from "./nav";
import { useWeekStart } from "./weekStart";

const OPEN_KEY = "keel.logTreeOpen";

function loadOpen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

const hoursOf = (logs: ParsedFile[]) => logs.reduce((s, f) => s + f.hours.reduce((a, h) => a + h.hours, 0), 0);
const hoursLabel = (h: number) => (h ? `${round2(h)}h` : "");
const monthName = (ym: string) => parseISO(`${ym}-01`).toLocaleDateString(undefined, { month: "long" });

/** Group by key, keeping first-seen order (input is newest first). */
function groupBy<T>(items: T[], key: (t: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const i of items) m.set(key(i), [...(m.get(key(i)) ?? []), i]);
  return [...m];
}

/**
 * Sidebar logs: the current timesheet week open at the top, older days folded into
 * Year › Month › Week (weeks use the timesheet's start day and file under the month they start in).
 */
export function LogTree({ logs, current }: { logs: ParsedFile[]; current?: string }) {
  const nav = useNav();
  const weekStart = useWeekStart();
  const [open, setOpen] = useState(loadOpen);
  const thisWeek = startOfWeek(today(), weekStart);
  const weekOf = (f: ParsedFile) => startOfWeek(f.date!, weekStart);

  const toggle = (key: string) => {
    const next = new Set(open);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
    } catch {
      // expansion just won't be remembered
    }
  };

  const dated = logs.filter((f) => f.date);
  // current week and anything after it (days browsed ahead) stay at the top
  const recent = dated.filter((f) => weekOf(f) >= thisWeek);
  const older = dated.filter((f) => weekOf(f) < thisWeek);

  const day = (f: ParsedFile, indent: number) => (
    <button
      key={f.path}
      className={`file-item tree-day${current === f.path ? " active" : ""}`}
      style={{ paddingLeft: 10 + indent * 12 }}
      onClick={(e) => nav.openFile(f.path, undefined, openOpts(e))}
      onAuxClick={(e) => e.button === 1 && nav.openFile(f.path, undefined, { newTab: true })}
      title={f.path}
    >
      <span>{formatShort(f.date!)}</span>
      <span className="tree-hours">{hoursLabel(hoursOf([f]))}</span>
    </button>
  );

  const branch = (key: string, label: string, items: ParsedFile[], indent: number, children: () => ReactNode) => {
    const isOpen = open.has(key);
    return (
      <div key={key}>
        <button className="file-item tree-branch" style={{ paddingLeft: 10 + indent * 12 }} onClick={() => toggle(key)} aria-expanded={isOpen}>
          <span>
            <span className={`tree-caret${isOpen ? " open" : ""}`}>›</span> {label}
          </span>
          <span className="tree-hours">{hoursLabel(hoursOf(items))}</span>
        </button>
        {isOpen && children()}
      </div>
    );
  };

  return (
    <>
      {recent.length ? (
        recent.map((f) => day(f, 0))
      ) : (
        <span className="file-item muted">Nothing this week yet</span>
      )}
      {groupBy(older, (f) => weekOf(f).slice(0, 4)).map(([year, yLogs]) =>
        branch(`y:${year}`, year, yLogs, 0, () =>
          groupBy(yLogs, (f) => weekOf(f).slice(0, 7)).map(([ym, mLogs]) =>
            branch(`m:${ym}`, monthName(ym), mLogs, 1, () =>
              groupBy(mLogs, weekOf).map(([ws, wLogs]) =>
                branch(`w:${ws}`, `${formatShort(ws).replace(/^\w+, /, "")} – ${formatShort(addDays(ws, 6)).replace(/^\w+, /, "")}`, wLogs, 2, () =>
                  wLogs.map((f) => day(f, 3)),
                ),
              ),
            ),
          ),
        ),
      )}
    </>
  );
}
