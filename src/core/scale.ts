/**
 * Scaling recipe amounts: "1 1/2 cups flour" × 2 → "3 cups flour". Only the amount at the start of
 * an ingredient line changes; text later in the line ("1 can (400 g)") describes a pack and stays.
 */

const GLYPHS: Record<string, number> = { "½": 1 / 2, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 1 / 4, "¾": 3 / 4, "⅛": 1 / 8, "⅜": 3 / 8, "⅝": 5 / 8, "⅞": 7 / 8 };
const GLYPH = "[½⅓⅔¼¾⅛⅜⅝⅞]";
/** 1 1/2 · 1/2 · 1½ · 1.5 · ½ */
const NUM = `(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?(?:\\s?${GLYPH})?|${GLYPH})`;
const LEAD = new RegExp(`^(${NUM})(?:\\s*(?:-|–|to)\\s*(${NUM}))?`);
const METRIC = /^\s*(?:g|kg|mg|ml|l|cl|dl|grams?|kilograms?|millilit(?:re|er)s?|lit(?:re|er)s?)\b/i;

/** "1 1/2" → 1.5, "1½" → 1.5, "½" → 0.5 */
export function parseAmount(s: string): number {
  const t = s.trim();
  let m = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = /^(\d+)\/(\d+)$/.exec(t);
  if (m) return Number(m[1]) / Number(m[2]);
  m = new RegExp(`^(\\d+(?:\\.\\d+)?)?\\s?(${GLYPH})?$`).exec(t);
  if (m && (m[1] || m[2])) return (m[1] ? Number(m[1]) : 0) + (m[2] ? GLYPHS[m[2]] : 0);
  return NaN;
}

const FRACTIONS: [number, string][] = [
  [0, ""],
  [1 / 8, "⅛"],
  [1 / 4, "¼"],
  [1 / 3, "⅓"],
  [3 / 8, "⅜"],
  [1 / 2, "½"],
  [5 / 8, "⅝"],
  [2 / 3, "⅔"],
  [3 / 4, "¾"],
  [7 / 8, "⅞"],
  [1, ""],
];

/** A kitchen-friendly amount: fractions for cups and spoons, whole numbers for grams and millilitres. */
export function formatAmount(v: number, metric = false): string {
  if (metric || v >= 20) {
    const r = v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
    return String(r);
  }
  const whole = Math.floor(v);
  const [frac, glyph] = FRACTIONS.reduce((best, f) => (Math.abs(v - whole - f[0]) < Math.abs(v - whole - best[0]) ? f : best));
  const w = whole + (frac === 1 ? 1 : 0);
  if (!w && !glyph) return String(Math.round(v * 100) / 100 || v.toPrecision(1)); // a pinch: keep it visible
  return `${w || ""}${glyph}`;
}

/** One ingredient line with its leading amount (or range) multiplied. Lines without one are unchanged. */
export function scaleIngredient(line: string, factor: number): string {
  if (factor === 1) return line;
  const m = LEAD.exec(line);
  if (!m) return line;
  const rest = line.slice(m[0].length);
  const metric = METRIC.test(rest);
  const a = parseAmount(m[1]);
  if (!Number.isFinite(a)) return line;
  let out = formatAmount(a * factor, metric);
  if (m[2]) {
    const b = parseAmount(m[2]);
    if (Number.isFinite(b)) out += `–${formatAmount(b * factor, metric)}`;
  }
  return out + rest;
}

/** The number of servings in "8", "4 servings", "6-8 people" (the first number), or undefined. */
export function servingsCount(v: unknown): number | undefined {
  const m = /\d+(?:\.\d+)?/.exec(String(v ?? ""));
  const n = m ? Number(m[0]) : NaN;
  return n > 0 ? n : undefined;
}
