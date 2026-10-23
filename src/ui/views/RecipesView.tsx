import { ChefHat, Clock, ExternalLink, Link2, Plus, ShoppingCart, Users } from "lucide-react";
import { useState } from "react";
import { DEFAULT_LIST } from "../../core/capture";
import { cookTime, shopForRecipe } from "../recipes";
import { ParsedFile } from "../../core/parse";
import { openUrl, recipeFromUrl } from "../../lib/platform";
import { EmptyState } from "../EmptyState";
import { useHold } from "../HoldContext";
import { openOpts, useNav } from "../nav";

function host(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/** Recipes: paste a link and Keel reads the recipe off the page into a note you can edit. */
export function RecipesView() {
  const { hold, bump, reportError, toast } = useHold();
  const nav = useNav();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const all = hold.recipes();
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const recipes = all.filter((f) => words.every((w) => f.content.toLowerCase().includes(w)));

  const importRecipe = async () => {
    const link = url.trim().replace(/^[<"']+|[>"']+$/g, "");
    if (!/^https?:\/\//i.test(link)) return toast("Paste the recipe page's link (https://…)");
    setBusy(true);
    try {
      const r = await recipeFromUrl(link);
      const path = await hold.createRecipe({
        title: r.title || host(link) || "Recipe",
        source: link,
        ingredients: r.ingredients,
        steps: r.steps,
        servings: r.servings,
        time: cookTime(r.totalTime),
        image: r.image,
      });
      bump();
      setUrl("");
      toast(r.ingredients.length ? `Saved “${r.title}” with ${r.ingredients.length} ingredients` : "Saved the link: that page doesn't publish its recipe, so fill it in by hand");
      nav.openFile(path);
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };

  const blank = () =>
    nav.prompt({
      title: "New recipe",
      label: "Name",
      placeholder: "Grandma's lasagne",
      submitLabel: "Create",
      onSubmit: async (title) => {
        const path = await hold.createRecipe({ title });
        bump();
        nav.openFile(path);
      },
    });

  const shop = async (f: ParsedFile) => {
    try {
      toast(await shopForRecipe(hold, f));
      bump();
    } catch (e) {
      reportError(e);
    }
  };

  return (
    <div className="page recipes-page">
      <header className="page-head row">
        <div>
          <h1>Recipes</h1>
          <p className="muted">Paste a recipe's link: most recipe sites publish the ingredients and method, and Keel fills them in.</p>
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
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… a recipe page" aria-label="Recipe link" spellCheck={false} />
        <button type="submit" className="primary" disabled={busy || !url.trim()}>
          {busy ? "Reading…" : "Add recipe"}
        </button>
      </form>

      {all.length > 4 && <input className="search-input recipe-filter" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a recipe or an ingredient…" aria-label="Find a recipe" />}

      {!all.length ? (
        <EmptyState icon={ChefHat} title="No recipes yet">
          <p>Paste a link above, or start a blank recipe. Each recipe can put its ingredients straight onto your Shopping list.</p>
        </EmptyState>
      ) : (
        <div className="recipe-grid">
          {recipes.map((f) => {
            const n = hold.recipeIngredients(f).length;
            const src = typeof f.frontmatter.source === "string" ? f.frontmatter.source : undefined;
            return (
              <article key={f.path} className="recipe-card">
                <button className="recipe-title" onClick={(e) => nav.openFile(f.path, undefined, openOpts(e))}>
                  {f.title}
                </button>
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
                  <span>{n ? `${n} ingredients` : "no ingredients yet"}</span>
                </div>
                <div className="recipe-actions">
                  <button className="small icon-text" onClick={() => shop(f)} disabled={!n} title={`Put the ingredients on ${DEFAULT_LIST}`}>
                    <ShoppingCart size={13} aria-hidden="true" /> Shop
                  </button>
                  {src && (
                    <button className="ghost small icon-text" onClick={() => void openUrl(src).catch(reportError)} title={src}>
                      <ExternalLink size={13} aria-hidden="true" /> {host(src)}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
          {!recipes.length && <p className="muted">No recipe matches “{q}”.</p>}
        </div>
      )}
    </div>
  );
}
