import { BookStatus } from "../core/hold";
import { ParsedFile } from "../core/parse";
import { slugify } from "../core/templates";
import { fetchImage } from "../lib/platform";

export const STATUS_LABEL: Record<BookStatus, string> = { "to-read": "To read", reading: "Reading", read: "Read" };

/** How you got your copy (frontmatter `copy:`). */
export const COPIES = [
  ["bought", "Bought"],
  ["library", "Library"],
  ["borrowed", "Borrowed"],
  ["gift", "Gift"],
] as const;
export type Copy = (typeof COPIES)[number][0];

export function bookCopy(f: ParsedFile): Copy | undefined {
  const v = String(f.frontmatter.copy ?? "").toLowerCase();
  return COPIES.find(([k]) => k === v)?.[0];
}

export function bookAuthor(f: ParsedFile): string {
  return typeof f.frontmatter.author === "string" ? f.frontmatter.author : "";
}

/** The cover to show: `cover:`, or the first ![](…) in the note. */
export function bookCover(f: ParsedFile): string | undefined {
  if (typeof f.frontmatter.cover === "string" && f.frontmatter.cover) return f.frontmatter.cover;
  const m = /!\[[^\]]*\]\(<?([^)>]+?)>?(?:\s+"[^"]*")?\)/.exec(f.body);
  return m?.[1];
}

/** A smaller cover for lists ("…-L.jpg" → "…-M.jpg" on Open Library). */
export function smallCover(url?: string): string | undefined {
  return url?.replace(/-L\.jpg$/, "-M.jpg");
}

/**
 * Keep a book's cover in the hold (attachments/books/<slug>.jpg). Returns the hold path, or the
 * web link when the download fails.
 */
export async function keepCover(dir: string, title: string, url?: string): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    return await fetchImage(dir, `attachments/books/${slugify(title) || "book"}`, url);
  } catch {
    return url;
  }
}

/** "2026-11-19" → "Nov 19, 2026" (other text as is). */
export function shortDate(v: unknown): string | undefined {
  const s = typeof v === "string" ? v : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || undefined;
  return new Date(`${s}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** The ISO date a book was finished, if it was. */
export function finishedOn(f: ParsedFile): string | undefined {
  const s = String(f.frontmatter.finished ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
}
