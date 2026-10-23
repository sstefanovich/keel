import { DEFAULT_LIST } from "../core/capture";
import { Hold } from "../core/hold";
import { ParsedFile } from "../core/parse";

/** "PT1H30M" → "1 h 30 min" (other text is shown as is). */
export function cookTime(iso: unknown): string | undefined {
  if (typeof iso !== "string" || !iso) return undefined;
  const m = /^P(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?/i.exec(iso);
  if (!m || (!m[1] && !m[2])) return iso;
  return [m[1] && `${Number(m[1])} h`, m[2] && Number(m[2]) && `${Number(m[2])} min`].filter(Boolean).join(" ");
}

/** Put a recipe's ingredients on the Shopping list (skipping any already there). Returns what happened. */
export async function shopForRecipe(hold: Hold, f: ParsedFile): Promise<string> {
  const items = hold.recipeIngredients(f);
  if (!items.length) return "This recipe has no ingredients listed yet";
  const n = await hold.addToList(DEFAULT_LIST, items);
  return n ? `Added ${n} ingredient${n === 1 ? "" : "s"} to ${DEFAULT_LIST}` : `Everything's already on ${DEFAULT_LIST}`;
}
