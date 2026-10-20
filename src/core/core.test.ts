import { describe, expect, it } from "vitest";
import { parseCapture } from "./capture";
import { parseTime } from "./dates";
import { MemoryFs } from "./fs";
import { Hold } from "./hold";
import { appendToSection, parseFile, setTaskChar } from "./parse";
import { occursOn, parseRemind } from "./schedule";

const LOG = `---
date: 2026-10-19
---
# Monday

## Tasks
- [x] Ship invoice #admin
- [ ] Review PR @due(2026-10-21) #acme
- [ ] Call dentist @remind(2pm)
  - [ ] nested subtask
- [>] old migrated thing
- [ ]

## Hours
- 2.5h @acme API refactor
- 45m @Globex: weekly sync
- 1h30m @acme pairing
- 3h not a client line

\`\`\`
- [ ] task inside code fence
\`\`\`

See [[Project Alpha]] and [[notes/Ideas|ideas]].
`;

describe("parseTime", () => {
  it.each([
    ["3pm", "15:00"],
    ["3:30 pm", "15:30"],
    ["12am", "00:00"],
    ["12pm", "12:00"],
    ["9", "09:00"],
    ["21:05", "21:05"],
    ["25:00", null],
    ["13pm", null],
  ])("%s → %s", (input, out) => expect(parseTime(input)).toBe(out));
});

describe("parseFile", () => {
  const f = parseFile("logs/2026/2026-10-19.md", LOG);

  it("reads kind, date and title", () => {
    expect(f.kind).toBe("log");
    expect(f.date).toBe("2026-10-19");
    expect(f.title).toBe("Monday");
  });

  it("parses tasks with status, due, tags and indent; skips empty and fenced", () => {
    expect(f.tasks.map((t) => [t.text, t.status])).toEqual([
      ["Ship invoice #admin", "done"],
      ["Review PR #acme", "open"],
      ["Call dentist", "open"],
      ["nested subtask", "open"],
      ["old migrated thing", "migrated"],
    ]);
    expect(f.tasks[1].due).toBe("2026-10-21");
    expect(f.tasks[1].tags).toEqual(["acme"]);
    expect(f.tasks[3].indent).toBe(2);
    expect(f.tasks[0].line).toBe(6);
  });

  it("attaches time-only reminders to the file's date", () => {
    expect(f.reminders).toHaveLength(1);
    expect(f.reminders[0].rule).toEqual({ kind: "once", date: "2026-10-19", time: "14:00" });
  });

  it("parses hours in h, m and h+m; lowercases clients", () => {
    expect(f.hours.map((h) => [h.hours, h.client, h.description])).toEqual([
      [2.5, "acme", "API refactor"],
      [0.75, "globex", "weekly sync"],
      [1.5, "acme", "pairing"],
    ]);
  });

  it("collects links and tags", () => {
    expect(f.links).toEqual(["Project Alpha", "notes/Ideas"]);
    expect(f.tags.sort()).toEqual(["acme", "admin"]);
  });

  it("reads reminders.md bullets as recurring", () => {
    const r = parseFile("reminders.md", "# Reminders\n- Vitamins @remind(daily 8am)\n- Standup @remind(9:00)\n");
    expect(r.reminders.map((x) => x.rule)).toEqual([
      { kind: "days", days: [0, 1, 2, 3, 4, 5, 6], time: "08:00" },
      { kind: "days", days: [0, 1, 2, 3, 4, 5, 6], time: "09:00" },
    ]);
  });

  it("ignores tokens inside inline code", () => {
    const f2 = parseFile(
      "notes/help.md",
      "- Example: `- [ ] Call dentist @remind(14:00)` and `- 2h @acme x` and `[[Nope]]` `#nottag`\n- [ ] real `@due(2026-01-01)` @due(2026-02-02)\n",
    );
    expect(f2.reminders).toEqual([]);
    expect(f2.hours).toEqual([]);
    expect(f2.links).toEqual([]);
    expect(f2.tags).toEqual([]);
    expect(f2.tasks[0].due).toBe("2026-02-02");
  });

  it("survives CRLF and broken frontmatter", () => {
    const f2 = parseFile("notes/x.md", "---\r\ntitle: [oops\r\n---\r\n- [ ] a task\r\n");
    expect(f2.tasks[0].line).toBe(3);
    expect(f2.title).toBe("x");
  });
});

describe("parseRemind / occursOn", () => {
  it("handles each form", () => {
    expect(parseRemind("weekdays 17:30")).toEqual({ kind: "days", days: [1, 2, 3, 4, 5], time: "17:30" });
    expect(parseRemind("mon,thu 9am")).toEqual({ kind: "days", days: [1, 4], time: "09:00" });
    expect(parseRemind("monday, thursday 9am")).toEqual({ kind: "days", days: [1, 4], time: "09:00" });
    expect(parseRemind("2026-12-24 6:30 pm")).toEqual({ kind: "once", date: "2026-12-24", time: "18:30" });
    expect(parseRemind("monthly 31 09:00")).toEqual({ kind: "monthly", day: 31, time: "09:00" });
    expect(parseRemind("someday")).toBeNull();
  });
  it("monthly 31 falls on the last day of short months", () => {
    const r = parseRemind("monthly 31 09:00")!;
    expect(occursOn(r, "2026-02-28")).toBe(true);
    expect(occursOn(r, "2026-03-30")).toBe(false);
    expect(occursOn(r, "2026-03-31")).toBe(true);
  });
  it("weekdays skip weekends", () => {
    const r = parseRemind("weekdays 9:00")!;
    expect(occursOn(r, "2026-10-17")).toBe(false); // Saturday
    expect(occursOn(r, "2026-10-19")).toBe(true); // Monday
  });
});

describe("appendToSection", () => {
  it("appends after the last item in a section", () => {
    const out = appendToSection("# T\n\n## Tasks\n- [ ] a\n\n## Log\n- x\n", "Tasks", "- [ ] b");
    expect(out).toBe("# T\n\n## Tasks\n- [ ] a\n- [ ] b\n\n## Log\n- x\n");
  });
  it("fills an empty section and keeps a blank line before the next heading", () => {
    const out = appendToSection("## Tasks\n## Hours\n", "tasks", "- [ ] a");
    expect(out).toBe("## Tasks\n- [ ] a\n\n## Hours\n");
  });
  it("adds a missing section", () => {
    expect(appendToSection("# T\n", "Hours", "- 1h @a x")).toBe("# T\n\n## Hours\n- 1h @a x\n");
  });
  it("appends at the end of the last section", () => {
    expect(appendToSection("## Log\n- a\n", "Log", "- b")).toBe("## Log\n- a\n- b\n");
  });
  it("preserves CRLF", () => {
    expect(appendToSection("## Log\r\n- a\r\n", "Log", "- b")).toBe("## Log\r\n- a\r\n- b\r\n");
  });
});

describe("setTaskChar", () => {
  it("only touches the checkbox", () => {
    expect(setTaskChar("  - [ ] do [ ] thing", "done")).toBe("  - [x] do [ ] thing");
    expect(setTaskChar("- [x] done", "open")).toBe("- [ ] done");
  });
});

describe("parseCapture", () => {
  const now = new Date(2026, 9, 19, 10, 5); // Mon 2026-10-19 10:05
  it.each([
    ["2h @acme fixed login", "Hours", "- 2h @acme fixed login"],
    ["45m @acme standup", "Hours", "- 45m @acme standup"],
    ["todo buy ink", "Tasks", "- [ ] buy ink"],
    ["[] buy ink", "Tasks", "- [ ] buy ink"],
    ["remind me 3pm call the bank", "Tasks", "- [ ] call the bank @remind(15:00)"],
    ["remind me to call the bank at 3:30pm", "Tasks", "- [ ] call the bank @remind(15:30)"],
    ["remind me tomorrow 9am send report", "Tasks", "- [ ] send report @remind(2026-10-20 09:00)"],
    ["remind me on friday at 17:00 to submit hours", "Tasks", "- [ ] submit hours @remind(2026-10-23 17:00)"],
    ["remind me to stretch", "Tasks", "- [ ] stretch"],
    ["Sam says the migration slips a week", "Log", "- 10:05 Sam says the migration slips a week"],
  ])("%s", (input, heading, line) => {
    expect(parseCapture(input, now)).toMatchObject({ heading, line });
  });
});

describe("Hold", () => {
  async function makeHold(files: Record<string, string> = {}) {
    const hold = new Hold(new MemoryFs(files));
    await hold.init();
    return hold;
  }

  it("seeds a fresh hold", async () => {
    const hold = await makeHold();
    expect(hold.get("reminders.md")).toBeDefined();
    expect(hold.get("templates/log.md")).toBeDefined();
    expect(hold.get("notes/Welcome to Keel.md")).toBeDefined();
  });

  it("creating today's log migrates open top-level tasks from the last log", async () => {
    const hold = await makeHold({
      "logs/2026/2026-10-16.md": "---\ndate: 2026-10-16\n---\n## Tasks\n- [ ] carry me\n  - [ ] child stays\n- [x] done stays\n",
    });
    const path = await hold.ensureLog("2026-10-19", "2026-10-19");
    expect(path).toBe("logs/2026/2026-10-19.md");
    const today = hold.get(path)!;
    expect(today.tasks.map((t) => t.text)).toEqual(["carry me"]);
    const old = hold.get("logs/2026/2026-10-16.md")!;
    expect(old.tasks.map((t) => t.status)).toEqual(["migrated", "open", "done"]);
    // a second call is a no-op
    await hold.ensureLog("2026-10-19", "2026-10-19");
    expect(hold.get(path)!.tasks).toHaveLength(1);
  });

  it("concurrent ensureLog calls migrate once", async () => {
    const hold = await makeHold({
      "logs/2026/2026-10-16.md": "---\ndate: 2026-10-16\n---\n## Tasks\n- [ ] carry me\n",
    });
    await Promise.all([hold.ensureLog("2026-10-19", "2026-10-19"), hold.ensureLog("2026-10-19", "2026-10-19")]);
    expect(hold.get("logs/2026/2026-10-19.md")!.tasks.map((t) => t.text)).toEqual(["carry me"]);
  });

  it("builds an agenda", async () => {
    const hold = await makeHold({ "logs/2026/2026-10-19.md": LOG, "notes/todo.md": "- [ ] overdue @due(2026-10-01)\n- [ ] someday\n" });
    const a = hold.agenda("2026-10-19");
    expect(a.overdue.map((t) => t.text)).toEqual(["overdue"]);
    expect(a.today.map((t) => t.text)).toEqual(["Call dentist", "nested subtask"]);
    expect(a.upcoming.map((t) => t.text)).toEqual(["Review PR #acme"]);
    expect(a.open.map((t) => t.text)).toEqual(["someday"]);
    expect(a.reminders.map((r) => r.text)).toContain("Call dentist");
    expect(a.reminders.map((r) => r.text)).toContain("Plan tomorrow");
  });

  it("toggles a task on disk", async () => {
    const hold = await makeHold({ "notes/a.md": "# A\n- [ ] one\n" });
    await hold.setTaskStatus(hold.get("notes/a.md")!.tasks[0], "done");
    expect(await hold.fs.read("notes/a.md")).toBe("# A\n- [x] one\n");
  });

  it("totals a timesheet with client rates", async () => {
    const hold = await makeHold({
      "logs/2026/2026-10-19.md": LOG,
      "clients/acme.md": "---\nname: Acme Corp\nrate: 100\n---\n# Acme\n",
    });
    const ts = hold.timesheet("2026-10-01", "2026-10-31");
    expect(ts.totalHours).toBe(4.75);
    expect(ts.byClient.map((c) => [c.client.name, c.hours, c.amount])).toEqual([
      ["Acme Corp", 4, 400],
      ["globex", 0.75, 0],
    ]);
    expect(hold.timesheetCsv(ts).split("\r\n")[1]).toBe("2026-10-19,acme,2.5,100,250,API refactor,logs/2026/2026-10-19.md");
  });

  it("resolves links and backlinks", async () => {
    const hold = await makeHold({ "notes/Project Alpha.md": "# Alpha\n", "logs/2026/2026-10-19.md": LOG });
    expect(hold.resolveLink("project alpha")).toBe("notes/Project Alpha.md");
    expect(hold.backlinks("notes/Project Alpha.md").map((f) => f.path)).toEqual(["logs/2026/2026-10-19.md"]);
  });

  it("creates meetings with unique names", async () => {
    const hold = await makeHold();
    const a = await hold.createMeeting("Acme: kickoff?", "2026-10-19");
    const b = await hold.createMeeting("Acme: kickoff?", "2026-10-19");
    expect(a).toBe("meetings/2026-10-19 Acme kickoff.md");
    expect(b).toBe("meetings/2026-10-19 Acme kickoff 2.md");
    expect(hold.get(a)!.date).toBe("2026-10-19");
  });

  it("searches text and tags", async () => {
    const hold = await makeHold({ "logs/2026/2026-10-19.md": LOG });
    expect(hold.search("dentist").map((h) => h.line)).toEqual([8]);
    expect(hold.search("#admin").map((h) => h.path)).toEqual(["logs/2026/2026-10-19.md"]);
  });
});
