/**
 * Hands prompts to the Claude panel (e.g. "? question" from quick capture). Prompts queue
 * until the panel's Claude session is running and has had a moment to draw its input box.
 */
const queue: string[] = [];
const listeners = new Set<() => void>();

export function sendToClaude(prompt: string) {
  queue.push(prompt);
  listeners.forEach((l) => l());
}

/** Take all queued prompts (the panel calls this once Claude is ready). */
export function takeClaudePrompts(): string[] {
  return queue.splice(0);
}

export function onClaudePrompt(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
