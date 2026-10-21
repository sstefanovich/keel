import { Hold } from "../core/hold";
import { basename } from "../core/parse";
import { slugify } from "../core/templates";

/** Something hours can be logged against, for @ suggestions. */
export interface WorkTarget {
  /** What gets inserted after @ */
  key: string;
  /** Shown beside it, e.g. "FLIS Retain / PA · Hogan Lovells" */
  detail: string;
  /** Client key, for narrowing "@client/…" */
  client?: string;
  /** Project key (when this is a project) */
  project?: string;
}

/** Active projects first (with their client), then clients, then other keys already used in hours lines. */
export function workTargets(hold: Hold): WorkTarget[] {
  const clients = hold.clients();
  const projects = hold
    .all()
    .filter((f) => f.kind === "project" && f.frontmatter.status !== "done")
    .map((p) => {
      const client = hold.fileClient(p);
      const key = slugify(basename(p.path));
      return { key, project: key, client, detail: `${p.title} · ${client ? (clients.get(client)?.name ?? client) : "no client"}` };
    })
    .sort((a, b) => a.detail.localeCompare(b.detail));
  const clientTargets = [...clients.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ key: c.key, client: c.key, detail: `${c.name} (client)` }));
  const known = new Set([...projects.map((p) => p.key), ...clientTargets.map((c) => c.key)]);
  const others = [...new Set(hold.all().flatMap((f) => f.hours.map((h) => h.client)))]
    .filter((k) => !known.has(k) && !k.includes("/"))
    .sort()
    .map((k) => ({ key: k, detail: "used before" }));
  return [...projects, ...clientTargets, ...others];
}

/**
 * Suggestions for an "@…" being typed just before the caret, or null when not in one.
 * "@fl" matches keys and names containing "fl" (prefix matches first); "@client/" lists that
 * client's projects. `from`/`to` is the span to replace.
 */
export function mentionAt(text: string, caret: number, targets: WorkTarget[]): { from: number; to: number; options: { insert: string; target: WorkTarget }[] } | null {
  const m = text.slice(0, caret).match(/(^|\s)@([\w.-]*)(?:\/([\w.-]*))?$/);
  if (!m) return null;
  const from = caret - m[0].length + m[1].length;
  // replace through the end of the word under the caret too
  const to = caret + (text.slice(caret).match(/^[\w./-]*/)?.[0].length ?? 0);
  const rank = (q: string, t: WorkTarget, key: string) => {
    const k = key.toLowerCase();
    const d = t.detail.toLowerCase();
    return k.startsWith(q) ? 0 : k.includes(q) ? 1 : d.includes(q) ? 2 : -1;
  };
  let options: { insert: string; target: WorkTarget; r: number }[];
  if (m[3] !== undefined) {
    const client = m[2].toLowerCase();
    const q = m[3].toLowerCase();
    options = targets
      .filter((t) => t.project && t.client === client)
      .map((t) => ({ insert: `@${client}/${t.project}`, target: t, r: rank(q, t, t.project!) }));
  } else {
    const q = m[2].toLowerCase();
    options = targets.map((t) => ({ insert: `@${t.key}`, target: t, r: rank(q, t, t.key) }));
  }
  const sorted = options.filter((o) => o.r >= 0).sort((a, b) => a.r - b.r);
  return { from, to, options: sorted.slice(0, 8).map(({ insert, target }) => ({ insert, target })) };
}
