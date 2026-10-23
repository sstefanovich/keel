import { HoursEntry } from "./parse";

/**
 * Turning a day's calendar meetings into Work entries: group them by the project (or client) their
 * titles name, total the time, and leave out ones already listed in the day's Work.
 */

export interface MeetingLike {
  id: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  free: boolean;
}

export interface MeetingGroup<M extends MeetingLike = MeetingLike> {
  /** Project or client key */
  key: string;
  meetings: M[];
  /** Total, rounded to the quarter hour */
  hours: number;
}

/** Rounded to the nearest quarter hour, at least a quarter. */
export function quarterHours(ms: number): number {
  return Math.max(0.25, Math.round(ms / 900_000) / 4);
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Meetings that count as work time: timed, busy, under 10 hours, started by `now`. */
export function workMeetings<M extends MeetingLike>(events: M[], now: number): M[] {
  return events.filter((e) => !e.allDay && !e.free && e.end > e.start && e.end - e.start <= 10 * 3_600_000 && e.start <= now);
}

/** Whether a meeting is already in the day's Work (its title is one of the listed items). */
export function isLogged(m: MeetingLike, blocks: HoursEntry[]): boolean {
  const t = norm(m.title);
  return blocks.some((b) => b.items.some((i) => norm(i) === t));
}

export function groupMeetings<M extends MeetingLike>(
  meetings: M[],
  ownerOf: (title: string) => string | undefined,
  blocks: HoursEntry[],
  dismissed: Set<string> = new Set(),
): { groups: MeetingGroup<M>[]; unassigned: M[] } {
  const byKey = new Map<string, M[]>();
  const unassigned: M[] = [];
  for (const m of meetings) {
    if (dismissed.has(m.id) || isLogged(m, blocks)) continue;
    const key = ownerOf(m.title);
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), m]);
    else unassigned.push(m);
  }
  const groups = [...byKey].map(([key, ms]) => ({ key, meetings: ms, hours: quarterHours(ms.reduce((s, m) => s + (m.end - m.start), 0)) }));
  return { groups, unassigned };
}

/** Normalised title used to remember which project a (recurring) meeting belongs to. */
export function meetingKey(title: string): string {
  return norm(title).replace(/[^a-z0-9 ]/g, "");
}
