import { DEFAULT_LIST } from "../core/capture";
import { Hold } from "../core/hold";
import { ParsedFile } from "../core/parse";
import { formatAmount, scaleIngredient } from "../core/scale";
import { slugify } from "../core/templates";
import { fetchImage } from "../lib/platform";

/** "PT1H30M" → "1 h 30 min" (other text is shown as is). */
export function cookTime(iso: unknown): string | undefined {
  if (typeof iso !== "string" || !iso) return undefined;
  const m = /^P(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?/i.exec(iso);
  if (!m || (!m[1] && !m[2])) return iso;
  return [m[1] && `${Number(m[1])} h`, m[2] && Number(m[2]) && `${Number(m[2])} min`].filter(Boolean).join(" ");
}

/** Put a recipe's ingredients on the Shopping list (skipping any already there). Returns what happened. */
export async function shopForRecipe(hold: Hold, f: ParsedFile, factor = 1): Promise<string> {
  return shopForRecipes(hold, [f], factor);
}

/** "×2", "×½", "×1.25" */
export function factorLabel(f: number): string {
  return `×${formatAmount(f)}`;
}

/**
 * What to ask Claude for substitutions: about one ingredient, or the recipe as a whole with what
 * the cook needs (no dairy, out of eggs…). Claude reads the recipe file itself, and only writes to
 * its Notes when told which swap was used.
 */
export function substitutionPrompt(f: ParsedFile, o: { ingredient?: string; need?: string; servings?: number; factor?: number }): string {
  const scaled = o.factor && o.factor !== 1 ? ` I'm making it ${factorLabel(o.factor)}${o.servings ? ` (for ${formatAmount(o.servings)})` : ""}, so give amounts for that.` : "";
  const ask = o.ingredient
    ? `What can I use instead of "${o.ingredient}"?${o.need ? ` (${o.need})` : ""}`
    : o.need
      ? `I need to adapt it: ${o.need}. What should I swap, and for what?`
      : "Which ingredients could I swap out, and for what?";
  return [
    `Recipe substitutions for "${f.title}" (${f.path}).`,
    `${ask}${scaled}`,
    "Give 2-4 options with amounts, and how each changes the taste, texture or method.",
    "Don't edit the recipe yet. If I tell you which one I used, add it as a dated line under its ## Notes (\"- YYYY-MM-DD: …\").",
  ].join("\n");
}

/** Put the ingredients of several recipes (a whole collection) on the Shopping list, amounts × `factor`. */
export async function shopForRecipes(hold: Hold, files: ParsedFile[], factor = 1): Promise<string> {
  const items = files.flatMap((f) => hold.recipeIngredients(f)).map((i) => scaleIngredient(i, factor));
  if (!items.length) return files.length === 1 ? "This recipe has no ingredients listed yet" : "These recipes have no ingredients listed yet";
  const n = await hold.addToList(DEFAULT_LIST, items);
  return n ? `Added ${n} ingredient${n === 1 ? "" : "s"} to ${DEFAULT_LIST}` : `Everything's already on ${DEFAULT_LIST}`;
}

/**
 * Keep a recipe's photo in the hold (attachments/recipes/<slug>.jpg) so it survives the site
 * changing. Returns the hold path, or the web link when the download fails.
 */
export async function keepRecipeImage(dir: string, title: string, image: string | undefined, page: string): Promise<string | undefined> {
  if (!image) return undefined;
  let url: string;
  try {
    url = new URL(image, page).href;
  } catch {
    return undefined;
  }
  try {
    return await fetchImage(dir, `attachments/recipes/${slugify(title) || "recipe"}`, url);
  } catch {
    return url;
  }
}

/** The picture to show for a recipe: its `image:`, or the first ![](…) in the note. */
export function recipeImage(f: ParsedFile): string | undefined {
  if (typeof f.frontmatter.image === "string" && f.frontmatter.image) return f.frontmatter.image;
  const m = /!\[[^\]]*\]\(<?([^)>]+?)>?(?:\s+"[^"]*")?\)/.exec(f.body);
  return m?.[1];
}

export interface RecipeGroup {
  /** A "### For the crust" sub-heading, if the list has one */
  label?: string;
  items: string[];
}

export interface RecipeLayout {
  /** Text between the title and the first section (the photo line left out) */
  intro: string;
  ingredients: RecipeGroup[];
  steps: RecipeGroup[];
  /** Notes and any other sections, as markdown */
  others: { heading: string; text: string }[];
}

/** Light markdown left in list text: **bold**, _em_, `code`, [label](url) → plain words. */
export function plainText(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, t, l) => l ?? t)
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|\W)[*_](.+?)[*_](?=\W|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

/**
 * A recipe written out as a plain-text email: title, intro, time and servings, ingredients, method
 * and a link to where it came from. Your own Notes stay out of it.
 */
export function recipeEmail(f: ParsedFile): { subject: string; body: string } {
  const layout = recipeLayout(f.body);
  const out: string[] = [f.title, ""];
  const intro = layout.intro
    .split(/\r?\n/)
    .map((l) => plainText(l.replace(/^\s*#{1,6}\s+/, "")))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (intro) out.push(intro, "");
  const facts = [
    f.frontmatter.time ? `Time: ${String(f.frontmatter.time)}` : "",
    f.frontmatter.servings ? `Serves: ${String(f.frontmatter.servings)}` : "",
  ].filter(Boolean);
  if (facts.length) out.push(facts.join("   "), "");
  const section = (heading: string, groups: RecipeGroup[], numbered: boolean) => {
    if (!groups.some((g) => g.items.length)) return;
    out.push(heading.toUpperCase());
    let n = 0;
    for (const g of groups) {
      if (g.label) out.push("", g.label);
      for (const item of g.items) out.push(numbered ? `${++n}. ${item}` : `- ${item}`);
    }
    out.push("");
  };
  section("Ingredients", layout.ingredients, false);
  section("Method", layout.steps, true);
  const source = typeof f.frontmatter.source === "string" ? f.frontmatter.source : undefined;
  if (source) out.push(`Original recipe: ${source}`);
  return { subject: `Recipe: ${f.title}`, body: out.join("\n").trim() + "\n" };
}

/** Past this length some mail apps cut a mailto: link short, so the recipe goes on the clipboard instead. */
export const MAILTO_MAX = 2000;

/** A mailto: link that drafts the email; `undefined` body leaves it empty. */
export function mailtoUrl(subject: string, body?: string): string {
  const q = [`subject=${encodeURIComponent(subject)}`];
  if (body != null) q.push(`body=${encodeURIComponent(body.replace(/\r?\n/g, "\r\n"))}`);
  return `mailto:?${q.join("&")}`;
}

/** The items of a list section: bullets or numbers (wrapped lines joined), else one per paragraph. */
function listGroups(lines: string[]): RecipeGroup[] {
  const groups: RecipeGroup[] = [{ items: [] }];
  let para: string[] = [];
  let open = false; // the last item can take continuation lines
  const flushPara = () => {
    if (para.length) groups[groups.length - 1].items.push(para.join(" "));
    para = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const sub = /^#{3,6}\s+(.*)$/.exec(line);
    if (sub) {
      flushPara();
      open = false;
      groups.push({ label: plainText(sub[1]), items: [] });
      continue;
    }
    const item = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(line);
    if (item) {
      flushPara();
      const text = plainText(item[1]);
      open = !!text;
      if (text) groups[groups.length - 1].items.push(text);
      continue;
    }
    if (!line.trim()) {
      flushPara();
      open = false;
      continue;
    }
    const items = groups[groups.length - 1].items;
    if (open && /^\s+/.test(line)) items[items.length - 1] += ` ${plainText(line)}`;
    else para.push(plainText(line));
  }
  flushPara();
  return groups.filter((g) => g.items.length || g.label);
}

/** Split a recipe note's body into what the recipe view lays out. */
export function recipeLayout(body: string): RecipeLayout {
  const out: RecipeLayout = { intro: "", ingredients: [], steps: [], others: [] };
  const sections: { heading: string; lines: string[] }[] = [{ heading: "", lines: [] }];
  let fence = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const h = !fence && /^##\s+(.*)$/.exec(line);
    if (h) sections.push({ heading: h[1].trim(), lines: [] });
    else if (!fence && /^#\s/.test(line) && sections.length === 1) continue; // the title
    else sections[sections.length - 1].lines.push(line);
  }
  for (const s of sections) {
    const name = s.heading.toLowerCase();
    if (!s.heading) {
      out.intro = s.lines
        .filter((l) => !/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(l))
        .join("\n")
        .trim();
    } else if (/^ingredients\b/.test(name)) out.ingredients.push(...listGroups(s.lines));
    else if (/^(method|directions|instructions|steps|preparation)\b/.test(name)) out.steps.push(...listGroups(s.lines));
    else {
      const text = s.lines.join("\n").trim();
      if (text) out.others.push({ heading: s.heading, text });
    }
  }
  return out;
}
