import { Eraser, ListPlus, Plus, ShoppingCart } from "lucide-react";
import { useState } from "react";
import { DEFAULT_LIST } from "../../core/capture";
import { ParsedFile, Task } from "../../core/parse";
import { EmptyState } from "../EmptyState";
import { useHold } from "../HoldContext";
import { openOpts, useNav } from "../nav";

/** One list as a card: tick items off, add more, clear the ticked ones. */
function ListCard({ file }: { file: ParsedFile }) {
  const { hold, bump, reportError, toast } = useHold();
  const nav = useNav();
  const [text, setText] = useState("");
  const items = file.tasks.filter((t) => t.status === "open" || t.status === "done");
  const open = items.filter((t) => t.status === "open");
  const done = items.filter((t) => t.status === "done");

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      bump();
    } catch (e) {
      reportError(e);
    }
  };
  const toggle = (t: Task) => run(() => hold.toggleListItem(t));
  const add = () => {
    const items = text.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    if (!items.length) return;
    setText("");
    void run(() => hold.addToListFile(file.path, items));
  };
  const clear = () =>
    run(async () => {
      const n = await hold.clearDone(file.path);
      toast(`Cleared ${n} item${n === 1 ? "" : "s"}`);
    });

  return (
    <section className="list-card">
      <header>
        <button className="link list-title" onClick={(e) => nav.openFile(file.path, undefined, openOpts(e))} title="Open as a note">
          {file.title}
        </button>
        <span className="count">{open.length}</span>
        {done.length > 0 && (
          <button className="ghost small icon-text" onClick={clear} title="Remove the ticked items">
            <Eraser size={13} aria-hidden="true" /> Clear {done.length}
          </button>
        )}
      </header>
      <ul className="list-items">
        {[...open, ...done].map((t) => (
          <li key={t.line} className={t.status === "done" ? "done" : ""}>
            <label>
              <input type="checkbox" checked={t.status === "done"} onChange={() => toggle(t)} />
              <span>{t.text}</span>
            </label>
          </li>
        ))}
        {!items.length && <li className="muted small">Nothing on it yet.</li>}
      </ul>
      <div className="list-add">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Add… (commas for several)"
          aria-label={`Add to ${file.title}`}
        />
        <button className="icon-btn" onClick={add} disabled={!text.trim()} aria-label="Add">
          <Plus size={15} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

/** Personal checklists: shopping, gift ideas, packing, books… each a markdown file in personal/lists. */
export function ListsView() {
  const { hold, bump, reportError } = useHold();
  const nav = useNav();
  const lists = hold.lists();
  // Shopping first, then the rest by most recently used
  const sorted = [...lists].sort((a, b) => Number(b.title === DEFAULT_LIST) - Number(a.title === DEFAULT_LIST));

  const newList = () =>
    nav.prompt({
      title: "New list",
      label: "Name",
      placeholder: "Gift ideas, Packing, Books to read…",
      submitLabel: "Create",
      onSubmit: async (name) => {
        await hold.createList(name);
        bump();
      },
    });

  const startShopping = async () => {
    try {
      await hold.createList(DEFAULT_LIST);
      bump();
    } catch (e) {
      reportError(e);
    }
  };

  return (
    <div className="page lists-page">
      <header className="page-head row">
        <div>
          <h1>Lists</h1>
          <p className="muted">
            Quick capture <code>+ milk, eggs</code> adds to Shopping; <code>+Hardware: screws</code> to any list.
          </p>
        </div>
        <div className="toolbar">
          <button onClick={newList}>
            <ListPlus size={15} aria-hidden="true" /> New list
          </button>
        </div>
      </header>
      {sorted.length ? (
        <div className="list-grid">
          {sorted.map((f) => (
            <ListCard key={f.path} file={f} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={ShoppingCart}
          title="No lists yet"
          actions={
            <>
              <button className="primary" onClick={startShopping}>
                Start a shopping list
              </button>
              <button onClick={newList}>Another list…</button>
            </>
          }
        >
          <p>Shopping, gift ideas, packing, books to read: tick things off as you go and clear them when done.</p>
        </EmptyState>
      )}
    </div>
  );
}
