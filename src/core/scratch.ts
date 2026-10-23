/** The scratchpad: one plain-text page in the hold for transient jottings. */

export const SCRATCH_PATH = "scratchpad.txt";

/**
 * The text an action applies to: the selection, or (with nothing selected) the whole
 * line the cursor is on. Returns what was taken and the page without it, with the gap closed.
 */
export function takeText(page: string, from: number, to: number): { taken: string; rest: string; at: number } {
  let start = Math.min(from, to);
  let end = Math.max(from, to);
  if (start === end) {
    start = page.lastIndexOf("\n", start - 1) + 1;
    const nl = page.indexOf("\n", end);
    end = nl === -1 ? page.length : nl;
  }
  const taken = page.slice(start, end).trim();
  let before = page.slice(0, start);
  let after = page.slice(end);
  // close the gap: drop the emptied line(s) rather than leaving blank space behind
  if ((before === "" || before.endsWith("\n")) && after.startsWith("\n")) after = after.slice(1);
  else if (after === "" && before.endsWith("\n")) before = before.slice(0, -1);
  return { taken, rest: before + after, at: before.length };
}

/** Non-empty lines, with any bullet or checkbox the user typed stripped. */
export function linesOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^(?:[-*+•]\s+)?(?:\[[ xX]\]\s+)?/, "").trim())
    .filter(Boolean);
}

/** A note from jotted text: first line becomes the title, the rest the body. */
export function noteFromText(text: string): { title: string; body: string } {
  const lines = text.trim().split(/\r?\n/);
  const title = (lines[0] ?? "").replace(/^#+\s*/, "").trim().slice(0, 80) || "Scratch note";
  return { title, body: lines.slice(1).join("\n").trim() };
}
