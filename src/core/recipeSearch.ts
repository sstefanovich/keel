/**
 * Recipe search: "what can I make with chicken and lemon?" rather than "which lines say chicken".
 * Each term is matched as a word or its plural (so "thigh" finds "thighs" but "egg" doesn't find
 * "eggplant") in the title or collections, the ingredients, or anywhere else in the note. Recipes
 * with every term come first; ones with only some are kept, marked partial, below them.
 */

export interface RecipeDoc {
  path: string;
  title: string;
  ingredients: string[];
  collections: string[];
  /** The rest of the note (method, notes…) */
  text: string;
  rating: number;
  /** Total time in minutes, when the recipe says */
  minutes?: number;
}

export interface RecipeQuery {
  q: string;
  /** 0 = any; -1 = only recipes not rated yet */
  minRating?: number;
  maxMinutes?: number;
}

export interface RecipeHit {
  path: string;
  /** How many of the terms matched, and of how many */
  matched: number;
  terms: number;
  score: number;
  /** Ingredient lines that matched a term, for showing on the card */
  ingredients: string[];
  /** Terms found only in the method or notes */
  elsewhere: string[];
}

/** "chicken thighs, lemon" → two phrases; "chicken lemon" → two words. */
export function recipeTerms(q: string): string[] {
  const t = q.toLowerCase().trim();
  if (!t) return [];
  const parts = t.includes(",") ? t.split(",") : t.split(/\s+/);
  return [...new Set(parts.map((p) => p.trim().replace(/\s+/g, " ")).filter(Boolean))];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The term as a whole word or its plural ("thigh" → "thighs", "tomato" → "tomatoes"); `prefix` for a word still being typed. */
function termRe(term: string, prefix = false): RegExp {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc(term)}${prefix ? "" : "(?:s|es)?(?![\\p{L}\\p{N}])"}`, "iu");
}

/** "1 h 20 min", "PT1H20M", "45 minutes", "1 hour 30", "90" → minutes; undefined when unclear. */
export function minutesOf(time: unknown): number | undefined {
  if (typeof time === "number") return time > 0 ? time : undefined;
  if (typeof time !== "string" || !time.trim()) return undefined;
  const t = time.trim();
  const iso = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i.exec(t);
  if (iso && (iso[1] || iso[2] || iso[3])) return Number(iso[1] ?? 0) * 1440 + Number(iso[2] ?? 0) * 60 + Number(iso[3] ?? 0);
  const h = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)\b/i.exec(t);
  const m = /(\d+)\s*(?:m|min|mins|minutes?)\b/i.exec(t);
  if (h || m) {
    // "1 hour 30" — a bare number after the hours is minutes
    const after = h && !m ? /^\s*(\d+)\s*$/.exec(t.slice(h.index + h[0].length)) : null;
    return Math.round(Number(h?.[1] ?? 0) * 60 + Number(m?.[1] ?? after?.[1] ?? 0)) || undefined;
  }
  return /^\d+$/.test(t) ? Number(t) : undefined;
}

/** Recipes that fit the filters and match the query, best first (all of them, unranked, with no query). */
export function searchRecipes(docs: RecipeDoc[], query: RecipeQuery): RecipeHit[] {
  const terms = recipeTerms(query.q);
  // the last word, until a space or comma ends it, matches as a prefix so results don't vanish mid-word
  const typing = !/[\s,]$/.test(query.q);
  const res = terms.map((t, i) => termRe(t, typing && i === terms.length - 1));
  const out: RecipeHit[] = [];
  for (const d of docs) {
    if (query.minRating === -1 ? d.rating > 0 : query.minRating && d.rating < query.minRating) continue;
    if (query.maxMinutes && (d.minutes === undefined || d.minutes > query.maxMinutes)) continue;
    const hit: RecipeHit = { path: d.path, matched: 0, terms: terms.length, score: 0, ingredients: [], elsewhere: [] };
    const head = [d.title, ...d.collections].join("\n");
    terms.forEach((term, i) => {
      const re = res[i];
      const inHead = re.test(head);
      const ings = d.ingredients.filter((l) => re.test(l));
      const inText = !inHead && !ings.length && re.test(d.text);
      if (!inHead && !ings.length && !inText) return;
      hit.matched++;
      hit.score += (inHead ? 3 : 0) + (ings.length ? 2 : 0) + (inText ? 1 : 0);
      for (const l of ings) if (!hit.ingredients.includes(l)) hit.ingredients.push(l);
      if (inText) hit.elsewhere.push(term);
    });
    if (terms.length && !hit.matched) continue;
    out.push(hit);
  }
  if (terms.length) out.sort((a, b) => b.matched - a.matched || b.score - a.score);
  return out;
}
