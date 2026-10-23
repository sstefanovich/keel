import { describe, expect, it } from "vitest";
import { azureContext, azurePortalUrl } from "./azure";
import { parseCapture, parseDayPrefix } from "./capture";
import { buildReport, reportHtml, reportMarkdown } from "./report";
import { buildWeek, dayItems, rowReport, rowTsv, weekTsv } from "./week";
import { mentionAt } from "../ui/workTargets";
import { parseTime, startOfWeek, today } from "./dates";
import { MemoryFs } from "./fs";
import { Hold } from "./hold";
import { appendToSection, parseFile, replaceBody, setFrontmatterField, setTaskChar, yamlScalar } from "./parse";
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

describe("startOfWeek", () => {
  it("defaults to Monday", () => {
    expect(startOfWeek("2026-10-21")).toBe("2026-10-19"); // Wed → Mon
    expect(startOfWeek("2026-10-25")).toBe("2026-10-19"); // Sun → previous Mon
  });
  it("supports Saturday–Friday weeks", () => {
    expect(startOfWeek("2026-10-21", 6)).toBe("2026-10-17"); // Wed → Sat
    expect(startOfWeek("2026-10-17", 6)).toBe("2026-10-17"); // Sat is the first day
    expect(startOfWeek("2026-10-23", 6)).toBe("2026-10-17"); // Fri is the last day
    expect(startOfWeek("2026-10-24", 6)).toBe("2026-10-24"); // next Sat starts a new week
    expect(startOfWeek("2026-11-01", 6)).toBe("2026-10-31"); // across a month boundary
  });
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

describe("charts", () => {
  const CLIENT = `---
name: Acme Corp
rate: 150
---
# Acme

Intro paragraph with no bullets.
- General item

## Links
- Prod portal: https://portal.acme.com/app
- [Runbook](https://wiki.acme.com/runbook)
- https://bare.acme.com
- [ ] a task, not a chart item
- 2h @acme not a chart item either

## Azure
- Resource group: \`rg-acme-prod-eus\`
- Subscription: Acme Prod (1234-abcd)
  - nested: kept with indent
`;
  const f = parseFile("clients/acme.md", CLIENT);

  it("parses label/value, markdown links and bare values per section", () => {
    expect(f.chart.map((c) => [c.section, c.label, c.value, c.url])).toEqual([
      ["", undefined, "General item", undefined],
      ["Links", "Prod portal", "https://portal.acme.com/app", "https://portal.acme.com/app"],
      ["Links", "Runbook", "https://wiki.acme.com/runbook", "https://wiki.acme.com/runbook"],
      ["Links", undefined, "https://bare.acme.com", "https://bare.acme.com"],
      ["Azure", "Resource group", "rg-acme-prod-eus", undefined],
      ["Azure", "Subscription", "Acme Prod (1234-abcd)", undefined],
      ["Azure", "nested", "kept with indent", undefined],
    ]);
    expect(f.chart[6].indent).toBe(2);
    expect(f.tasks).toHaveLength(1);
  });

  it("only clients and projects get charts", () => {
    expect(parseFile("notes/x.md", "## Links\n- a: b\n").chart).toEqual([]);
    expect(parseFile("projects/portal.md", "---\nclient: acme\n---\n## Repos\n- api: https://github.com/acme/api\n").chart).toHaveLength(1);
  });
});

describe("snippets", () => {
  it("collects fenced blocks on charts with the line above as title", () => {
    const f = parseFile(
      "clients/acme.md",
      "# Acme\n## CLI\nLog in to the tenant:\n```bash\naz login --tenant acme.onmicrosoft.com\n```\n\n```\nno title\n```\n## Diagram\n```mermaid\ngraph TD; A-->B\n```\n",
    );
    expect(f.snippets.map((s) => [s.section, s.lang, s.title, s.code])).toEqual([
      ["CLI", "bash", "Log in to the tenant", "az login --tenant acme.onmicrosoft.com"],
      ["CLI", "", undefined, "no title"],
      ["Diagram", "mermaid", undefined, "graph TD; A-->B"],
    ]);
    expect(f.chart).toEqual([]);
    expect(parseFile("notes/x.md", "```bash\nls\n```\n").snippets).toEqual([]);
  });
});

describe("azure links", () => {
  const f = parseFile(
    "clients/acme.md",
    `# Acme
## Azure
- Tenant: acme.onmicrosoft.com
- Subscription: Prod (11111111-2222-3333-4444-555555555555)
- Resource group: \`rg-acme-prod\`
- Subscription: Dev (aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee)
- Resource group: rg-acme-dev
- Key vault: /subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-acme-prod/providers/Microsoft.KeyVault/vaults/kv-acme
- Server: vm-01
`,
  );
  const url = (value: string) => {
    const item = f.chart.find((i) => i.value.startsWith(value))!;
    return azurePortalUrl(item, azureContext(f.chart, item.line));
  };
  it("links resource groups using the nearest subscription above", () => {
    expect(url("rg-acme-prod")).toBe(
      "https://portal.azure.com/#@acme.onmicrosoft.com/resource/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-acme-prod/overview",
    );
    expect(url("rg-acme-dev")).toContain("/subscriptions/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/resourceGroups/rg-acme-dev/");
  });
  it("links full resource IDs and ignores everything else", () => {
    expect(url("/subscriptions/")).toBe(
      "https://portal.azure.com/#@acme.onmicrosoft.com/resource/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-acme-prod/providers/Microsoft.KeyVault/vaults/kv-acme",
    );
    expect(url("vm-01")).toBeUndefined();
  });
  it("falls back to the parent client's subscription", () => {
    const p = parseFile("projects/x.md", "## Azure\n- Resource group: rg-x\n");
    expect(azurePortalUrl(p.chart[0], azureContext(p.chart, p.chart[0].line, f.chart))).toContain("11111111-2222-3333-4444-555555555555/resourceGroups/rg-x");
  });
});

describe("frontmatter editing", () => {
  it("sets, replaces and removes keys without touching the body", () => {
    const c = "---\ncolor: yellow\ncreated: 2026-10-20\n---\nCall Sam\n";
    expect(setFrontmatterField(c, "color", "blue")).toBe("---\ncolor: blue\ncreated: 2026-10-20\n---\nCall Sam\n");
    const lowered = setFrontmatterField(c, "lowered", "2026-10-21");
    expect(lowered).toBe("---\ncolor: yellow\ncreated: 2026-10-20\nlowered: 2026-10-21\n---\nCall Sam\n");
    expect(setFrontmatterField(lowered, "lowered", undefined)).toBe(c);
    expect(setFrontmatterField("Body\n", "color", "pink")).toBe("---\ncolor: pink\n---\nBody\n");
  });
  it("quotes values YAML would misread", () => {
    expect(yamlScalar("Acme Corp")).toBe("Acme Corp");
    expect(yamlScalar("Acme: EU")).toBe('"Acme: EU"');
    expect(yamlScalar("#1 client")).toBe('"#1 client"');
    expect(yamlScalar("yes")).toBe('"yes"');
    expect(yamlScalar("2026")).toBe('"2026"');
    expect(yamlScalar(150)).toBe("150");
    const round = parseFile("clients/a.md", setFrontmatterField("---\nname: x\n---\n", "name", yamlScalar('Say "hi": now')));
    expect(round.frontmatter.name).toBe('Say "hi": now');
  });

  it("replaces the body only", () => {
    expect(replaceBody("---\na: 1\n---\nold\n", "new\nlines")).toBe("---\na: 1\n---\nnew\nlines\n");
    expect(replaceBody("no fm\n", "x")).toBe("x\n");
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
    ["todo buy ink", "Tasks", "- [ ] buy ink"],
    ["[] buy ink", "Tasks", "- [ ] buy ink"],
    ["remind me 3pm call the bank", "Tasks", "- [ ] call the bank @remind(15:00)"],
    ["remind me to call the bank at 3:30pm", "Tasks", "- [ ] call the bank @remind(15:30)"],
    ["remind me tomorrow 9am send report", "Tasks", "- [ ] send report @remind(2026-10-20 09:00)"],
    ["remind me on friday at 17:00 to submit hours", "Tasks", "- [ ] submit hours @remind(2026-10-23 17:00)"],
    ["remind me to stretch", "Tasks", "- [ ] stretch"],
    ["Sam says the migration slips a week", "Log", "- 10:05 Sam says the migration slips a week"],
    ["flag renew TLS cert", "", "renew TLS cert"],
    ["! call Sam", "", "call Sam"],
    ["flagship release notes", "Log", "- 10:05 flagship release notes"],
    ["wait Jordan: firewall rules", "Tasks", "- [ ] firewall rules @waiting(Jordan)"],
    ["waiting on Priya Shah: signed SOW", "Tasks", "- [ ] signed SOW @waiting(Priya Shah)"],
  ])("%s", (input, heading, line) => {
    expect(parseCapture(input, now)).toMatchObject({ heading, line });
  });
});

describe("parseCapture work entries", () => {
  const now = new Date(2026, 9, 19, 10, 5);
  it.each([
    ["6h @portal", undefined, { key: "portal", hours: 6, item: undefined }],
    ["2h @acme fixed login", undefined, { key: "acme", hours: 2, item: "fixed login" }],
    ["1h30m @Acme/Portal pairing", undefined, { key: "acme/portal", hours: 1.5, item: "pairing" }],
    ["45m @acme standup", undefined, { key: "acme", hours: 0.75, item: "standup" }],
    ["6 hours @portal", undefined, { key: "portal", hours: 6, item: undefined }],
    ["2.5 hrs @portal design review", undefined, { key: "portal", hours: 2.5, item: "design review" }],
    ["Work .25 Hours @flis-retain-pa", undefined, { key: "flis-retain-pa", hours: 0.25, item: undefined }],
    ["worked 3h on @portal API spec", undefined, { key: "portal", hours: 3, item: "API spec" }],
    ["@portal reviewed the auth PR", undefined, { key: "portal", hours: undefined, item: "reviewed the auth PR" }],
    ["2h fixed login", "acme", { key: "acme", hours: 2, item: "fixed login" }],
    ["2h @globex other client", "acme", { key: "globex", hours: 2, item: "other client" }],
  ])("%s", (input, focus, work) => {
    expect(parseCapture(input, now, focus)?.work).toEqual(work);
  });
  it("leaves a bare @mention and plain durations alone", () => {
    expect(parseCapture("@jordan", now)?.kind).toBe("log");
    expect(parseCapture("2h meeting with no project", now)?.kind).toBe("log");
  });
});

describe("parseCapture: kinds, overrides, days and notes", () => {
  const now = new Date(2026, 9, 21, 10, 5); // Wed 2026-10-21 10:05

  it("detects ask and note targets", () => {
    expect(parseCapture("? what did I do on FLIS this week", now)).toMatchObject({ kind: "ask", ask: "what did I do on FLIS this week" });
    expect(parseCapture("> Retention design: decided on 7-year hold", now)).toMatchObject({
      kind: "note",
      note: "Retention design",
      line: "- decided on 7-year hold",
    });
    expect(parseCapture("> no colon here", now)).toMatchObject({ kind: "note", error: expect.any(String) });
  });

  it("targets other days", () => {
    expect(parseDayPrefix("yesterday 6h @flis", "2026-10-21")).toEqual({ date: "2026-10-20", rest: "6h @flis" });
    expect(parseDayPrefix("fri: @vbs timeline", "2026-10-21").date).toBe("2026-10-16"); // last Friday
    expect(parseDayPrefix("wed: x", "2026-10-21").date).toBeUndefined(); // today
    expect(parseDayPrefix("2026-10-19: x", "2026-10-21").date).toBe("2026-10-19");
    expect(parseDayPrefix("Monday's deploy failed", "2026-10-21").date).toBeUndefined(); // needs a colon
    expect(parseCapture("yesterday 6h @flis-retain-pa", now)).toMatchObject({ kind: "work", date: "2026-10-20", work: { key: "flis-retain-pa", hours: 6 } });
    expect(parseCapture("fri: todo send recap", now)).toMatchObject({ kind: "task", date: "2026-10-16", line: "- [ ] send recap" });
    // past-day log lines carry no clock time
    expect(parseCapture("yesterday shipped the release", now)).toMatchObject({ kind: "log", date: "2026-10-20", line: "- shipped the release" });
    // a day prefix on a reminder sets its date
    expect(parseCapture("fri: remind me 3pm file hours", now)?.line).toBe("- [ ] file hours @remind(2026-10-16 15:00)");
  });

  it("lets Tab force a kind, with an error when the text doesn't fit", () => {
    expect(parseCapture("buy printer ink", now, undefined, "task")).toMatchObject({ kind: "task", auto: "log", line: "- [ ] buy printer ink" });
    expect(parseCapture("buy printer ink", now, undefined, "flag")).toMatchObject({ kind: "flag", line: "buy printer ink" });
    expect(parseCapture("todo buy ink", now, undefined, "flag")).toMatchObject({ line: "todo buy ink" });
    expect(parseCapture("firewall rules", now, undefined, "waiting")).toMatchObject({ line: "- [ ] firewall rules @waiting" });
    expect(parseCapture("Jordan: firewall rules", now, undefined, "waiting")).toMatchObject({ line: "- [ ] firewall rules @waiting(Jordan)" });
    expect(parseCapture("buy ink", now, undefined, "work")?.error).toBeTruthy();
    expect(parseCapture("buy ink", now, "acme", "work")).toMatchObject({ work: { key: "acme", item: "buy ink" } });
    expect(parseCapture("call the bank", now, undefined, "reminder")?.error).toBeTruthy();
    expect(parseCapture("call the bank 3pm", now, undefined, "reminder")?.line).toBe("- [ ] call the bank @remind(15:00)");
    expect(parseCapture("Retention design: 7 years", now, undefined, "note")).toMatchObject({ note: "Retention design", line: "- 7 years" });
    expect(parseCapture("how many hours this week", now, undefined, "ask")).toMatchObject({ ask: "how many hours this week" });
  });
});

describe("@ suggestions for quick capture", () => {
  const targets = [
    { key: "flis-retain-pa", project: "flis-retain-pa", client: "hogan-lovells", detail: "FLIS Retain / PA · Hogan Lovells" },
    { key: "mdi-retainer-fy27-pa", project: "mdi-retainer-fy27-pa", client: "alex-lee", detail: "MDI Retainer FY27 / PA · Alex Lee" },
    { key: "vbs-2026-2027-pa", project: "vbs-2026-2027-pa", client: "alex-lee", detail: "VBS 2026-2027 / PA · Alex Lee" },
    { key: "alex-lee", client: "alex-lee", detail: "Alex Lee (client)" },
    { key: "hogan-lovells", client: "hogan-lovells", detail: "Hogan Lovells (client)" },
  ];
  const at = (text: string, caret = text.length) => mentionAt(text, caret, targets);

  it("only triggers on an @ word at the caret", () => {
    expect(at("6h flis")).toBeNull();
    expect(at("email me@acme")).toBeNull(); // not after a space
    expect(at("6h @")!.options.map((o) => o.insert)).toHaveLength(5);
  });
  it("matches key prefixes first, then names", () => {
    expect(at("6h @al")!.options.map((o) => o.insert)).toEqual(["@alex-lee", "@mdi-retainer-fy27-pa", "@vbs-2026-2027-pa"]);
    expect(at("@hogan")!.options[0].insert).toBe("@hogan-lovells");
    expect(at("@retain")!.options.map((o) => o.insert)).toEqual(["@flis-retain-pa", "@mdi-retainer-fy27-pa"]);
  });
  it("narrows @client/ to that client's projects and reports the span to replace", () => {
    const r = at("yesterday 2h @alex-lee/v did stuff", "yesterday 2h @alex-lee/v".length)!;
    expect(r.options.map((o) => o.insert)).toEqual(["@alex-lee/vbs-2026-2027-pa"]);
    expect([r.from, r.to]).toEqual(["yesterday 2h ".length, "yesterday 2h @alex-lee/v".length]);
    // caret in the middle of a word replaces the whole word
    const mid = at("@flis-ret did", 4)!;
    expect([mid.from, mid.to]).toEqual([0, "@flis-ret".length]);
  });
});

describe("parseCapture with a focused client", () => {
  const now = new Date(2026, 9, 19, 10, 5);
  it.each([
    ["todo review PR", "- [ ] review PR #acme"],
    ["todo review PR #acme/portal", "- [ ] review PR #acme/portal"],
    ["wait Jordan: rules", "- [ ] rules #acme @waiting(Jordan)"],
    ["a thought", "- 10:05 a thought"],
  ])("%s", (input, line) => expect(parseCapture(input, now, "acme")?.line).toBe(line));
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
    // CLAUDE.md is seeded but its examples aren't tasks, hours or notes
    expect(hold.get("CLAUDE.md")?.kind).toBe("template");
    expect(hold.tasks().some((t) => t.file === "CLAUDE.md")).toBe(false);
    expect(hold.search("retention policy")).toEqual([]);
  });

  it("adds CLAUDE.md to an existing hold but never overwrites the user's copy", async () => {
    const hold = await makeHold({ "notes/x.md": "# x\n", "CLAUDE.md": "# my own rules\n" });
    expect(await hold.fs.read("CLAUDE.md")).toBe("# my own rules\n");
    const hold2 = await makeHold({ "notes/x.md": "# x\n" });
    expect(await hold2.fs.read("CLAUDE.md")).toContain("# Keel hold: guide for Claude");
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

  it("carries tasks into today's log even if it was created early by browsing ahead", async () => {
    const hold = await makeHold({
      "logs/2026/2026-10-20.md": "---\ndate: 2026-10-20\n---\n## Tasks\n- [ ] finish deck\n",
    });
    await hold.ensureLog("2026-10-21", "2026-10-20"); // browsing to tomorrow: created, nothing carried
    expect(hold.get("logs/2026/2026-10-21.md")!.tasks).toEqual([]);
    expect(hold.get("logs/2026/2026-10-20.md")!.tasks[0].status).toBe("open");
    await hold.ensureLog("2026-10-21", "2026-10-21"); // the next morning
    expect(hold.get("logs/2026/2026-10-21.md")!.tasks.map((t) => t.text)).toEqual(["finish deck"]);
    expect(hold.get("logs/2026/2026-10-20.md")!.tasks[0].status).toBe("migrated");
    await hold.ensureLog("2026-10-21", "2026-10-21"); // opening again moves nothing twice
    expect(hold.get("logs/2026/2026-10-21.md")!.tasks).toHaveLength(1);
  });

  it("doesn't reindex while its own save is in flight", async () => {
    const hold = await makeHold({ "notes/a.md": "# A\n" });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fs = hold.fs as MemoryFs;
    const write = fs.write.bind(fs);
    fs.write = async (p, c) => {
      await write(p, c);
      await gate; // file is on disk, index not updated yet
    };
    const saving = hold.save("notes/a.md", "# A\nmore\n");
    expect(await hold.reindex()).toBe(false);
    release();
    await saving;
    expect(hold.get("notes/a.md")!.content).toBe("# A\nmore\n");
    expect(await hold.reindex()).toBe(false); // index already matches disk
  });

  it("appends captures to a note by name, creating it if needed", async () => {
    const hold = await makeHold({ "notes/Retention design.md": "# Retention design\n\nSome text.\n\n\n" });
    await hold.appendToNote("retention design", "- decided on 7-year hold");
    expect(await hold.fs.read("notes/Retention design.md")).toBe("# Retention design\n\nSome text.\n- decided on 7-year hold\n");
    const p = await hold.appendToNote("Brand new idea", "- first thought");
    expect(p).toBe("notes/Brand new idea.md");
    expect(hold.get(p)!.content.trimEnd().endsWith("- first thought")).toBe(true);
  });

  it("discards a reindex that a save overlapped (no older text back in the index)", async () => {
    const hold = await makeHold({ "notes/a.md": "# A\nv1\n" });
    const fs = hold.fs as MemoryFs;
    // an outside edit makes the next reindex re-read a.md…
    await fs.write("notes/a.md", "# A\nv2\n");
    // …but the editor saves v3 right after that reindex has read v2 from disk
    const read = fs.read.bind(fs);
    let saving: Promise<void> | undefined;
    fs.read = async (p) => {
      const c = await read(p);
      fs.read = read;
      saving = hold.save("notes/a.md", "# A\nv3\n");
      return c;
    };
    expect(await hold.reindex()).toBe(false); // overlapped a save: results thrown away
    await saving;
    expect(hold.get("notes/a.md")!.content).toBe("# A\nv3\n"); // not rolled back to v2
    expect(await hold.reindex()).toBe(false); // and the index already matches disk
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
    expect(await hold.fs.read("notes/a.md")).toBe(`# A\n- [x] one @done(${today()})\n`);
    expect(hold.get("notes/a.md")!.tasks[0].doneOn).toBe(today());
    await hold.setTaskStatus(hold.get("notes/a.md")!.tasks[0], "open");
    expect(await hold.fs.read("notes/a.md")).toBe("# A\n- [ ] one\n");
  });

  it("totals a timesheet by client, hours only", async () => {
    const hold = await makeHold({
      "logs/2026/2026-10-19.md": LOG,
      "clients/acme.md": "---\nname: Acme Corp\n---\n# Acme\n",
    });
    const ts = hold.timesheet("2026-10-01", "2026-10-31");
    expect(ts.totalHours).toBe(4.75);
    expect(ts.byClient.map((c) => [c.client.name, c.hours])).toEqual([
      ["Acme Corp", 4],
      ["globex", 0.75],
    ]);
    const csv = hold.timesheetCsv(ts).split("\r\n");
    expect(csv[0]).toBe("date,client,project,hours,work done,file");
    expect(csv[1]).toBe("2026-10-19,acme,,2.5,API refactor,logs/2026/2026-10-19.md");
  });

  it("rolls project hours up to their client", async () => {
    const hold = await makeHold({
      "clients/acme.md": "---\nname: Acme\n---\n# Acme\n",
      "projects/Portal rebuild.md": "---\nclient: acme\n---\n# Portal rebuild\n",
      "logs/2026/2026-10-19.md": "---\ndate: 2026-10-19\n---\n- 2h @acme/portal-rebuild api\n- 1h @portal-rebuild review\n- 1h @acme admin\n- 3h @globex other\n",
    });
    const ts = hold.timesheet("2026-10-19", "2026-10-19", "acme");
    expect(ts.totalHours).toBe(4);
    expect(ts.byClient[0].hours).toBe(4);
    expect(ts.byClient[0].byProject).toEqual([
      { key: "portal-rebuild", name: "Portal rebuild", hours: 3 },
      { key: "", name: "", hours: 1 },
    ]);
  });

  it("attributes tasks to clients by file or tag, and lists waiting items", async () => {
    const hold = await makeHold({
      "clients/acme.md": "# Acme\n- [ ] in client file\n",
      "projects/Portal.md": "---\nclient: acme\n---\n- [ ] Jordan: firewall rules @waiting\n",
      "meetings/2026-10-19 Sync.md": "---\nclient: globex\ndate: 2026-10-19\n---\n- [ ] send deck @waiting(Priya)\n",
      "logs/2026/2026-10-19.md": "---\ndate: 2026-10-19\n---\n- [ ] tagged #acme\n- [ ] project tag #portal\n- [ ] untagged\n",
    });
    const owner = (text: string) => hold.taskClient(hold.tasks().find((t) => t.text.startsWith(text))!);
    expect(owner("in client file")).toBe("acme");
    expect(owner("tagged")).toBe("acme");
    expect(owner("project tag")).toBe("acme");
    expect(owner("send deck")).toBe("globex");
    expect(owner("untagged")).toBeUndefined();
    expect(hold.waitingOn().map((t) => [t.waiting, t.text])).toEqual(
      expect.arrayContaining([["Jordan", "Jordan: firewall rules"], ["Priya", "send deck"]]),
    );
    expect(hold.waitingOn("acme").map((t) => t.waiting)).toEqual(["Jordan"]);
    // waiting items stay off the agenda; focus filters it
    const a = hold.agenda("2026-10-19", 14, "acme");
    expect([...a.today, ...a.open].map((t) => t.text).sort()).toEqual(["in client file", "project tag #portal", "tagged #acme"]);
  });

  it("builds a client status report", async () => {
    const hold = await makeHold({
      "clients/acme.md": "---\nname: Acme Corp\nrate: 100\n---\n# Acme\n",
      "projects/Portal.md": "---\nclient: acme\n---\n# Portal\n- [ ] API gateway design @due(2026-10-28)\n- [ ] Jordan: firewall rules @waiting @since(2026-10-14)\n",
      "meetings/2026-10-20 Design review.md": "---\nclient: acme\ndate: 2026-10-20\n---\n# Design review\n- [x] agree auth approach\n",
      "logs/2026/2026-10-19.md":
        "---\ndate: 2026-10-19\n---\n- [x] wrote ADR #acme @done(2026-10-19)\n- [ ] cost model #acme\n- [x] other client #globex\n- 3h @acme/portal design\n- 1h @acme admin\n",
      "logs/2026/2026-10-12.md": "---\ndate: 2026-10-12\n---\n- [x] last week #acme\n",
    });
    const r = buildReport(hold, "acme", "2026-10-19", "2026-10-25", "2026-10-25");
    expect(r.completed.map((t) => t.text)).toEqual(expect.arrayContaining(["agree auth approach", "wrote ADR #acme"]));
    expect(r.completed).toHaveLength(2);
    expect(r.meetings.map((m) => m.title)).toEqual(["Design review"]);
    expect(r.inProgress.map((t) => t.text)).toEqual(["cost model #acme"]);
    expect(r.upcoming.map((t) => t.text)).toEqual(["API gateway design"]);
    expect(r.waiting.map((t) => t.waiting)).toEqual(["Jordan"]);
    const md = reportMarkdown(r);
    expect(md).toContain("# Acme Corp: status update");
    expect(md).toContain("- Portal: 3h\n- General: 1h\n- **Total: 4h**");
    expect(md).toContain("- wrote ADR\n");
    expect(md).toContain("- **Jordan**: firewall rules (11 days)");
    expect(md).toContain("- Wed, Oct 28: API gateway design");
    expect(reportMarkdown(r, { includeHours: false })).not.toContain("## Time");
    // mid-week: waiting time counts to today, not to the end of the week
    expect(reportMarkdown(buildReport(hold, "acme", "2026-10-19", "2026-10-25", "2026-10-20"))).toContain("firewall rules (6 days)");
    expect(reportHtml(r)).toContain("<li><b>Jordan</b>: firewall rules (11 days)</li>");
  });

  it("parses work blocks: hours line plus indented done items", () => {
    const f = parseFile(
      "logs/2026/2026-10-21.md",
      `---
date: 2026-10-21
---
## Work
- 6h @portal-rebuild
  - Designed the API gateway
  - [x] Reviewed the auth PR
  - [ ] still to do, not counted

  - after a blank line, still in the block
- @contoso
  - Fixed SSO bug
- 1h @globex quick call
## Log
- 10:00 not part of any block
`,
    );
    expect(f.hours.map((h) => [h.client, h.hours, h.items])).toEqual([
      ["portal-rebuild", 6, ["Designed the API gateway", "Reviewed the auth PR", "after a blank line, still in the block"]],
      ["contoso", 0, ["Fixed SSO bug"]],
      ["globex", 1, ["quick call"]],
    ]);
    expect(f.hours[0].end).toBe(9);
    expect(f.tasks.map((t) => t.text)).toEqual(["Reviewed the auth PR", "still to do, not counted"]);
  });

  it("understands natural durations on work lines", () => {
    const f = parseFile(
      "logs/2026/2026-10-21.md",
      "---\ndate: 2026-10-21\n---\n- 6 hours @a\n- 1.5 hrs @b\n- 6h 30m @c\n- 90 min @d\n- 2 hr @e/proj\n- 1hour @f\n- 3 hours of meetings\n" +
        "- Work .25 Hours @flis-retain-pa\n- Worked 2h on @g\n- work: 1 hour @h\n- Work @i\n- worked on the deck\n",
    );
    expect(f.hours.map((h) => [h.client, h.hours])).toEqual([
      ["a", 6],
      ["b", 1.5],
      ["c", 6.5],
      ["d", 1.5],
      ["e/proj", 2],
      ["f", 1],
      ["flis-retain-pa", 0.25],
      ["g", 2],
      ["h", 1],
      ["i", 0],
    ]);
  });

  it("logs work into today's blocks: adds hours and items, creates blocks", async () => {
    const hold = await makeHold({
      "logs/2026/2026-10-21.md": "---\ndate: 2026-10-21\n---\n## Tasks\n\n## Work\n- 2h @portal\n  - morning item\n\n## Log\n",
    });
    await hold.logWork("2026-10-21", "portal", { hours: 3, item: "afternoon item" });
    await hold.logWork("2026-10-21", "@Contoso", { item: "fixed SSO" });
    await hold.logWork("2026-10-21", "contoso", { hours: 1.5 });
    expect(await hold.fs.read("logs/2026/2026-10-21.md")).toBe(
      "---\ndate: 2026-10-21\n---\n## Tasks\n\n## Work\n- 5h @portal\n  - morning item\n  - afternoon item\n- 1.5h @contoso\n  - fixed SSO\n\n## Log\n",
    );
    await hold.setWorkHours(hold.get("logs/2026/2026-10-21.md")!.hours[1], 0);
    expect(hold.get("logs/2026/2026-10-21.md")!.content).toContain("\n- @contoso\n  - fixed SSO\n");
  });

  it("writes into an older log's Hours section, or adds Work", async () => {
    const hold = await makeHold({
      "logs/2026/2026-10-19.md": "---\ndate: 2026-10-19\n---\n## Hours\n\n## Log\n",
      "logs/2026/2026-10-20.md": "---\ndate: 2026-10-20\n---\n# Tue\n",
    });
    await hold.logWork("2026-10-19", "acme", { hours: 1 });
    await hold.logWork("2026-10-20", "acme", { hours: 1 });
    expect(hold.get("logs/2026/2026-10-19.md")!.content).toContain("## Hours\n- 1h @acme\n");
    expect(hold.get("logs/2026/2026-10-20.md")!.content).toContain("## Work\n- 1h @acme\n");
  });

  it("builds a week grid with per-day items per project", async () => {
    const hold = await makeHold({
      "clients/contoso.md": "---\nname: Contoso\n---\n",
      "projects/Portal rebuild.md": "---\nclient: contoso\n---\n# Portal rebuild\n",
      "logs/2026/2026-10-19.md": "---\ndate: 2026-10-19\n---\n- 6h @portal-rebuild\n  - API gateway design\n- 2h @contoso\n  - Steering call\n",
      "logs/2026/2026-10-20.md":
        "---\ndate: 2026-10-20\n---\n- [x] Cost model #portal-rebuild @done(2026-10-20)\n- 7.5h @contoso/portal-rebuild\n  - Auth PR review\n- @globex\n  - unbilled item\n",
      "logs/2026/2026-10-26.md": "---\ndate: 2026-10-26\n---\n- 4h @portal-rebuild\n",
    });
    const w = buildWeek(hold, "2026-10-19");
    expect(w.rows.map((r) => [r.label, r.hours.slice(0, 2), r.total])).toEqual([
      ["Contoso", [2, 0], 2],
      ["Portal rebuild", [6, 7.5], 13.5],
      ["globex", [0, 0], 0],
    ]);
    const portal = w.rows[1];
    expect(portal.items[0]).toEqual(["API gateway design"]);
    expect(portal.items[1]).toEqual(["Auth PR review", "Cost model"]);
    expect(w.dayTotals.slice(0, 2)).toEqual([8, 7.5]);
    expect(w.total).toBe(15.5);
    expect(rowReport(w, portal)).toBe("Mon, Oct 19 (6h)\n- API gateway design\n\nTue, Oct 20 (7.5h)\n- Auth PR review\n- Cost model");
    expect(rowTsv(portal)).toBe("6\t7.5\t\t\t\t\t");
    expect(dayItems(portal, 1)).toBe("- Auth PR review\n- Cost model");
    expect(dayItems(portal, 1, "plain")).toBe("Auth PR review\nCost model");
    expect(rowReport(w, portal, "plain")).toBe("Mon, Oct 19 (6h)\nAPI gateway design\n\nTue, Oct 20 (7.5h)\nAuth PR review\nCost model");
    expect(weekTsv(w).split("\r\n")[2]).toBe("Portal rebuild (Contoso)\t6\t7.5\t\t\t\t\t\t13.5");
    expect(buildWeek(hold, "2026-10-19", "globex").rows.map((r) => r.label)).toEqual(["globex"]);
  });

  it("builds a Saturday–Friday week", async () => {
    const hold = await makeHold({
      "logs/2026/2026-10-17.md": "---\ndate: 2026-10-17\n---\n- 2h @acme\n", // Sat: in
      "logs/2026/2026-10-23.md": "---\ndate: 2026-10-23\n---\n- 3h @acme\n", // Fri: in
      "logs/2026/2026-10-24.md": "---\ndate: 2026-10-24\n---\n- 5h @acme\n", // next Sat: out
    });
    const w = buildWeek(hold, startOfWeek("2026-10-21", 6));
    expect(w.days[0]).toBe("2026-10-17");
    expect(w.days[6]).toBe("2026-10-23");
    expect(w.rows[0].hours).toEqual([2, 0, 0, 0, 0, 0, 3]);
    expect(weekTsv(w).split("\r\n")[0]).toBe("Project\tSat, Oct 17\tSun, Oct 18\tMon, Oct 19\tTue, Oct 20\tWed, Oct 21\tThu, Oct 22\tFri, Oct 23\tTotal");
  });

  it("keeps a waiting item's original date when it rolls over", async () => {
    const hold = await makeHold({
      "logs/2026/2026-10-16.md": "---\ndate: 2026-10-16\n---\n## Tasks\n- [ ] specs @waiting(Sam)\n- [ ] normal\n",
    });
    await hold.ensureLog("2026-10-19", "2026-10-19");
    const moved = hold.get("logs/2026/2026-10-19.md")!.tasks;
    expect(moved.map((t) => t.raw)).toEqual(["- [ ] specs @waiting(Sam) @since(2026-10-16)", "- [ ] normal"]);
    expect(moved[0].since).toBe("2026-10-16");
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

  it("starts meeting notes from calendar events and guesses the project", async () => {
    const hold = await makeHold({
      "clients/hogan-lovells.md": "---\nname: Hogan Lovells\n---\n# Hogan Lovells\n",
      "projects/FLIS Retain PA.md": "---\nclient: hogan-lovells\nstatus: active\n---\n# FLIS Retain PA\n",
    });
    expect(hold.guessOwner("FLIS Retain PA: weekly sync")).toEqual({ client: "hogan-lovells", project: "flis-retain-pa" });
    expect(hold.guessOwner("Hogan Lovells quarterly review")).toEqual({ client: "hogan-lovells" });
    expect(hold.guessOwner("Dentist")).toEqual({ client: undefined });
    const p = await hold.createMeeting("FLIS Retain PA: weekly sync", "2026-10-23", "hogan-lovells", {
      time: new Date(2026, 9, 23, 14, 30),
      attendees: ["Lee, Jordan", "sam@x.com"],
      project: "flis-retain-pa",
    });
    const f = hold.get(p)!;
    expect(f.frontmatter.time).toBe("14:30");
    expect(f.frontmatter.attendees).toEqual(["Lee, Jordan", "sam@x.com"]);
    expect(f.frontmatter.project).toBe("flis-retain-pa");
    expect(hold.fileClient(f)).toBe("hogan-lovells");
    expect(hold.meetingNote("2026-10-23", "flis retain pa: weekly sync")?.path).toBe(p);
    expect(hold.meetingNote("2026-10-24", "FLIS Retain PA: weekly sync")).toBeUndefined();
  });

  it("hoists, edits, recolors and lowers flags", async () => {
    const hold = await makeHold();
    const p = await hold.hoistFlag("Renew the TLS cert\nexpires Friday", "pink");
    expect(hold.flags().map((f) => f.title)).toEqual(["Renew the TLS cert"]);
    expect(hold.get(p)!.frontmatter.color).toBe("pink");
    await hold.updateFlag(p, { body: "Renew the wildcard cert", color: "blue" });
    expect(hold.get(p)!.body).toBe("Renew the wildcard cert");
    expect(hold.get(p)!.frontmatter.color).toBe("blue");
    await hold.updateFlag(p, { lowered: true });
    expect(hold.flags()).toEqual([]);
    expect(hold.loweredFlags().map((f) => f.path)).toEqual([p]);
  });

  it("updates and clears frontmatter fields", async () => {
    const hold = await makeHold();
    const p = await hold.createClient("Acme Corp");
    await hold.updateFrontmatter(p, { name: "Acme: EMEA" });
    expect(hold.clients().get("acme-corp")).toMatchObject({ name: "Acme: EMEA" });
    const proj = await hold.createProject("Portal", "acme-corp");
    await hold.updateFrontmatter(proj, { client: "", status: "done" });
    expect(hold.get(proj)!.frontmatter).toMatchObject({ status: "done" });
    expect(hold.get(proj)!.frontmatter.client).toBeUndefined();
  });

  it("accepts @mentions as frontmatter values", async () => {
    const hold = await makeHold({
      "clients/hogan-lovells.md": "---\nname: Hogan Lovells\n---\n",
      "clients/alex-lee.md": "---\nname: Alex Lee\n---\n",
      "projects/FLIS Retain PA.md": "---\nclient: @hogan-lovells\nstatus: active\n---\n# FLIS\n",
      "notes/a.md": "---\nproject: @flis-retain-pa\ncreated: 2026-10-21\n---\n# A\n",
      "notes/b.md": "---\nclient: @Alex-Lee   \ntags: [@x, plain]\n---\n# B\n",
      "notes/c.md": "---\nproject: @hogan-lovells/flis-retain-pa\n---\n# C\n",
      "meetings/2026-10-21 m.md": "---\ndate: 2026-10-21\nattendees:\n  - @jordan\n  - Priya\nclient: \"@alex-lee\"\n---\n# M\n",
    });
    const a = hold.get("notes/a.md")!;
    expect(a.frontmatter).toEqual({ project: "@flis-retain-pa", created: "2026-10-21" }); // nothing lost
    expect([hold.fileProject(a), hold.fileClient(a)]).toEqual(["flis-retain-pa", "hogan-lovells"]);
    expect(hold.fileClient(hold.get("notes/b.md")!)).toBe("alex-lee");
    expect(hold.get("notes/b.md")!.frontmatter.tags).toEqual(["@x", "plain"]);
    const c = hold.get("notes/c.md")!;
    expect([hold.fileProject(c), hold.fileClient(c)]).toEqual(["flis-retain-pa", "hogan-lovells"]);
    const m = hold.get("meetings/2026-10-21 m.md")!;
    expect(m.date).toBe("2026-10-21");
    expect(m.frontmatter.attendees).toEqual(["@jordan", "Priya"]);
    expect(hold.fileClient(m)).toBe("alex-lee");
    // a project whose client is written as @key still lists under that client
    expect(hold.projectsOf("hogan-lovells").map((p) => p.title)).toEqual(["FLIS"]);
    expect(hold.notesOf("flis-retain-pa").map((n) => n.title).sort()).toEqual(["A", "C"]);
  });

  it("ties notes to a project with project: frontmatter", async () => {
    const hold = await makeHold({
      "clients/hogan-lovells.md": "---\nname: Hogan Lovells\n---\n",
      "projects/FLIS Retain PA.md": "---\nclient: hogan-lovells\n---\n# FLIS Retain / PA\n",
      "notes/Retention design.md":
        "---\nproject: flis-retain-pa\ncreated: 2026-10-20\n---\n# Retention design\n- [x] Agree schema @done(2026-10-21)\n- [ ] Draft ADR\n",
      "meetings/2026-10-21 FLIS sync.md": "---\ndate: 2026-10-21\nproject: \"@FLIS-Retain-PA\"\n---\n# FLIS sync\n",
      "notes/Unrelated.md": "# Unrelated\n",
    });
    const note = hold.get("notes/Retention design.md")!;
    expect(hold.fileProject(note)).toBe("flis-retain-pa");
    expect(hold.fileClient(note)).toBe("hogan-lovells"); // client comes from the project
    expect(hold.notesOf("flis-retain-pa").map((f) => f.title)).toEqual(["FLIS sync", "Retention design"]);
    // its tasks belong to the project and client; ticked ones count as that day's work
    expect(hold.taskProject(note.tasks[1])).toEqual({ client: "hogan-lovells", project: "flis-retain-pa" });
    expect(hold.agenda("2026-10-21", 14, "hogan-lovells").open.map((t) => t.text)).toEqual(["Draft ADR"]);
    const w = buildWeek(hold, "2026-10-17");
    expect(w.rows.find((r) => r.project === "flis-retain-pa")?.items[4]).toEqual(["Agree schema"]);

    const p = await hold.createNote("Cutover plan", "notes", undefined, "flis-retain-pa");
    expect(hold.get(p)!.frontmatter.project).toBe("flis-retain-pa");
    expect(hold.notesOf("flis-retain-pa").map((f) => f.title)).toContain("Cutover plan");
  });

  it("links projects to clients and searches charts", async () => {
    const hold = await makeHold({ "clients/acme.md": "# Acme\n## Azure\n- Resource group: rg-acme-prod\n" });
    const p = await hold.createProject("Portal rebuild", "acme");
    await hold.appendTo(p, "Servers", "- SQL: sql-portal-prod-01");
    expect(hold.projectsOf("acme").map((f) => f.path)).toEqual([p]);
    expect(hold.chartSearch("prod").map((r) => r.item.value)).toEqual(expect.arrayContaining(["rg-acme-prod", "sql-portal-prod-01"]));
    expect(hold.chartSearch("portal sql").map((r) => r.item.value)).toEqual(["sql-portal-prod-01"]);
  });

  it("searches text and tags", async () => {
    const hold = await makeHold({ "logs/2026/2026-10-19.md": LOG });
    expect(hold.search("dentist").map((h) => h.line)).toEqual([8]);
    expect(hold.search("#admin").map((h) => h.path)).toEqual(["logs/2026/2026-10-19.md"]);
  });
});
