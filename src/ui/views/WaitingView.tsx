import { getSpace } from "../space";
import { formatShort, parseISO, today } from "../../core/dates";
import { Task, taskLabel } from "../../core/parse";
import { copyText } from "../../lib/platform";
import { useHold } from "../HoldContext";
import { useNav } from "../nav";
import { Hourglass } from "lucide-react";
import { EmptyState } from "../EmptyState";

const days = (since?: string) => (since ? Math.max(0, Math.round((parseISO(today()).getTime() - parseISO(since).getTime()) / 86_400_000)) : 0);

export function WaitingView() {
  const { hold, bump, reportError, toast, focus } = useHold();
  /** "Jordan: firewall rules @portal" → "firewall rules Portal" (they're listed under Jordan) */
  const what = (t: Task) => taskLabel(t, (k) => hold.keyName(k));
  const nav = useNav();
  const items = hold.waitingOn(focus, getSpace());
  const clients = hold.clients();

  const groups = new Map<string, Task[]>();
  for (const t of items) {
    const who = t.waiting || "Unassigned";
    groups.set(who, [...(groups.get(who) ?? []), t]);
  }
  // people waited on longest first
  const ordered = [...groups].sort((a, b) => (a[1][0].since ?? "").localeCompare(b[1][0].since ?? ""));

  const done = async (t: Task) => {
    try {
      await hold.setTaskStatus(t, "done");
      bump();
      toast("Marked received");
    } catch (e) {
      reportError(e);
    }
  };

  const copyFollowUp = async (who: string, tasks: Task[]) => {
    const first = who === "Unassigned" ? "Hi" : `Hi ${who.split(" ")[0]}`;
    const lines = tasks.map((t) => `- ${what(t).replace(/(^|\s)#[\w/-]+/g, "$1").trim()}${t.since ? ` (since ${formatShort(t.since)})` : ""}`);
    await copyText(`${first}, just following up on:\n${lines.join("\n")}\n\nThanks!`);
    toast("Follow-up copied");
  };

  return (
    <div className="page flat">
      <header className="page-head">
        <h1>Waiting on</h1>
        <p className="muted">
          Anything marked <code>@waiting(Name)</code>, or captured with <code>wait Name: what</code>. Oldest first.
        </p>
      </header>

      {!items.length && (
        <EmptyState icon={Hourglass} title="Nobody owes you anything right now" actions={<button onClick={nav.capture}>Capture a waiting item…</button>}>
          <p>
            When you're waiting on someone, add <code>@waiting(Jordan)</code> to a task, or quick capture <code>wait Jordan: firewall rules</code>.
            It shows up here with how long it's been.
          </p>
        </EmptyState>
      )}

      {ordered.map(([who, tasks]) => (
        <section key={who} className="panel">
          <div className="row-between">
            <h2>
              {who} <span className="count">{tasks.length}</span>
            </h2>
            <button className="ghost small" onClick={() => copyFollowUp(who, tasks)} title="Copy a follow-up message">
              Copy follow-up
            </button>
          </div>
          <ul className="tasks">
            {tasks.map((t) => {
              const d = days(t.since);
              const client = hold.taskClient(t);
              return (
                <li key={t.file + t.line} className="task">
                  <input type="checkbox" checked={false} onChange={() => done(t)} aria-label={`Mark "${what(t)}" received`} />
                  <button className="task-text" onClick={() => nav.openFile(t.file, t.line)}>
                    {what(t)}
                  </button>
                  {client && !focus && <span className="chip">{clients.get(client)?.name ?? client}</span>}
                  <span className={`chip${d >= 7 ? " chip-danger" : d >= 3 ? " chip-warn" : ""}`}>{d === 0 ? "today" : `${d}d`}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
