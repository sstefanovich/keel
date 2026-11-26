import { Check, ChefHat, Clock, ExternalLink, FolderPlus, Link2, Pencil, Plus, Search, ShoppingCart, Users } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { DEFAULT_LIST } from "../../core/capture";
import { minutesOf, recipeTerms, searchRecipes } from "../../core/recipeSearch";
import { cookTime, keepRecipeImage, recipeImage, shopForRecipe, shopForRecipes } from "../recipes";
import { ParsedFile } from "../../core/parse";
import { openUrl, recipeFromUrl } from "../../lib/platform";
import { MenuEntry, SEP, useContextMenu } from "../ContextMenu";
import { EmptyState } from "../EmptyState";
import { useHold } from "../HoldContext";
import { openOpts, useNav } from "../nav";
import { RecipePhoto } from "../RecipePhoto";
import { Stars } from "../Stars";

function host(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

type Sort = "best" | "name" | "rating" | "recent";
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const RATINGS: [number, string][] = [
  [0, "Any rating"],
  [3, "★ 3 and up"],
  [4, "★ 4 and up"],
  [5, "★ 5 only"],
  [-1, "Not rated yet"],
];
const TIMES: [number, string][] = [
  [0, "Any time"],
  [30, "30 min or less"],
  [45, "45 min or less"],
  [60, "1 hour or less"],
  [90, "1½ hours or less"],
  [120, "2 hours or less"],
];

/**
 * Recipes: paste a link and Keel reads the recipe (and its photo) off the page into a note you can
 * edit. Rate them, and gather them into collections ("Desserts", "Thanksgiving 2026") to plan a meal
 * ahead and remember what you made.
 */
export function RecipesView({ initial }: { initial?: string }) {
  const { hold, dir, bump, reportError, toast } = useHold();
  const nav = useNav();
  const openMenu = useContextMenu();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState(initial ?? "");
  useEffect(() => {
    if (initial !== undefined) setQ(initial);
  }, [initial]);
  const [minRating, setMinRating] = useState(0);
  const [maxMinutes, setMaxMinutes] = useState(0);
  /** null: best match while searching, else by name */
  const [sortPick, setSortPick] = useState<Sort | null>(null);
  /** The collection being shown (it may have no recipes yet when just made) */
  const [col, setCol] = useState<string | null>(null);

  const all = hold.recipes();
  const collections = hold.recipeCollectionCounts();
  const chips = col && !collections.some((c) => same(c.name, col)) ? [...collections, { name: col, count: 0 }] : collections;
  const inCol = col ? all.filter((f) => hold.recipeCollections(f).some((c) => same(c, col))) : all;
  const searching = recipeTerms(q).length > 0;
  const sort: Sort = sortPick === "best" && !searching ? "name" : (sortPick ?? (searching ? "best" : "name"));
  const filtering = searching || minRating !== 0 || maxMinutes !== 0;

  const hits = searchRecipes(
    inCol.map((f) => ({
      path: f.path,
      title: f.title,
      ingredients: hold.recipeIngredients(f),
      collections: hold.recipeCollections(f),
      text: f.body,
      rating: hold.recipeRating(f),
      minutes: minutesOf(f.frontmatter.time),
    })),
    { q, minRating, maxMinutes },
  );
  const hitOf = new Map(hits.map((h) => [h.path, h]));
  const byPath = new Map(inCol.map((f) => [f.path, f]));
  const recipes = hits
    .map((h) => byPath.get(h.path)!)
    .sort((a, b) =>
      sort === "best"
        ? 0 // already best first
        : sort === "rating"
          ? hold.recipeRating(b) - hold.recipeRating(a) || a.title.localeCompare(b.title)
          : sort === "recent"
            ? String(b.frontmatter.created ?? "").localeCompare(String(a.frontmatter.created ?? "")) || b.mtime - a.mtime
            : a.title.localeCompare(b.title),
    );
  // with several terms, best-first results split into "has everything" and "has some"
  const firstPartial = sort === "best" ? recipes.findIndex((f) => hitOf.get(f.path)!.matched < hitOf.get(f.path)!.terms) : -1;
  const clearFilters = () => {
    setQ("");
    setMinRating(0);
    setMaxMinutes(0);
  };

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      bump();
    } catch (e) {
      reportError(e);
    }
  };

  const importRecipe = async () => {
    const link = url.trim().replace(/^[<"']+|[>"']+$/g, "");
    if (!/^https?:\/\//i.test(link)) return toast("Paste the recipe page's link (https://…)");
    setBusy(true);
    try {
      const r = await recipeFromUrl(link);
      const title = r.title || host(link) || "Recipe";
      const path = await hold.createRecipe({
        title,
        source: link,
        ingredients: r.ingredients,
        steps: r.steps,
        servings: r.servings,
        time: cookTime(r.totalTime),
        image: await keepRecipeImage(dir, title, r.image, link),
        collections: col ? [col] : [],
      });
      bump();
      setUrl("");
      const where = col ? ` in ${col}` : "";
      toast(
        r.ingredients.length
          ? `Saved “${title}”${where} with ${r.ingredients.length} ingredients`
          : `Saved the link${where}: that page doesn't publish its recipe, so fill it in by hand`,
      );
      nav.openFile(path);
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };

  const blank = () =>
    nav.prompt({
      title: col ? `New recipe in ${col}` : "New recipe",
      label: "Name",
      placeholder: "Grandma's lasagne",
      submitLabel: "Create",
      onSubmit: async (title) => {
        const path = await hold.createRecipe({ title, collections: col ? [col] : [] });
        bump();
        nav.openFile(path);
      },
    });

  const newCollection = (then?: (name: string) => Promise<void>) =>
    nav.prompt({
      title: "New collection",
      label: "Name",
      placeholder: "Thanksgiving 2026",
      submitLabel: "Create",
      onSubmit: async (name) => {
        const n = name.replace(/\s+/g, " ").trim();
        if (!n) return;
        if (then) await then(n);
        else setCol(n);
        bump();
      },
    });

  const renameCollection = (from: string) =>
    nav.prompt({
      title: `Rename “${from}”`,
      label: "Name",
      initial: from,
      submitLabel: "Rename",
      onSubmit: async (to) => {
        const n = to.replace(/\s+/g, " ").trim();
        if (!n || n === from) return;
        await hold.renameRecipeCollection(from, n);
        setCol(n);
        bump();
      },
    });

  const collectionMenu = (e: React.MouseEvent, f: ParsedFile) => {
    const mine = hold.recipeCollections(f);
    const r = e.currentTarget.getBoundingClientRect();
    const entries: MenuEntry[] = collections.map((c) => ({
      label: c.name,
      icon: mine.some((m) => same(m, c.name)) ? Check : undefined,
      onSelect: () => void run(() => hold.toggleRecipeCollection(f.path, c.name)),
    }));
    if (col && !collections.some((c) => same(c.name, col))) {
      entries.push({ label: col, onSelect: () => void run(() => hold.toggleRecipeCollection(f.path, col)) });
    }
    if (entries.length) entries.push(SEP);
    entries.push({ label: "New collection…", icon: Plus, onSelect: () => newCollection((n) => hold.toggleRecipeCollection(f.path, n)) });
    openMenu({ clientX: r.left, clientY: r.bottom + 4, preventDefault: () => e.preventDefault() }, entries);
  };

  return (
    <div className="page recipes-page">
      <header className="page-head row">
        <div>
          <h1>Recipes</h1>
          <p className="muted">Paste a recipe's link: most recipe sites publish the ingredients, method and photo, and Keel fills them in.</p>
        </div>
        <div className="toolbar">
          <button onClick={blank}>
            <Plus size={15} aria-hidden="true" /> Blank recipe
          </button>
        </div>
      </header>

      <form
        className="recipe-add"
        onSubmit={(e) => {
          e.preventDefault();
          void importRecipe();
        }}
      >
        <Link2 size={16} aria-hidden="true" />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={col ? `https://… a recipe page, saved into ${col}` : "https://… a recipe page"}
          aria-label="Recipe link"
          spellCheck={false}
        />
        <button type="submit" className="primary" disabled={busy || !url.trim()}>
          {busy ? "Reading…" : "Add recipe"}
        </button>
      </form>

      {all.length > 0 && (
        <nav className="recipe-collections" aria-label="Collections">
          <button className={`recipe-chip${col === null ? " on" : ""}`} aria-pressed={col === null} onClick={() => setCol(null)}>
            All <span className="recipe-chip-count">{all.length}</span>
          </button>
          {chips.map((c) => (
            <button key={c.name} className={`recipe-chip${col !== null && same(col, c.name) ? " on" : ""}`} aria-pressed={col !== null && same(col, c.name)} onClick={() => setCol(c.name)}>
              {c.name} <span className="recipe-chip-count">{c.count}</span>
            </button>
          ))}
          <button className="recipe-chip ghost" onClick={() => newCollection()}>
            <Plus size={12} aria-hidden="true" /> New collection
          </button>
        </nav>
      )}

      {col && (
        <div className="recipe-col-head">
          <h2>{col}</h2>
          <span className="muted">
            {inCol.length} recipe{inCol.length === 1 ? "" : "s"}
          </span>
          <div className="toolbar">
            <button
              className="small icon-text"
              disabled={!inCol.some((f) => hold.recipeIngredients(f).length)}
              onClick={() => void run(async () => toast(await shopForRecipes(hold, inCol)))}
              title={`Put every recipe's ingredients on ${DEFAULT_LIST}`}
            >
              <ShoppingCart size={13} aria-hidden="true" /> Shop all
            </button>
            {inCol.length > 0 && (
              <button className="ghost small icon-text" onClick={() => renameCollection(col)}>
                <Pencil size={13} aria-hidden="true" /> Rename
              </button>
            )}
          </div>
        </div>
      )}

      {inCol.length > 0 && (
        <div className="recipe-tools" role="search">
          <div className="recipe-search">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && q) {
                  e.preventDefault();
                  setQ("");
                } else if (e.key === "Enter" && recipes[0]) nav.openFile(recipes[0].path);
              }}
              placeholder="Search by name or what you have: chicken, lemon…"
              aria-label="Search recipes"
            />
          </div>
          <select value={minRating} onChange={(e) => setMinRating(Number(e.target.value))} aria-label="Rating">
            {RATINGS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <select value={maxMinutes} onChange={(e) => setMaxMinutes(Number(e.target.value))} aria-label="Time">
            {TIMES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <label className="recipe-sort muted">
            Sort
            <select value={sort} onChange={(e) => setSortPick(e.target.value as Sort)}>
              {searching && <option value="best">Best match</option>}
              <option value="name">Name</option>
              <option value="rating">Rating</option>
              <option value="recent">Newest</option>
            </select>
          </label>
          {filtering && (
            <span className="recipe-count muted">
              {recipes.length} of {inCol.length}
              <button className="link small" onClick={clearFilters}>
                Clear
              </button>
            </span>
          )}
        </div>
      )}

      {!all.length ? (
        <EmptyState icon={ChefHat} title="No recipes yet">
          <p>Paste a link above, or start a blank recipe. Each recipe can put its ingredients straight onto your Shopping list.</p>
        </EmptyState>
      ) : col && !inCol.length ? (
        <EmptyState icon={FolderPlus} title={`Nothing in ${col} yet`}>
          <p>Paste a link above to save a recipe straight into it, or use the folder button on any recipe under All.</p>
        </EmptyState>
      ) : (
        <div className="recipe-grid">
          {recipes.map((f, i) => {
            const n = hold.recipeIngredients(f).length;
            const src = typeof f.frontmatter.source === "string" ? f.frontmatter.source : undefined;
            const cols = hold.recipeCollections(f);
            const hit = hitOf.get(f.path)!;
            const partial = searching && hit.matched < hit.terms;
            return (
              <Fragment key={f.path}>
                {i === firstPartial && (
                  <h3 className="recipe-divider muted">
                    {i === 0 ? "Nothing has everything; these have some of it" : "These have some of it"}
                  </h3>
                )}
                <article className={`recipe-card${partial ? " partial" : ""}`}>
                  <RecipePhoto src={recipeImage(f)} title={`Open ${f.title}`} onOpen={(e) => nav.openFile(f.path, undefined, openOpts(e))} />
                  <button className="recipe-title" onClick={(e) => nav.openFile(f.path, undefined, openOpts(e))}>
                    {f.title}
                  </button>
                  <Stars value={hold.recipeRating(f)} onChange={(s) => void run(() => hold.rateRecipe(f.path, s))} />
                  <div className="recipe-meta">
                    {f.frontmatter.time ? (
                      <span>
                        <Clock size={12} aria-hidden="true" /> {String(f.frontmatter.time)}
                      </span>
                    ) : null}
                    {f.frontmatter.servings ? (
                      <span>
                        <Users size={12} aria-hidden="true" /> {String(f.frontmatter.servings)}
                      </span>
                    ) : null}
                    <span>{n ? `${n} ingredient${n === 1 ? "" : "s"}` : "no ingredients yet"}</span>
                    {partial && (
                      <span className="recipe-partial" title="How many of your search words this recipe has">
                        {hit.matched} of {hit.terms}
                      </span>
                    )}
                  </div>
                  {searching && (hit.ingredients.length > 0 || hit.elsewhere.length > 0) && (
                    <ul className="recipe-matches" aria-label="Matches">
                      {hit.ingredients.slice(0, 4).map((l) => (
                        <li key={l}>
                          <Check size={12} aria-hidden="true" /> {l}
                        </li>
                      ))}
                      {hit.ingredients.length > 4 && <li className="muted">+{hit.ingredients.length - 4} more</li>}
                      {hit.elsewhere.length > 0 && <li className="muted">“{hit.elsewhere.join("”, “")}” in the method or notes</li>}
                    </ul>
                  )}
                  {cols.length > 0 && (
                    <div className="recipe-tags">
                      {cols.map((c) => (
                        <button key={c} className="recipe-tag" onClick={() => setCol(c)} title={`Show ${c}`}>
                          {c}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="recipe-actions">
                    <button className="small icon-text" onClick={() => void run(async () => toast(await shopForRecipe(hold, f)))} disabled={!n} title={`Put the ingredients on ${DEFAULT_LIST}`}>
                      <ShoppingCart size={13} aria-hidden="true" /> Shop
                    </button>
                    <button className="ghost small icon-text" onClick={(e) => collectionMenu(e, f)} title="Add to a collection" aria-haspopup="menu">
                      <FolderPlus size={13} aria-hidden="true" /> Collections
                    </button>
                    {src && (
                      <button className="ghost small icon-text" onClick={() => void openUrl(src).catch(reportError)} title={src}>
                        <ExternalLink size={13} aria-hidden="true" /> {host(src)}
                      </button>
                    )}
                  </div>
                </article>
              </Fragment>
            );
          })}
          {!recipes.length && (
            <div className="recipe-none muted">
              <p>
                {searching ? `No recipe has “${recipeTerms(q).join("”, “")}”` : "No recipe fits"}
                {minRating || maxMinutes ? " with those filters" : ""}.
              </p>
              <button className="small" onClick={clearFilters}>
                Clear the search
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
