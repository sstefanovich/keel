import { useState } from "react";
import { azureContext, azurePortalUrl } from "../../core/azure";
import { ChartItem, basename, headingsOf } from "../../core/parse";
import { slugify } from "../../core/templates";
import { ChartRow } from "../ChartRow";
import { SnippetBlock } from "../Snippet";
import { useHold } from "../HoldContext";
import { useNav } from "../nav";

function AddInput({ placeholder, onAdd }: { placeholder: string; onAdd: (text: string) => Promise<void> }) {
  const [text, setText] = useState("");
  return (
    <input
      className="chart-add"
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={async (e) => {
        if (e.key === "Enter" && text.trim()) {
          await onAdd(text.trim());
          setText("");
        } else if (e.key === "Escape") setText("");
      }}
    />
  );
}

/** Reference view of a client or project: its bullets grouped by section, with copy/open. */
export function ChartView({ path }: { path: string }) {
  const { hold, bump, reportError } = useHold();
  const nav = useNav();
  const [filter, setFilter] = useState("");
  const file = hold.get(path)!;

  const q = filter.trim().toLowerCase();
  const items = file.chart.filter((i) => !q || `${i.label ?? ""} ${i.value} ${i.section}`.toLowerCase().includes(q));
  const hasGeneral = file.chart.some((i) => i.section === "") || file.snippets.some((s) => s.section === "");
  const sections = [...(hasGeneral ? [""] : []), ...new Set(headingsOf(file.content))];

  const add = (section: string) => async (text: string) => {
    try {
      await hold.appendTo(path, section, `- ${text}`);
      bump();
    } catch (e) {
      reportError(e);
    }
  };

  const key = basename(path).toLowerCase();
  const client = file.kind === "client" ? hold.clients().get(key) : undefined;
  const projects = file.kind === "client" ? hold.projectsOf(key) : [];
  const parentKey = file.kind === "project" ? String(file.frontmatter.client ?? "").toLowerCase() : "";
  const parent = parentKey ? hold.clients().get(parentKey) : undefined;
  // projects inherit the client's tenant/subscription for portal links
  const parentChart = parent?.path ? hold.get(parent.path)?.chart ?? [] : [];
  const portalUrl = (i: ChartItem) => azurePortalUrl(i, azureContext(file.chart, i.line, parentChart));
  const snippets = file.snippets.filter((s) => !q || `${s.title ?? ""} ${s.code} ${s.section}`.toLowerCase().includes(q));

  return (
    <div className="page chart-page">
      <div className="chart-meta">
        {client && (
          <span className="chip" title="Log hours to this client with this tag">
            @{client.key}
          </span>
        )}
        {file.kind === "project" &&
          (parent ? (
            <button className="link" onClick={() => nav.openFile(parent.path!)}>
              ← {parent.name}
            </button>
          ) : (
            <span className="muted">No client: set <code>client:</code> in the frontmatter</span>
          ))}
        {file.kind === "project" && typeof file.frontmatter.status === "string" && <span className="chip">{file.frontmatter.status}</span>}
        {file.kind === "project" && (
          <span className="chip" title="Log hours to this project with this tag">
            @{parent ? `${parent.key}/` : ""}
            {slugify(basename(path))}
          </span>
        )}
        <input className="chart-filter" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>

      {file.kind === "client" && (
        <section className="panel">
          <h2>
            Projects <span className="count">{projects.length}</span>
          </h2>
          <div className="chips-row">
            {projects.map((p) => (
              <button key={p.path} className="project-chip" onClick={() => nav.openFile(p.path)}>
                {p.title}
                {typeof p.frontmatter.status === "string" && p.frontmatter.status !== "active" && <span className="muted"> · {p.frontmatter.status}</span>}
              </button>
            ))}
            <button className="ghost small" onClick={() => nav.newItem("project", key)}>
              + New project
            </button>
          </div>
        </section>
      )}

      <div className="chart-grid">
        {sections.map((s) => {
          const rows = items.filter((i) => i.section === s);
          const blocks = snippets.filter((b) => b.section === s);
          if (q && !rows.length && !blocks.length) return null;
          return (
            <section key={s || "_general"} className="panel chart-section">
              <h2>{s || "General"}</h2>
              {rows.map((i) => (
                <ChartRow key={i.line} item={i} portalUrl={portalUrl(i)} />
              ))}
              {blocks.map((b) => (
                <SnippetBlock key={b.line} snippet={b} />
              ))}
              {!q && s && <AddInput placeholder={`Add to ${s}… (Label: value)`} onAdd={add(s)} />}
            </section>
          );
        })}
      </div>

      {!q && (
        <div className="chart-new-section">
          <AddInput placeholder="+ New section (e.g. DNS, Repos, Key Vaults)" onAdd={async (name) => {
            try {
              await hold.appendTo(path, name, "");
              bump();
            } catch (e) {
              reportError(e);
            }
          }} />
        </div>
      )}
      {q && !items.length && <p className="empty">Nothing matches “{filter}”.</p>}
    </div>
  );
}
