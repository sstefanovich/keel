import { Hold } from "../core/hold";
import { SCRATCH_PATH, appendLine } from "../core/scratch";

/** The open Scratchpad view, if any: appends go through it so they never race its unsaved typing. */
let live: ((text: string) => Promise<void>) | null = null;

export function setLiveScratch(fn: (text: string) => Promise<void>): () => void {
  live = fn;
  return () => {
    if (live === fn) live = null;
  };
}

/** Add a line to the end of the scratchpad. */
export async function appendToScratch(hold: Hold, text: string): Promise<void> {
  if (live) return live(text);
  const page = (await hold.fs.exists(SCRATCH_PATH)) ? await hold.fs.read(SCRATCH_PATH) : "";
  await hold.fs.write(SCRATCH_PATH, appendLine(page, text));
}
