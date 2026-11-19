import { BookOpen, BookPlus, Check, FolderPlus, Library, Loader2, Pencil, Play, Plus, Search } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { BookStatus } from "../../core/hold";
import { ParsedFile } from "../../core/parse";
import { BookHit, bookSearch, isTauri } from "../../lib/platform";
import { COPIES, STATUS_LABEL, bookAuthor, bookCopy, bookCover, finishedOn, keepCover, shortDate, smallCover } from "../books";
import { MenuEntry, SEP, useContextMenu } from "../ContextMenu";
import { EmptyState } from "../EmptyState";
import { useHold } from "../HoldContext";
import { openOpts, useNav } from "../nav";
import { RecipePhoto } from "../RecipePhoto";
import { Stars } from "../Stars";

type Tab = "all" | BookStatus;
type Sort = "recent" | "title" | "author" | "rating";
const TABS: [Tab, string][] = [
  ["all", "All"],
  ["reading", "Reading"],
  ["to-read", "To read"],
  ["read", "Read"],
];
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** A cover, or a plain stand-in with the title when there isn't one. */
export function BookCover({ f, small = false }: { f: ParsedFile; small?: boolean }) {
  const src = bookCover(f);
  return (
    <RecipePhoto
      src={small && src && /^https?:/i.test(src) ? smallCover(src) : src}
      className="book-cover"
      fallback={
        <span className="book-cover none" aria-hidden="true">
          <span>{f.title}</span>
        </span>
      }
    />
  );
}

/**
 * Books (personal): look one up by title, author or ISBN and Keel fills in the author, year, pages
 * and cover. Each book is a note in personal/books with where it stands (to read, reading, read),
 * a rating, the date finished, how you got it, notes, and any number of shelves.
 */
export function BooksView({ initial }: { initial?: string }) {
  const { hold, bump, reportError, toast } = useHold();
  const nav = useNav();
  const openMenu = useContextMenu();
  const [tab, setTab] = useState<Tab>("all");
  const [shelf, setShelf] = useState<string | null>(null);
  const [q, setQ] = useState(initial ?? "");
  const [sort, setSort] = useState<Sort>("recent");

  const all = hold.books();
  const shelves = hold.collectionCounts("book");
  const chips = shelf && !shelves.some((s) => same(s.name, shelf)) ? [...shelves, { name: shelf, count: 0 }] : shelves;
  const onShelf = shelf ? all.filter((f) => hold.collectionsOf(f).some((c) => same(c, shelf))) : all;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const matching = onShelf.filter((f) => words.every((w) => f.content.toLowerCase().includes(w)));
  const count = (s: BookStatus) => onShelf.filter((f) => hold.bookStatus(f) === s).length;
  const sorted = [...matching].sort((a, b) =>
    sort === "title"
      ? a.title.localeCompare(b.title)
      : sort === "author"
        ? bookAuthor(a).localeCompare(bookAuthor(b)) || a.title.localeCompare(b.title)
        : sort === "rating"
          ? hold.rating(b) - hold.rating(a) || a.title.localeCompare(b.title)
          : 0, // books() is already most recent first
  );
  const of = (s: BookStatus) => sorted.filter((f) => hold.bookStatus(f) === s);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      bump();
    } catch (e) {
      reportError(e);
    }
  };

  const setStatus = (f: ParsedFile, s: BookStatus) =>
    run(async () => {
      await hold.setBookStatus(f.path, s);
      if (s === "read") toast(`Finished “${f.title}”. Give it some stars?`);
    });

  const newShelf = (then?: (name: string) => Promise<void>) =>
    nav.prompt({
      title: "New shelf",
      label: "Name",
      placeholder: "Book club",
      submitLabel: "Create",
      onSubmit: async (name) => {
        const n = name.replace(/\s+/g, " ").trim();
        if (!n) return;
        if (then) await then(n);
        else setShelf(n);
        bump();
      },
    });

  const renameShelf = (from: string) =>
    nav.prompt({
      title: `Rename “${from}”`,
      label: "Name",
      initial: from,
      submitLabel: "Rename",
      onSubmit: async (to) => {
        const n = to.replace(/\s+/g, " ").trim();
        if (!n || n === from) return;
        await hold.renameCollection("book", from, n);
        setShelf(n);
        bump();
      },
    });

  const shelfMenu = (e: React.MouseEvent, f: ParsedFile) => {
    const mine = hold.collectionsOf(f);
    const r = e.currentTarget.getBoundingClientRect();
    const entries: MenuEntry[] = chips.map((c) => ({
      label: c.name,
      icon: mine.some((m) => same(m, c.name)) ? Check : undefined,
      onSelect: () => void run(() => hold.toggleCollection(f.path, c.name)),
    }));
    if (entries.length) entries.push(SEP);
    entries.push({ label: "New shelf…", icon: Plus, onSelect: () => newShelf((n) => hold.toggleCollection(f.path, n)) });
    openMenu({ clientX: r.left, clientY: r.bottom + 4, preventDefault: () => e.preventDefault() }, entries);
  };

  const card = (f: ParsedFile) => {
    const status = hold.bookStatus(f);
    const copy = bookCopy(f);
    const cols = hold.collectionsOf(f);
    const stamp = (label: string, v: unknown) => (shortDate(v) ? `${label} ${shortDate(v)}` : undefined);
    const when = status === "read" ? stamp("Finished", finishedOn(f)) : status === "reading" ? stamp("Started", f.frontmatter.started) : stamp("Added", f.frontmatter.added);
    return (
      <article key={f.path} className={`book-card ${status}`}>
        <button className="book-cover-btn" onClick={(e) => nav.openFile(f.path, undefined, openOpts(e))} aria-label={`Open ${f.title}`} tabIndex={-1}>
          <BookCover f={f} small />
        </button>
        <div className="book-info">
          <button className="book-title" onClick={(e) => nav.openFile(f.path, undefined, openOpts(e))}>
            {f.title}
          </button>
          {bookAuthor(f) && <span className="book-author">{bookAuthor(f)}</span>}
          {status === "read" && <Stars value={hold.rating(f)} onChange={(s) => void run(() => hold.setRating(f.path, s))} />}
          <span className="book-meta muted">
            {when}
            {copy && <span className="book-copy">{COPIES.find(([k]) => k === copy)![1]}</span>}
          </span>
          {cols.length > 0 && (
            <div className="recipe-tags">
              {cols.map((c) => (
                <button key={c} className="recipe-tag" onClick={() => setShelf(c)} title={`Show ${c}`}>
                  {c}
                </button>
              ))}
            </div>
          )}
          <div className="book-actions">
            {status === "to-read" && (
              <button className="small icon-text" onClick={() => void setStatus(f, "reading")} title="Mark as reading (today)">
                <Play size={12} aria-hidden="true" /> Start
              </button>
            )}
            {status !== "read" && (
              <button className={`small icon-text${status === "reading" ? " primary" : ""}`} onClick={() => void setStatus(f, "read")} title="Mark as read (finished today)">
                <Check size={12} aria-hidden="true" /> {status === "reading" ? "Finished" : "Read it"}
              </button>
            )}
            <button className="ghost small icon-btn" onClick={(e) => shelfMenu(e, f)} title="Shelves" aria-label="Shelves" aria-haspopup="menu">
              <FolderPlus size={13} />
            </button>
          </div>
        </div>
      </article>
    );
  };

  const grid = (files: ParsedFile[]) => <div className="book-grid">{files.map(card)}</div>;

  // "All": what you're reading, then what's next, then what you've read by year
  const readByYear = () => {
    const years = new Map<string, ParsedFile[]>();
    for (const f of of("read")) {
      const y = finishedOn(f)?.slice(0, 4) ?? "Undated";
      years.set(y, [...(years.get(y) ?? []), f]);
    }
    return [...years.entries()];
  };

  return (
    <div className="page books-page">
      <header className="page-head row">
        <div>
          <h1>Books</h1>
          <p className="muted">Look a book up by title, author or ISBN: Keel fills in the rest. Keep what you're reading, what's next, and what you thought.</p>
        </div>
        <div className="toolbar">
          <button
            onClick={() =>
              nav.prompt({
                title: "Add a book by hand",
                label: "Title",
                placeholder: "The Left Hand of Darkness",
                submitLabel: "Add",
                onSubmit: async (title) => {
                  const path = await hold.createBook({ title, collections: shelf ? [shelf] : [] });
                  bump();
                  nav.openFile(path);
                },
              })
            }
          >
            <Pencil size={14} aria-hidden="true" /> By hand
          </button>
        </div>
      </header>

      <AddBook shelf={shelf} />

      {all.length > 0 && (
        <>
          <nav className="recipe-collections" aria-label="Shelves">
            <button className={`recipe-chip${shelf === null ? " on" : ""}`} aria-pressed={shelf === null} onClick={() => setShelf(null)}>
              All books <span className="recipe-chip-count">{all.length}</span>
            </button>
            {chips.map((c) => (
              <button key={c.name} className={`recipe-chip${shelf !== null && same(shelf, c.name) ? " on" : ""}`} aria-pressed={shelf !== null && same(shelf, c.name)} onClick={() => setShelf(c.name)}>
                {c.name} <span className="recipe-chip-count">{c.count}</span>
              </button>
            ))}
            <button className="recipe-chip ghost" onClick={() => newShelf()}>
              <Plus size={12} aria-hidden="true" /> New shelf
            </button>
            {shelf && onShelf.length > 0 && (
              <button className="link small" onClick={() => renameShelf(shelf)}>
                Rename shelf
              </button>
            )}
          </nav>

          <div className="recipe-tools">
            <div className="seg" role="tablist" aria-label="Status">
              {TABS.map(([t, label]) => (
                <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
                  {label}
                  {t !== "all" && <span className="recipe-chip-count"> {count(t)}</span>}
                </button>
              ))}
            </div>
            <div className="recipe-search">
              <Search size={15} aria-hidden="true" />
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by title, author or notes" aria-label="Filter books" />
            </div>
            <label className="recipe-sort muted">
              Sort
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="recent">Recent</option>
                <option value="title">Title</option>
                <option value="author">Author</option>
                <option value="rating">Rating</option>
              </select>
            </label>
          </div>
        </>
      )}

      {!all.length ? (
        <EmptyState icon={BookOpen} title="No books yet">
          <p>Type a title above and pick the right book. Mark it to read, reading or read; rate it when you're done.</p>
        </EmptyState>
      ) : !matching.length ? (
        <p className="muted">{q ? `No book matches “${q}”.` : shelf ? `Nothing on ${shelf} yet: add a book above, or use the shelf button on any book.` : "No books here."}</p>
      ) : tab !== "all" ? (
        of(tab).length ? grid(of(tab)) : <p className="muted">No books {STATUS_LABEL[tab].toLowerCase()}{shelf ? ` on ${shelf}` : ""}.</p>
      ) : (
        <>
          {of("reading").length > 0 && (
            <section className="book-section">
              <h2>
                Reading now <span className="muted">{of("reading").length}</span>
              </h2>
              {grid(of("reading"))}
            </section>
          )}
          {of("to-read").length > 0 && (
            <section className="book-section">
              <h2>
                To read <span className="muted">{of("to-read").length}</span>
              </h2>
              {grid(of("to-read"))}
            </section>
          )}
          {readByYear().map(([year, files]) => (
            <Fragment key={year}>
              <section className="book-section">
                <h2>
                  Read {year === "Undated" ? "" : `in ${year}`} <span className="muted">{files.length}</span>
                </h2>
                {grid(files)}
              </section>
            </Fragment>
          ))}
        </>
      )}
    </div>
  );
}

/** The lookup box: type, pick the right book, and say where it goes. */
function AddBook({ shelf }: { shelf: string | null }) {
  const { hold, dir, bump, reportError, toast } = useHold();
  const nav = useNav();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<BookHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const seq = useRef(0);

  const search = async (text: string) => {
    const query = text.trim();
    const mine = ++seq.current;
    if (query.length < 3) {
      setHits(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    try {
      const r = await bookSearch(query);
      if (mine === seq.current) setHits(r);
    } catch (e) {
      if (mine === seq.current) {
        setHits([]);
        reportError(e);
      }
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  };

  // look up as you type (after a short pause)
  useEffect(() => {
    if (!isTauri) return;
    const t = window.setTimeout(() => void search(q), 450);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const add = async (h: BookHit | null, status: BookStatus) => {
    const title = h?.title ?? q.trim();
    if (!title) return;
    const author = h?.authors.join(", ");
    const existing = hold.findBook(title, author);
    if (existing) {
      toast(`“${existing.title}” is already on your list`);
      return nav.openFile(existing.path);
    }
    setAdding(h?.key ?? title);
    try {
      await hold.createBook({
        title,
        author,
        year: h?.year,
        pages: h?.pages,
        isbn: h?.isbn,
        cover: await keepCover(dir, title, h?.cover),
        link: h?.key ? `https://openlibrary.org${h.key}` : undefined,
        status,
        collections: shelf ? [shelf] : [],
      });
      bump();
      toast(`Added “${title}” to ${status === "to-read" ? "To read" : status === "reading" ? "Reading" : "Read"}${shelf ? ` · ${shelf}` : ""}`);
      setQ("");
      setHits(null);
    } catch (e) {
      reportError(e);
    } finally {
      setAdding(null);
    }
  };

  const choices = (h: BookHit | null) => {
    const k = h?.key ?? h?.title ?? "typed";
    const off = adding !== null;
    return (
      <span className="book-add-actions">
        {adding === (h?.key ?? h?.title ?? q.trim()) ? (
          <Loader2 size={14} className="spin" aria-label="Adding" />
        ) : (
          <>
            <button className="small" disabled={off} onClick={() => void add(h, "to-read")} title="Add to To read" key={`${k}-t`}>
              <BookPlus size={12} aria-hidden="true" /> To read
            </button>
            <button className="small" disabled={off} onClick={() => void add(h, "reading")} title="I'm reading it now" key={`${k}-r`}>
              <Play size={12} aria-hidden="true" /> Reading
            </button>
            <button className="small" disabled={off} onClick={() => void add(h, "read")} title="I've read it (finished today)" key={`${k}-d`}>
              <Check size={12} aria-hidden="true" /> Read
            </button>
          </>
        )}
      </span>
    );
  };

  return (
    <div className="book-add">
      <div className="recipe-add">
        <Library size={16} aria-hidden="true" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void search(q);
            if (e.key === "Escape") {
              setQ("");
              setHits(null);
            }
          }}
          placeholder={isTauri ? `Add a book: title, author or ISBN${shelf ? ` (goes on ${shelf})` : ""}` : "Book lookup works in the desktop app: use By hand"}
          aria-label="Find a book to add"
          spellCheck={false}
        />
        {busy && <Loader2 size={15} className="spin" aria-label="Looking it up" />}
      </div>
      {hits !== null && q.trim().length >= 3 && (
        <ul className="book-hits" aria-label="Matches">
          {hits.map((h, i) => (
            <li key={`${h.key ?? h.title}-${i}`} className="book-hit">
              {h.cover ? <img className="book-hit-cover" src={smallCover(h.cover)} alt="" loading="lazy" /> : <span className="book-hit-cover none" aria-hidden="true" />}
              <span className="book-hit-text">
                <b>{h.title}</b>
                <span className="muted small">{[h.authors.join(", "), h.year, h.pages && `${h.pages} pages`].filter(Boolean).join(" · ")}</span>
              </span>
              {choices(h)}
            </li>
          ))}
          <li className="book-hit typed">
            <span className="book-hit-text">
              <span className="muted small">{hits.length ? "Not here?" : "Nothing found."} Add “{q.trim()}” as typed, and fill in the rest later</span>
            </span>
            {choices(null)}
          </li>
        </ul>
      )}
    </div>
  );
}
