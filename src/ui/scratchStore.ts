import { Hold } from "../core/hold";
import { Space } from "../core/parse";
import { appendLine, scratchPath } from "../core/scratch";

/** The open Scratchpad view, if any, and its space: appends go through it so they never race its unsaved typing. */
let live: { space: Space; append: (text: string) => Promise<void> } | null = null;

export function setLiveScratch(space: Space, append: (text: string) => Promise<void>): () => void {
  const mine = { space, append };
  live = mine;
  return () => {
    if (live === mine) live = null;
  };
}

/** Add a line to the end of a space's scratchpad. */
export async function appendToScratch(hold: Hold, text: string, space: Space = "work"): Promise<void> {
  if (live?.space === space) return live.append(text);
  const path = scratchPath(space);
  const page = (await hold.fs.exists(path)) ? await hold.fs.read(path) : "";
  await hold.fs.write(path, appendLine(page, text));
}
