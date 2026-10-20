import { formatShort, today } from "../core/dates";
import { Task } from "../core/parse";
import { useHold } from "./HoldContext";
import { useNav } from "./nav";

export function TaskRow({ task, showFile = true }: { task: Task; showFile?: boolean }) {
  const { hold, bump, reportError } = useHold();
  const nav = useNav();
  const done = task.status === "done";
  const file = hold.get(task.file);

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
      <input type="checkbox" checked={done} onChange={toggle} aria-label={`Mark "${task.text}" ${done ? "open" : "done"}`} />
      <button className="task-text" onClick={() => nav.openFile(task.file, task.line)}>
        {task.text}
      </button>
      {task.due && (
        <span className={`chip${task.due < today() && !done ? " chip-danger" : ""}`}>{formatShort(task.due)}</span>
      )}
      {showFile && file && <span className="task-file">{file.kind === "log" ? formatShort(file.date!) : file.title}</span>}
    </li>
  );
}
