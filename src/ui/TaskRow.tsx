import { formatShort, today } from "../core/dates";
import { Hold } from "../core/hold";
import { Task, taskLabel } from "../core/parse";
import { useHold } from "./HoldContext";
import { useNav } from "./nav";

/**
 * A task's label and the project or client it's filed under by a #tag or @key, shown by name.
 * The @key behind `ownerName` goes from the label; other known keys read as their names.
 */
export function taskWithOwner(hold: Hold, task: Task): { label: string; ownerName?: string } {
  const owner = task.tags.length || task.mentions.length ? hold.taskProject(task) : undefined;
  const ownerName = owner ? (owner.project && hold.projectByKey(owner.project) ? hold.projectName(owner.project) : hold.clients().get(owner.client)?.name) : undefined;
  const label = taskLabel(task, (k) => {
    const name = hold.keyName(k);
    return name && name === ownerName ? "" : name;
  });
  return { label, ownerName };
}

/**
 * A task in a list. `inToday`: it's in a "today" list, so a due date of today and today's log as
 * its source go without saying.
 */
export function TaskRow({
  task,
  showFile = true,
  inToday = false,
  showDue: showDueChip = true,
}: {
  task: Task;
  showFile?: boolean;
  inToday?: boolean;
  /** Off where the list is already grouped by due date */
  showDue?: boolean;
}) {
  const { hold, bump, reportError } = useHold();
  const nav = useNav();
  const done = task.status === "done";
  const file = hold.get(task.file);
  const t = today();
  const { label, ownerName } = taskWithOwner(hold, task);
  const showDue = showDueChip && task.due && !(inToday && task.due === t);
  const fromToday = file?.kind === "log" && file.date === t;

  const toggle = async () => {
    try {
      await hold.setTaskStatus(task, done ? "open" : "done");
      bump();
    } catch (e) {
      reportError(e);
    }
  };

  return (
    <li className={`task${done ? " task-done" : ""}`}>
      <input type="checkbox" checked={done} onChange={toggle} aria-label={`Mark "${label}" ${done ? "open" : "done"}`} />
      <button className="task-text" onClick={() => nav.openFile(task.file, task.line)}>
        {label}
      </button>
      {ownerName && <span className="chip chip-project">{ownerName}</span>}
      {showDue && (
        <span className={`chip${task.due! < t && !done ? " chip-danger" : ""}`}>{task.due === t ? "today" : formatShort(task.due!)}</span>
      )}
      {showFile && file && !(inToday && fromToday) && (
        <span className="task-file">{file.kind === "log" ? (fromToday ? "today's log" : formatShort(file.date!)) : file.title}</span>
      )}
    </li>
  );
}
