import { ExternalLink, NotebookPen } from "lucide-react";
import { useEffect, useState } from "react";
import { BookStatus } from "../../core/hold";
import { openUrl } from "../../lib/platform";
import { COPIES, Copy, STATUS_LABEL, bookAuthor, bookCopy } from "../books";
import { ChatMarkdown } from "../ChatMarkdown";
import { flushEditors } from "../editor/Editor";
import { useHold } from "../HoldContext";
import { useNav } from "../nav";
import { recipeLayout } from "../recipes";
import { Stars } from "../Stars";
import { BookCover } from "./BooksView";

const STATUSES: BookStatus[] = ["to-read", "reading", "read"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One book: cover and details, where it stands (to read / reading / read, with the dates), a
 * rating, how you got it, its shelves, and dated notes.
 */
export function BookView({ path }: { path: string }) {
  const { hold, bump, reportError, toast } = useHold();
  const nav = useNav();
  const file = hold.get(path);
  const [note, setNote] = useState("");
  useEffect(() => setNote(""), [path]);
  if (!file) return null;

  const status = hold.bookStatus(file);
  const copy = bookCopy(file);
  const fm = file.frontmatter;
  const link = typeof fm.link === "string" ? fm.link : undefined;
  const cols = hold.collectionsOf(file);
  const layout = recipeLayout(file.body);
  const notes = layout.others.find((o) => /^notes?\b/i.test(o.heading));
  const others = layout.others.filter((o) => o !== notes);
  const facts = [fm.year && String(fm.year), fm.pages && `${fm.pages} pages`, fm.isbn && `ISBN ${fm.isbn}`].filter(Boolean).join(" · ");
  const onLink = (t: string) => (/^https?:\/\//i.test(t) ? void openUrl(t).catch(reportError) : nav.openLink(t));

  const edit = async (fn: () => Promise<unknown>) => {
    try {
      await flushEditors();
      await fn();
      bump();
    } catch (e) {
      reportError(e);
    }
  };
  const date = (key: "started" | "finished") => (typeof fm[key] === "string" && ISO.test(String(fm[key])) ? String(fm[key]) : "");

  return (
    <article className="book-view">
      <header className="book-hero">
        <BookCover f={file} />
        <div className="book-hero-text">
          <h1>{file.title}</h1>
          {bookAuthor(file) && <p className="book-hero-author">{bookAuthor(file)}</p>}
          {(facts || link) && (
            <p className="muted small">
              {facts}
              {link && (
                <>
                  {facts && " · "}
                  <button className="link small" onClick={() => void openUrl(link).catch(reportError)}>
                    Open Library <ExternalLink size={11} aria-hidden="true" />
                  </button>
                </>
              )}
            </p>
          )}

          <div className="book-fields">
            <span className="book-field-label">Status</span>
            <div className="seg" role="radiogroup" aria-label="Status">
              {STATUSES.map((s) => (
                <button key={s} role="radio" aria-checked={status === s} className={status === s ? "on" : ""} onClick={() => void edit(() => hold.setBookStatus(path, s))}>
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>

            {status !== "to-read" && (
              <>
                <span className="book-field-label">Started</span>
                <input type="date" value={date("started")} onChange={(e) => void edit(() => hold.updateFrontmatter(path, { started: e.target.value || undefined }))} aria-label="Started" />
              </>
            )}
            {status === "read" && (
              <>
                <span className="book-field-label">Finished</span>
                <input type="date" value={date("finished")} onChange={(e) => void edit(() => hold.updateFrontmatter(path, { finished: e.target.value || undefined }))} aria-label="Finished" />
                <span className="book-field-label">Rating</span>
                <Stars value={hold.rating(file)} onChange={(s) => void edit(() => hold.setRating(path, s))} size={18} />
              </>
            )}

            <span className="book-field-label">Copy</span>
            <div className="seg" role="radiogroup" aria-label="How you got it">
              {COPIES.map(([k, label]) => (
                <button
                  key={k}
                  role="radio"
                  aria-checked={copy === k}
                  className={copy === k ? "on" : ""}
                  onClick={() => void edit(() => hold.updateFrontmatter(path, { copy: copy === k ? undefined : (k as Copy) }))}
                  title={copy === k ? "Click again to clear" : undefined}
                >
                  {label}
                </button>
              ))}
            </div>

            {cols.length > 0 && (
              <>
                <span className="book-field-label">Shelves</span>
                <div className="recipe-tags">
                  {cols.map((c) => (
                    <span key={c} className="recipe-tag">
                      {c}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="recipe-notes" aria-labelledby="bv-notes">
        <h2 id="bv-notes">{notes?.heading ?? "Notes"}</h2>
        {notes ? <ChatMarkdown text={notes.text} onLink={onLink} /> : <p className="muted">Favourite lines, what stayed with you, who recommended it.</p>}
        <form
          className="recipe-note-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (!note.trim()) return;
            void edit(async () => {
              await hold.addDatedNote(path, note);
              setNote("");
              toast("Note added");
            });
          }}
        >
          <NotebookPen size={15} aria-hidden="true" />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note…" aria-label="Add a note" />
          <button type="submit" className="small" disabled={!note.trim()}>
            Add
          </button>
        </form>
      </section>

      {others.map((o) => (
        <section key={o.heading} className="recipe-notes">
          <h2>{o.heading}</h2>
          <ChatMarkdown text={o.text} onLink={onLink} />
        </section>
      ))}
    </article>
  );
}
