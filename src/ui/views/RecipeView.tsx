import { ArrowLeftRight, Check, Clock, ExternalLink, Minus, NotebookPen, Plus, RotateCcw, Sparkles, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { formatAmount, scaleIngredient, servingsCount } from "../../core/scale";
import { openUrl } from "../../lib/platform";
import { ChatMarkdown } from "../ChatMarkdown";
import { flushEditors } from "../editor/Editor";
import { useHold } from "../HoldContext";
import { useNav } from "../nav";
import { RecipePhoto } from "../RecipePhoto";
import { factorLabel, recipeImage, recipeLayout, substitutionPrompt } from "../recipes";
import { Stars } from "../Stars";

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const QUICK = [0.5, 1, 2, 3];

/**
 * A recipe laid out for cooking: photo and details on top, ingredients beside the method.
 * Portions scale the ingredient amounts on screen (and what Shop adds); the note keeps the
 * original. Ticking ingredients and steps is just for this cook.
 */
export function RecipeView({ path, onRate, factor, onFactor }: { path: string; onRate: (stars: number) => void; factor: number; onFactor: (f: number) => void }) {
  const { hold, bump, reportError, toast } = useHold();
  const nav = useNav();
  const file = hold.get(path);
  const [got, setGot] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<Set<string>>(new Set());
  const [need, setNeed] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    setGot(new Set());
    setDone(new Set());
    setNeed("");
    setNote("");
  }, [path]);
  if (!file) return null;

  const layout = recipeLayout(file.body);
  const source = typeof file.frontmatter.source === "string" ? file.frontmatter.source : undefined;
  const time = file.frontmatter.time ? String(file.frontmatter.time) : undefined;
  const servingsText = file.frontmatter.servings ? String(file.frontmatter.servings) : undefined;
  const base = servingsCount(file.frontmatter.servings);
  const serves = base ? base * factor : undefined;
  const scaled = factor !== 1;
  const cols = hold.recipeCollections(file);
  const image = recipeImage(file);
  const notes = layout.others.find((o) => /^notes?\b/i.test(o.heading));
  const others = layout.others.filter((o) => o !== notes);
  const toggle = (set: Set<string>, key: string, update: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    update(next);
  };
  const onLink = (t: string) => (/^https?:\/\//i.test(t) ? void openUrl(t).catch(reportError) : nav.openLink(t));
  const ingredientCount = layout.ingredients.reduce((n, g) => n + g.items.length, 0);
  const setServings = (n: number) => base && onFactor(Math.max(1, n) / base);
  const ask = (ingredient?: string) => nav.askClaude(substitutionPrompt(file, { ingredient, need: need.trim() || undefined, servings: serves, factor }));
  const saveNote = async () => {
    try {
      await flushEditors();
      await hold.addRecipeNote(path, note);
      setNote("");
      bump();
      toast("Note added");
    } catch (e) {
      reportError(e);
    }
  };
  let stepNo = 0;

  return (
    <article className="recipe-view">
      <header className={`recipe-hero${image ? " has-photo" : ""}`}>
        {image && <RecipePhoto src={image} className="recipe-hero-photo" />}
        <div className="recipe-hero-text">
          <h1>{file.title}</h1>
          <Stars value={hold.recipeRating(file)} onChange={onRate} size={18} />
          <dl className="recipe-facts">
            {time && (
              <div>
                <dt>
                  <Clock size={14} aria-hidden="true" /> Time
                </dt>
                <dd>{time}</dd>
              </div>
            )}
            {servingsText && (
              <div>
                <dt>
                  <Users size={14} aria-hidden="true" /> Serves
                </dt>
                <dd>
                  {serves && scaled ? (
                    <>
                      {formatAmount(serves)} <span className="muted">(recipe makes {servingsText})</span>
                    </>
                  ) : (
                    servingsText
                  )}
                </dd>
              </div>
            )}
            {source && (
              <div>
                <dt>
                  <ExternalLink size={14} aria-hidden="true" /> From
                </dt>
                <dd>
                  <button className="link" onClick={() => void openUrl(source).catch(reportError)} title={source}>
                    {host(source)}
                  </button>
                </dd>
              </div>
            )}
          </dl>
          {cols.length > 0 && (
            <div className="recipe-tags">
              {cols.map((c) => (
                <span key={c} className="recipe-tag">
                  {c}
                </span>
              ))}
            </div>
          )}
          {layout.intro && (
            <div className="recipe-intro">
              <ChatMarkdown text={layout.intro} onLink={onLink} />
            </div>
          )}
        </div>
      </header>

      <div className="recipe-body">
        <section className="recipe-ingredients" aria-labelledby="rv-ing">
          <div className="recipe-section-head">
            <h2 id="rv-ing">Ingredients</h2>
            {got.size > 0 && (
              <button className="ghost small icon-text" onClick={() => setGot(new Set())} title="Untick all">
                <RotateCcw size={12} aria-hidden="true" /> {got.size}/{ingredientCount}
              </button>
            )}
          </div>

          <div className="recipe-scale" role="group" aria-label="Portions">
            {base ? (
              <span className="recipe-servings">
                <button className="ghost icon-btn small" onClick={() => setServings(Math.ceil(serves!) - 1)} disabled={serves! <= 1} aria-label="One serving fewer" title="One serving fewer">
                  <Minus size={13} />
                </button>
                <span className="n" aria-live="polite">
                  {formatAmount(serves!)} <span className="muted">serving{serves === 1 ? "" : "s"}</span>
                </span>
                <button className="ghost icon-btn small" onClick={() => setServings(Math.floor(serves!) + 1)} aria-label="One serving more" title="One serving more">
                  <Plus size={13} />
                </button>
              </span>
            ) : null}
            <span className="seg" role="radiogroup" aria-label="Scale">
              {QUICK.map((q) => (
                <button key={q} role="radio" aria-checked={factor === q} className={factor === q ? "on" : ""} onClick={() => onFactor(q)} title={q === 1 ? "As written" : q < 1 ? "Half the recipe" : `${q} times the recipe`}>
                  {factorLabel(q)}
                </button>
              ))}
            </span>
            {scaled && !QUICK.includes(factor) && <span className="muted small-text">{factorLabel(factor)}</span>}
          </div>

          {!ingredientCount && <p className="muted">None listed yet. Switch to Edit to add them.</p>}
          {layout.ingredients.map((g, gi) => (
            <div key={gi} className="recipe-group">
              {g.label && <h3>{g.label}</h3>}
              <ul>
                {g.items.map((it, i) => {
                  const key = `${gi}:${i}`;
                  const on = got.has(key);
                  const text = scaleIngredient(it, factor);
                  return (
                    <li key={key} className="recipe-ing">
                      <button className={`recipe-check${on ? " on" : ""}`} aria-pressed={on} onClick={() => toggle(got, key, setGot)}>
                        <span className="box" aria-hidden="true">
                          {on && <Check size={12} />}
                        </span>
                        <span>{text}</span>
                      </button>
                      <button className="recipe-swap ghost icon-btn small" onClick={() => ask(text)} title={`Ask Claude what to use instead of ${text}`} aria-label={`Ask Claude for a substitute for ${text}`}>
                        <ArrowLeftRight size={13} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          <form
            className="recipe-ask"
            onSubmit={(e) => {
              e.preventDefault();
              ask();
            }}
          >
            <input value={need} onChange={(e) => setNeed(e.target.value)} placeholder="No dairy? Out of eggs?" aria-label="What do you need to swap or avoid?" />
            <button type="submit" className="small icon-text" title="Ask Claude for substitutions (leave the box blank for general ideas)">
              <Sparkles size={13} aria-hidden="true" /> Ask Claude
            </button>
          </form>
        </section>

        <section className="recipe-method" aria-labelledby="rv-method">
          <div className="recipe-section-head">
            <h2 id="rv-method">Method</h2>
            {done.size > 0 && (
              <button className="ghost small icon-text" onClick={() => setDone(new Set())} title="Start over">
                <RotateCcw size={12} aria-hidden="true" /> Start over
              </button>
            )}
          </div>
          {scaled && <p className="recipe-scale-hint muted">Amounts in the steps are for the recipe as written{servingsText ? ` (serves ${servingsText})` : ""}.</p>}
          {!layout.steps.some((g) => g.items.length) && <p className="muted">No steps yet. Switch to Edit to write the method.</p>}
          {layout.steps.map((g, gi) => (
            <div key={gi} className="recipe-group">
              {g.label && <h3>{g.label}</h3>}
              <ol>
                {g.items.map((it, i) => {
                  const key = `${gi}:${i}`;
                  const on = done.has(key);
                  stepNo++;
                  return (
                    <li key={key}>
                      <button className={`recipe-step${on ? " on" : ""}`} aria-pressed={on} onClick={() => toggle(done, key, setDone)} title={on ? "Mark as not done" : "Mark as done"}>
                        <span className="num" aria-hidden="true">
                          {on ? <Check size={14} /> : stepNo}
                        </span>
                        <span className="text">{it}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </section>
      </div>

      <section className="recipe-notes" aria-labelledby="rv-notes">
        <h2 id="rv-notes">{notes?.heading ?? "Notes"}</h2>
        {notes ? <ChatMarkdown text={notes.text} onLink={onLink} /> : <p className="muted">What you changed, who loved it, when you made it.</p>}
        <form
          className="recipe-note-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) void saveNote();
          }}
        >
          <NotebookPen size={15} aria-hidden="true" />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note: made for Thanksgiving 2026, used less clove…" aria-label="Add a note" />
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
