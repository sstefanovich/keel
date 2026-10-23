import { describe, expect, it } from "vitest";
import { PREVIOUS_GUIDES, CLAUDE_GUIDE } from "./claudeGuide";
import { diffLines, diffStats } from "./diff";
import { MemoryFs } from "./fs";
import { Hold } from "./hold";
import { groupMeetings, quarterHours, workMeetings } from "./meetingHours";
import { HoursEntry, parseFile } from "./parse";
import { DEFAULT_TEMPLATES, OLD_TEMPLATES } from "./templates";
import { buildWeek, checkWeek } from "./week";

async function makeHold(files: Record<string, string> = {}) {
  const hold = new Hold(new MemoryFs({ "notes/seed.md": "# Seed\n", ...files }));
  await hold.init();
  return hold;
}

describe("action items", () => {
  it("a capitalised @Name on a task means waiting on that person", () => {
    const f = parseFile(
      "meetings/2026-10-23 Sync.md",
      [
        "---",
        "date: 2026-10-23",
        "---",
        "## Action items",
        "- [ ] Send the SOW @Jordan",
        "- [ ] Review firewall rules @Sam, by Friday",
        "- [ ] Update the plan @flis-retain-pa",
        "- [ ] Email jordan@acme.com",
        "- [ ] Explicit wins @waiting(Pat) @Jordan",
        "- [ ] ",
      ].join("\n"),
      0,
    );
    expect(f.tasks.map((t) => t.waiting)).toEqual(["Jordan", "Sam", undefined, undefined, "Pat"]);
  });

  it("new meetings start with an action-item checkbox; untouched old templates are upgraded", async () => {
    expect(DEFAULT_TEMPLATES["templates/meeting.md"]).toContain("## Action items\n- [ ] \n");
    const old = OLD_TEMPLATES["templates/meeting.md"][0];
    const hold = await makeHold({ "templates/meeting.md": old.replace(/\n/g, "\r\n"), "CLAUDE.md": PREVIOUS_GUIDES[0] });
    expect(await hold.fs.read("templates/meeting.md")).toBe(DEFAULT_TEMPLATES["templates/meeting.md"]);
    expect(await hold.fs.read("CLAUDE.md")).toBe(CLAUDE_GUIDE);
    const edited = await makeHold({ "templates/meeting.md": old + "## Decisions\n", "CLAUDE.md": "# my own guide\n" });
    expect(await edited.fs.read("templates/meeting.md")).toContain("## Decisions");
    expect(await edited.fs.read("CLAUDE.md")).toBe("# my own guide\n");
  });

  it("the previous guide differs from the current one only by the @Name note", () => {
    expect(PREVIOUS_GUIDES[0]).not.toBe(CLAUDE_GUIDE);
    expect(PREVIOUS_GUIDES[0]).not.toContain("capitalised");
    expect(PREVIOUS_GUIDES[0]).toContain("(keep any `@since(…)` tag).\n- Tag tasks");
  });
});

describe("meetings → hours", () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 23, h, m).getTime();
  const mtg = (id: string, title: string, start: number, end: number, extra: Partial<{ allDay: boolean; free: boolean }> = {}) => ({
    id,
    title,
    start,
    end,
    allDay: false,
    free: false,
    ...extra,
  });
  const block = (client: string, items: string[]): HoursEntry => ({ file: "x", line: 0, end: 0, date: "2026-10-23", hours: 1, client, description: "", items });

  it("rounds to quarter hours", () => {
    expect(quarterHours(50 * 60_000)).toBe(0.75);
    expect(quarterHours(5 * 60_000)).toBe(0.25);
    expect(quarterHours(90 * 60_000)).toBe(1.5);
  });

  it("groups by owner, skips logged, dismissed, free, all-day and future meetings", () => {
    const events = [
      mtg("a", "FLIS weekly sync", at(9), at(9, 30)),
      mtg("b", "FLIS design review", at(11), at(12)),
      mtg("c", "Lunch", at(12), at(13), { free: true }),
      mtg("d", "Offsite", at(0), at(23, 59), { allDay: true }),
      mtg("e", "VBS kickoff", at(14), at(15)),
      mtg("f", "Dentist", at(15), at(16)),
      mtg("g", "Already logged", at(8), at(8, 30)),
      mtg("h", "Later today", at(17), at(18)),
      mtg("i", "Hidden", at(7), at(7, 30)),
    ];
    const ready = workMeetings(events, at(16, 30));
    expect(ready.map((m) => m.id)).toEqual(["a", "b", "e", "f", "g", "i"]);
    const owner = (t: string) => (t.startsWith("FLIS") ? "flis-retain-pa" : t.startsWith("VBS") || t === "Already logged" ? "vbs" : undefined);
    const { groups, unassigned } = groupMeetings(ready, owner, [block("vbs", ["already logged"])], new Set(["i"]));
    expect(groups).toEqual([
      { key: "flis-retain-pa", meetings: [ready[0], ready[1]], hours: 1.5 },
      { key: "vbs", meetings: [ready[2]], hours: 1 },
    ]);
    expect(unassigned.map((m) => m.id)).toEqual(["f"]);
  });

  it("logs meetings as hours plus one item each", async () => {
    const hold = await makeHold();
    await hold.logMeetings("2026-10-23", "flis-retain-pa", ["Weekly sync", "Design review"], 1.5);
    await hold.logMeetings("2026-10-23", "flis-retain-pa", ["Ad-hoc call"]);
    const [b] = hold.get("logs/2026/2026-10-23.md")!.hours;
    expect(b.hours).toBe(1.5);
    expect(b.items).toEqual(["Weekly sync", "Design review", "Ad-hoc call"]);
  });
});

describe("week check", () => {
  const LOG = (work: string) => `# Log\n\n## Tasks\n\n## Work\n${work}\n\n## Log\n`;

  it("flags short working days, hours without items and items without hours", async () => {
    // Sat 2026-10-17 … Fri 2026-10-23
    const hold = await makeHold({
      "projects/FLIS.md": "---\nclient: hogan\n---\n# FLIS\n",
      "logs/2026/2026-10-19.md": LOG("- 8h @flis\n  - Design"), // Mon: fine
      "logs/2026/2026-10-20.md": LOG("- 6h @flis\n  - Review"), // Tue: short
      "logs/2026/2026-10-21.md": LOG("- 8h @flis"), // Wed: nothing listed
      "logs/2026/2026-10-22.md": LOG("- @flis\n  - Call"), // Thu: no hours (and short)
    });
    const week = buildWeek(hold, "2026-10-17");
    const target = { hours: 8, workdays: [1, 2, 3, 4, 5] };
    const mid = checkWeek(week, target, "2026-10-22");
    expect(mid.daysLeft).toBe(1);
    expect(mid.ready).toBe(false);
    expect(mid.issues.map((x) => `${x.kind}@${week.days[x.day]}`)).toEqual([
      "short@2026-10-20",
      "no-items@2026-10-21",
      "short@2026-10-22",
      "no-hours@2026-10-22",
    ]);
    // weekends aren't expected; a target of 0 turns the hours check off
    expect(checkWeek(week, { ...target, hours: 0 }, "2026-10-22").issues.every((x) => x.kind !== "short")).toBe(true);
  });

  it("is ready when every working day is complete and none are left", async () => {
    const full = Object.fromEntries(
      ["19", "20", "21", "22", "23"].map((d) => [`logs/2026/2026-10-${d}.md`, LOG("- 8h @flis\n  - Work")]),
    );
    const hold = await makeHold({ "projects/FLIS.md": "---\nclient: hogan\n---\n# FLIS\n", ...full });
    const week = buildWeek(hold, "2026-10-17");
    expect(checkWeek(week, { hours: 8, workdays: [1, 2, 3, 4, 5] }, "2026-10-23")).toEqual({ issues: [], daysLeft: 0, ready: true });
    expect(checkWeek(week, { hours: 8, workdays: [1, 2, 3, 4, 5] }, "2026-10-22").ready).toBe(false); // Friday still ahead
  });
});

describe("diff", () => {
  it("finds added and removed lines", () => {
    const d = diffLines("a\nb\nc\nd", "a\nc\nd\ne");
    expect(d).toEqual([
      { kind: "same", text: "a" },
      { kind: "del", text: "b" },
      { kind: "same", text: "c" },
      { kind: "same", text: "d" },
      { kind: "add", text: "e" },
    ]);
    expect(diffStats(d)).toEqual({ added: 1, removed: 1 });
    expect(diffStats(diffLines("x\r\ny", "x\ny"))).toEqual({ added: 0, removed: 0 });
  });
});
