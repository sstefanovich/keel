import { Hold } from "../core/hold";
import { meetingKey } from "../core/meetingHours";
import { basename } from "../core/parse";
import { slugify } from "../core/templates";

/** Projects (and each client's general bucket) that hours can be logged against, for pickers. */
export function workOptions(hold: Hold, focus?: string): { key: string; text: string }[] {
  const clients = [...hold.clients().values()].sort((a, b) => a.name.localeCompare(b.name));
  return clients
    .filter((c) => !focus || c.key === focus)
    .flatMap((c) => [
      ...hold
        .projectsOf(c.key)
        .filter((p) => p.frontmatter.status !== "done")
        .map((p) => ({ key: slugify(basename(p.path)), text: `${p.title} · ${c.name}` })),
      { key: c.key, text: `${c.name} (general)` },
    ]);
}

const LEARNED_KEY = "keel.meetingProjects";

/** Projects picked for meetings before, by normalised title, so recurring meetings are grouped automatically. */
export function learnedProjects(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LEARNED_KEY) ?? "") ?? {};
  } catch {
    return {};
  }
}

export function learnProject(title: string, key: string): Record<string, string> {
  const next = { ...learnedProjects(), [meetingKey(title)]: key };
  try {
    localStorage.setItem(LEARNED_KEY, JSON.stringify(next));
  } catch {
    // per-machine convenience only
  }
  return next;
}

/** The project a meeting belongs to: the one picked for it before, else the one its title names. */
export function meetingOwner(hold: Hold, title: string, learned: Record<string, string> = learnedProjects()): string | undefined {
  const known = learned[meetingKey(title)];
  if (known) return known;
  const g = hold.guessOwner(title);
  return g.project ?? g.client;
}

/** "Website redesign" for a project key, else the client's name. */
export function ownerName(hold: Hold, key: string): string {
  const r = hold.resolveHours(key);
  return r.project && hold.projectByKey(r.project) ? hold.projectName(r.project) : (hold.clients().get(r.client)?.name ?? `@${key}`);
}
