import { getSpace } from "../space";
import { formatShort } from "../../core/dates";
import { FlagBoard } from "../FlagBoard";
import { useHold } from "../HoldContext";
import { useNav } from "../nav";

export function FlagsView() {
  const { hold, bump, reportError } = useHold();
  const nav = useNav();
  const lowered = hold.loweredFlags(getSpace());

  const rehoist = async (path: string) => {
    try {
      await hold.updateFlag(path, { lowered: false });
      bump();
    } catch (e) {
      reportError(e);
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>Flags</h1>
        <p className="muted">Sticky notes that stay pinned on Today and the Agenda until you mark them done.</p>
      </header>
      <FlagBoard />
      <section className="panel" style={{ marginTop: 24 }}>
        <h2>
          Lowered <span className="count">{lowered.length}</span>
        </h2>
        {lowered.length ? (
          <ul className="tasks">
            {lowered.slice(0, 100).map((f) => (
              <li key={f.path} className="task task-done">
                <span className="time muted">{formatShort(String(f.frontmatter.lowered))}</span>
                <button className="task-text" onClick={() => nav.openFile(f.path)}>
                  {f.title}
                </button>
                <button className="ghost small" onClick={() => rehoist(f.path)}>
                  Hoist again
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">Nothing lowered yet.</p>
        )}
      </section>
    </div>
  );
}
