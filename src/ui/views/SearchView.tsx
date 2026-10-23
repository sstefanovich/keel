import { getSpace } from "../space";
import { useEffect, useRef, useState } from "react";
import { addDays, formatLong, formatShort, today } from "../../core/dates";
import { SearchFilter } from "../../core/hold";
import { FileKind, basename, readableLine } from "../../core/parse";
import { slugify } from "../../core/templates";
import { useHold } from "../HoldContext";
import { useNav } from "../nav";
import { Search, SearchX } from "lucide-react";
import { EmptyState } from "../EmptyState";

const TYPES: Record<string, { label: string; kinds?: FileKind[] }> = {
  all: { label: "All" },
  logs: { label: "Logs", kinds: ["log"] },
  meetings: { label: "Meetings", kinds: ["meeting"] },
  notes: { label: "Notes", kinds: ["note"] },
  charts: { label: "Clients & projects", kinds: ["client", "project"] },
  flags: { label: "Flags", kinds: ["flag"] },
};

const WHEN: Record<string, { label: string; days?: number }> = {
  any: { label: "Any time" },
  week: { label: "Past 7 days", days: 7 },
  month: { label: "Past 30 days", days: 30 },
  quarter: { label: "Past 3 months", days: 91 },
  year: { label: "This year" },
};

function highlight(text: string, q: string) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (!q || i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

export function SearchView({ initial = "" }: { initial?: string }) {
  const { hold, focus } = useHold();
  const nav = useNav();
  const [q, setQ] = useState(initial);
  const [type, setType] = useState<keyof typeof TYPES>("all");
  // "client:key" or "project:key"; with a focused client, searches start narrowed to it
  const [owner, setOwner] = useState(focus ? `client:${focus}` : "");
  const [when, setWhen] = useState<keyof typeof WHEN>("any");
  const mode = getSpace();
  const [bothSpaces, setBothSpaces] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => setOwner(focus ? `client:${focus}` : ""), [focus]);

  const [ownerKind, ownerKey] = owner.split(":");
  const days = WHEN[when].days;
  const t = today();
  const filter: SearchFilter = {
    kinds: TYPES[type].kinds,
    client: ownerKind === "client" ? ownerKey : undefined,
    project: ownerKind === "project" ? ownerKey : undefined,
    from: when === "year" ? `${t.slice(0, 4)}-01-01` : days ? addDays(t, -days) : undefined,
    space: bothSpaces ? undefined : mode,
  };
  const hits = hold.search(q, 200, filter);
  const filtered = type !== "all" || !!owner || when !== "any";
  const clients = [...hold.clients().values()].sort((a, b) => a.name.localeCompare(b.name));
  // logs by their day ("Friday, October 23, 2026"), everything else by title
  const titleOf = (path: string, title: string) => {
    const f = hold.get(path);
    return f?.kind === "log" && f.date ? formatLong(f.date) : title;
  };

  const groups = new Map<string, typeof hits>();
  for (const h of hits) groups.set(h.path, [...(groups.get(h.path) ?? []), h]);

  return (
    <div className="page">
      <header className="page-head">
        <h1>Search</h1>
        <input
          ref={input}
          className="search-input"
          placeholder="Search the hold… (or #tag)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && hits[0] && nav.openFile(hits[0].path, hits[0].line)}
        />
        <div className="search-filters" role="group" aria-label="Filters">
          <div className="seg" role="radiogroup" aria-label="Type">
            {(Object.keys(TYPES) as (keyof typeof TYPES)[]).map((k) => (
              <button key={k} role="radio" aria-checked={type === k} className={type === k ? "on" : ""} onClick={() => setType(k)}>
                {TYPES[k].label}
              </button>
            ))}
          </div>
          <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Client or project">
            <option value="">Any client or project</option>
            {clients.map((c) => (
              <optgroup key={c.key} label={c.name}>
                <option value={`client:${c.key}`}>{c.name}: everything</option>
                {hold.projectsOf(c.key).map((p) => {
                  const key = slugify(basename(p.path));
                  return (
                    <option key={key} value={`project:${key}`}>
                      {p.title}
                    </option>
                  );
                })}
              </optgroup>
            ))}
          </select>
          <label className="check-inline small" title={`Searching ${bothSpaces ? "work and personal" : `only ${mode}`}`}>
            <input type="checkbox" checked={bothSpaces} onChange={(e) => setBothSpaces(e.target.checked)} />
            Work and personal
          </label>
          <select value={when} onChange={(e) => setWhen(e.target.value as keyof typeof WHEN)} aria-label="When">
            {(Object.keys(WHEN) as (keyof typeof WHEN)[]).map((k) => (
              <option key={k} value={k}>
                {WHEN[k].label}
              </option>
            ))}
          </select>
          {filtered && (
            <button
              className="link small"
              onClick={() => {
                setType("all");
                setOwner("");
                setWhen("any");
              }}
            >
              Clear filters
            </button>
          )}
          {q.trim() && hits.length > 0 && (
            <span className="muted small">
              {hits.length === 200 ? "200+" : hits.length} match{hits.length === 1 ? "" : "es"}
            </span>
          )}
        </div>
      </header>
      {q.trim() && !hits.length && (
        <EmptyState icon={SearchX} title={`Nothing matches “${q.trim()}”`}>
          <p>{filtered ? "Try clearing the filters." : "Try fewer words, or a #tag."}</p>
        </EmptyState>
      )}
      {!q.trim() && (
        <EmptyState icon={Search} title="Search your whole Keel folder">
          <p>
            Finds text in every note, log, meeting, client and project. Type <code>#tag</code> for tagged files. To jump to a file by name,{" "}
            <kbd>Ctrl</kbd>+<kbd>P</kbd> is quicker.
          </p>
        </EmptyState>
      )}
      {[...groups].map(([path, hs]) => (
        <section key={path} className="panel search-group">
          <h3>
            <button className="link" onClick={() => nav.openFile(path)}>
              {titleOf(path, hs[0].title)}
            </button>
            <span className="muted small"> {path}</span>
          </h3>
          <ul>
            {hs
              .filter((h) => h.snippet)
              .slice(0, 6)
              .map((h) => (
                <li key={h.line}>
                  <button className="snippet" onClick={() => nav.openFile(h.path, h.line)}>
                    {highlight(readableLine(h.snippet, formatShort), q.trim())}
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
