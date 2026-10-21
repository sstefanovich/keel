import { useEffect, useState } from "react";
import { ParsedFile, basename } from "../core/parse";
import { slugify } from "../core/templates";
import { confirmDialog } from "../lib/platform";
import { useHold } from "./HoldContext";
import { useNav } from "./nav";

const STATUSES = ["active", "paused", "done"];

/** Text/number input that saves on Enter or blur, not on every keystroke. */
function Field({ value, onCommit, placeholder, className, label }: { value: string; onCommit: (v: string) => void; placeholder?: string; className?: string; label: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    if (v.trim() !== value) onCommit(v.trim());
  };
  return (
    <input
      className={className}
      type="text"
      value={v}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setV(value);
      }}
    />
  );
}

/** Settings section: add, edit and remove clients and projects. */
export function ClientsManager() {
  const { hold, bump, reportError, toast } = useHold();
  const nav = useNav();
  const [newClient, setNewClient] = useState("");
  const [newProject, setNewProject] = useState("");
  const clients = [...hold.clients().values()].sort((a, b) => a.name.localeCompare(b.name));
  const keys = new Set(clients.map((c) => c.key));
  // undefined = not chosen yet (default to the first client); "" = deliberately no client
  const [projectClient, setProjectClient] = useState<string | undefined>(undefined);
  const pc = projectClient === "" || (projectClient && keys.has(projectClient)) ? projectClient : (clients[0]?.key ?? "");
  const orphans = hold.all().filter((f) => f.kind === "project" && !keys.has(hold.fileClient(f) ?? ""));

  const run = async (fn: () => Promise<unknown>, msg?: string) => {
    try {
      await fn();
      bump();
      if (msg) toast(msg);
    } catch (e) {
      reportError(e);
    }
  };

  const removeFile = async (f: ParsedFile, what: string, extra = "") => {
    if (await confirmDialog(`Delete ${what} "${f.title}"? Its file is removed from disk.${extra}`, "Delete")) {
      await run(() => hold.remove(f.path), `${what[0].toUpperCase()}${what.slice(1)} deleted`);
    }
  };

  const addClient = async () => {
    const name = newClient.trim();
    if (!name) return;
    if (keys.has(slugify(name))) return reportError(new Error(`A client with the key @${slugify(name)} already exists.`));
    await run(() => hold.createClient(name), `Client added: @${slugify(name)}`);
    setNewClient("");
    setProjectClient(slugify(name));
  };

  const addProject = async () => {
    const name = newProject.trim();
    if (!name) return;
    await run(() => hold.createProject(name, pc), "Project added");
    setNewProject("");
  };

  const projectRow = (p: ParsedFile) => {
    const status = typeof p.frontmatter.status === "string" ? p.frontmatter.status : "active";
    const owner = hold.fileClient(p) ?? "";
    return (
      <tr key={p.path} className="project-row">
        <td>
          <button className="link" onClick={() => nav.openFile(p.path)}>
            ↳ {p.title}
          </button>
        </td>
        <td>
          <code className="key">@{owner ? `${owner}/` : ""}{slugify(basename(p.path))}</code>
        </td>
        <td>
          <select value={owner} aria-label={`Client of ${p.title}`} onChange={(e) => run(() => hold.updateFrontmatter(p.path, { client: e.target.value }))}>
            {clients.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
            <option value="">(no client)</option>
          </select>
        </td>
        <td>
          <select value={STATUSES.includes(status) ? status : "active"} aria-label={`Status of ${p.title}`} onChange={(e) => run(() => hold.updateFrontmatter(p.path, { status: e.target.value }))}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </td>
        <td className="actions">
          <button className="ghost small danger" onClick={() => removeFile(p, "project")}>
            Delete
          </button>
        </td>
      </tr>
    );
  };

  return (
    <>
      {clients.length > 0 || orphans.length > 0 ? (
        <table className="table manage-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Hours tag</th>
              <th>Client</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          {clients.map((c) => {
            const file = hold.get(c.path!)!;
            const projects = hold.projectsOf(c.key);
            return (
              <tbody key={c.key}>
                <tr className="client-row">
                  <td>
                    <Field value={c.name} label={`Name of ${c.name}`} onCommit={(v) => v && run(() => hold.updateFrontmatter(c.path!, { name: v }))} />
                  </td>
                  <td>
                    <code className="key" title="Used in hours lines and #tags. Fixed, so existing hours stay linked.">@{c.key}</code>
                  </td>
                  <td />
                  <td />
                  <td className="actions">
                    <button className="ghost small" onClick={() => nav.openFile(c.path!)}>
                      Chart
                    </button>
                    <button
                      className="ghost small danger"
                      onClick={() =>
                        removeFile(file, "client", projects.length ? ` Its ${projects.length} project${projects.length === 1 ? "" : "s"} will be kept without a client.` : "")
                      }
                    >
                      Delete
                    </button>
                  </td>
                </tr>
                {projects.map(projectRow)}
              </tbody>
            );
          })}
          {orphans.length > 0 && (
            <tbody>
              <tr>
                <td colSpan={5} className="muted small">
                  Projects without a client
                </td>
              </tr>
              {orphans.map(projectRow)}
            </tbody>
          )}
        </table>
      ) : (
        <p className="empty">No clients yet. Add one below; projects, hours, Focus and Dispatch all build on them.</p>
      )}

      <div className="manage-add">
        <input value={newClient} placeholder="New client name, e.g. Contoso" aria-label="New client name" onChange={(e) => setNewClient(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addClient()} />
        <button onClick={addClient} disabled={!newClient.trim()}>
          Add client
        </button>
      </div>
      <div className="manage-add">
        <input value={newProject} placeholder="New project name, e.g. Portal rebuild" aria-label="New project name" onChange={(e) => setNewProject(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addProject()} />
        <select value={pc} onChange={(e) => setProjectClient(e.target.value)} aria-label="Client for the new project">
          {clients.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name}
            </option>
          ))}
          <option value="">(no client)</option>
        </select>
        <button onClick={addProject} disabled={!newProject.trim()}>
          Add project
        </button>
      </div>
      <p className="muted small">
        A client's hours tag comes from its name when it's created and stays fixed. Renaming the client only changes how it's displayed.
      </p>
    </>
  );
}
