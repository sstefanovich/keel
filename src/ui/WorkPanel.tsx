import { useEffect, useState } from "react";
import { round2 } from "../core/hold";
import { HoursEntry, ParsedFile, basename } from "../core/parse";
import { slugify } from "../core/templates";
import { useHold } from "./HoldContext";
import { flushEditors } from "./editor/Editor";
import { MeetingHours } from "./MeetingHours";

/** "portal-rebuild" → "Portal rebuild · Contoso" for display. */
export function useWorkLabel() {
  const { hold } = useHold();
  return (key: string) => {
    const r = hold.resolveHours(key);
    const client = hold.clients().get(r.client);
    if (r.project && hold.projectByKey(r.project)) return { name: hold.projectName(r.project), sub: client?.name ?? r.client, known: true };
    if (client) return { name: client.name, sub: "general", known: true };
    return { name: `@${key}`, sub: "not a known client or project", known: false };
  };
}

function HoursInput({ entry, onSave }: { entry: HoursEntry; onSave: (h: number) => void }) {
  const [v, setV] = useState(entry.hours ? String(round2(entry.hours)) : "");
  useEffect(() => setV(entry.hours ? String(round2(entry.hours)) : ""), [entry.hours]);
  const commit = () => {
    const h = v.trim() === "" ? 0 : Number(v);
    if (!isNaN(h) && h >= 0 && h !== entry.hours) onSave(h);
  };
  return (
    <span className="work-hours">
      <input
        type="number"
        step="0.25"
        min="0"
        value={v}
        placeholder="—"
        aria-label="Hours"
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className={entry.hours ? "" : "missing"}
      />
      h
    </span>
  );
}

function AddItem({ onAdd }: { onAdd: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <input
      className="work-add"
      value={text}
      placeholder="+ what you did…"
      aria-label="Add a done item"
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && text.trim()) {
          onAdd(text.trim());
          setText("");
        }
      }}
    />
  );
}

/** Per-project hours and done items for one day's log, editable without touching the markdown. */
export function WorkPanel({ file }: { file: ParsedFile }) {
  const { hold, bump, reportError, focus } = useHold();
  const label = useWorkLabel();
  const blocks = file.hours;
  const total = blocks.reduce((s, b) => s + b.hours, 0);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await flushEditors();
      await fn();
      bump();
    } catch (e) {
      reportError(e);
    }
  };
  // Lines may have moved after the editor saved; re-find the block (called after flushEditors)
  const fresh = (b: HoursEntry) => {
    const now = hold.get(file.path)?.hours ?? [];
    const found = now.find((h) => h.line === b.line && h.client === b.client) ?? now.find((h) => h.client === b.client);
    if (!found) throw new Error("That project's line changed in the editor; try again.");
    return found;
  };

  const used = new Set(blocks.map((b) => b.client));
  const clients = [...hold.clients().values()].sort((a, b) => a.name.localeCompare(b.name));
  const allOptions = clients
    .filter((c) => !focus || c.key === focus)
    .flatMap((c) => [
      ...hold
        .projectsOf(c.key)
        .filter((p) => p.frontmatter.status !== "done")
        .map((p) => ({ key: slugify(basename(p.path)), text: `${p.title} · ${c.name}` })),
      { key: c.key, text: `${c.name} (general)` },
    ]);
  const options = allOptions.filter((o) => !used.has(o.key));

  return (
    <section className="work-panel">
      <header>
        <h3>Work</h3>
        {total > 0 && <span className="chip">{round2(total)}h</span>}
      </header>
      {!blocks.length && (
        <p className="muted small">
          Add the projects you worked on, then list what you did under each and fill in the day's hours.
          {!clients.length && " Set up clients and projects in Settings first."}
        </p>
      )}
      {blocks.map((b) => {
        const l = label(b.client);
        return (
          <div key={`${b.line}-${b.client}`} className="work-block">
            <div className="work-head">
              <span className={`work-name${l.known ? "" : " unknown"}`} title={`@${b.client}`}>
                {l.name}
                <span className="muted small"> · {l.sub}</span>
              </span>
              <HoursInput entry={b} onSave={(h) => run(() => hold.setWorkHours(fresh(b), h))} />
            </div>
            {b.items.length > 0 && (
              <ul className="work-items">
                {b.items.map((it, i) => (
                  <li key={i}>{it}</li>
                ))}
              </ul>
            )}
            <AddItem onAdd={(t) => run(() => hold.addWorkItem(fresh(b), t))} />
          </div>
        );
      })}
      {/* own full-width row: long project names would otherwise push the panel off-screen */}
      <select
        className="work-add-project"
        value=""
        aria-label="Add a project to this day"
        onChange={(e) => e.target.value && run(() => hold.logWork(file.date!, e.target.value, {}))}
      >
        <option value="">+ Add project…</option>
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.text}
          </option>
        ))}
      </select>
      <MeetingHours file={file} options={allOptions} run={run} />
    </section>
  );
}
