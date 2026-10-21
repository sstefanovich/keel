import { useEffect, useRef, useState } from "react";
import { useHold } from "../HoldContext";
import { useNav } from "../nav";
import { Search, SearchX } from "lucide-react";
import { EmptyState } from "../EmptyState";

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
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  // with a focused client: its files, plus lines elsewhere that mention it (#acme / @acme)
  const mention = focus ? new RegExp(`[#@]${focus}(\\b|/)`, "i") : null;
  const hits = hold.search(q).filter((h) => {
    if (!focus) return true;
    const f = hold.get(h.path);
    return (f && hold.fileClient(f) === focus) || mention!.test(h.snippet);
  });

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
      </header>
      {q.trim() && !hits.length && (
        <EmptyState icon={SearchX} title={`Nothing matches “${q.trim()}”`}>
          <p>{focus ? "Focus is on: try clearing it in the sidebar to search every client." : "Try fewer words, or a #tag."}</p>
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
              {hs[0].title}
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
                    {highlight(h.snippet, q.trim())}
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
