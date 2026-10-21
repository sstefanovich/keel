import { useEffect, useRef, useState } from "react";
import { ChartRow } from "../ChartRow";
import { useHold } from "../HoldContext";
import { useNav } from "../nav";

/** All client & project Charts, with search across every reference item. */
export function ChartsView() {
  const { hold, focus } = useHold();
  const nav = useNav();
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const clients = [...hold.clients().values()].filter((c) => !focus || c.key === focus).sort((a, b) => a.name.localeCompare(b.name));
  const allKeys = new Set(hold.clients().keys());
  const orphans = focus
    ? []
    : hold.all().filter((f) => f.kind === "project" && !allKeys.has(String(f.frontmatter.client ?? "").toLowerCase()));
  const results = hold.chartSearch(q, focus);

  return (
    <div className="page">
      <header className="page-head row">
        <div>
          <h1>Charts</h1>
          <p className="muted">Reference details for each client and project: URLs, servers, resource groups, contacts.</p>
        </div>
        <div className="toolbar">
          <button onClick={() => nav.newItem("client")}>New client</button>
          <button onClick={() => nav.newItem("project")}>New project</button>
        </div>
      </header>

      <input
        ref={input}
        className="search-input"
        placeholder="Find a server, URL, resource group… across every client"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {q.trim() ? (
        <section className="panel" style={{ marginTop: 14 }}>
          <h2>
            Matches <span className="count">{results.length}</span>
          </h2>
          {results.map(({ item, file }) => (
            <ChartRow
              key={file.path + item.line}
              item={{ ...item, indent: 0 }}
              context={`${file.title}${item.section ? ` · ${item.section}` : ""}`}
              onContext={() => nav.openFile(file.path)}
            />
          ))}
          {!results.length && <p className="empty">No chart items match.</p>}
        </section>
      ) : (
        <div className="chart-cards">
          {clients.map((c) => {
            const projects = hold.projectsOf(c.key);
            const n = hold.get(c.path!)?.chart.length ?? 0;
            return (
              <section key={c.key} className="panel chart-card">
                <h3>
                  <button className="link" onClick={() => nav.openFile(c.path!)}>
                    {c.name}
                  </button>
                </h3>
                <p className="muted small">
                  {n} item{n === 1 ? "" : "s"} · @{c.key}
                </p>
                <div className="chips-row">
                  {projects.map((p) => (
                    <button key={p.path} className="project-chip" onClick={() => nav.openFile(p.path)}>
                      {p.title}
                    </button>
                  ))}
                  <button className="ghost small" onClick={() => nav.newItem("project", c.key)}>
                    + project
                  </button>
                </div>
              </section>
            );
          })}
          {orphans.length > 0 && (
            <section className="panel chart-card">
              <h3>Projects without a client</h3>
              <div className="chips-row">
                {orphans.map((p) => (
                  <button key={p.path} className="project-chip" onClick={() => nav.openFile(p.path)}>
                    {p.title}
                  </button>
                ))}
              </div>
            </section>
          )}
          {!clients.length && !orphans.length && (
            <p className="empty">
              No clients yet. Create one, then add items like <code>- Resource group: rg-acme-prod</code>. Every bullet gets a copy button.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
