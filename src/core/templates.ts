import { ISODate, formatLong, hhmm, parseISO } from "./dates";
import { yamlScalar } from "./parse";

/** Earlier default templates: a hold file still exactly like one of these is upgraded to the current default. */
export const OLD_TEMPLATES: Record<string, string[]> = {
  "templates/meeting.md": [
    `---
title: {{title}}
date: {{date}}
time: "{{time}}"
client:
attendees: []
---
# {{title}}

## Agenda

## Notes

## Action items

`,
  ],
};

export const DEFAULT_TEMPLATES: Record<string, string> = {
  "templates/log.md": `---
date: {{date}}
---
# {{dateLong}}

## Tasks

## Work

## Log

`,
  // ${""} keeps the space after "- [ ]" (editors strip trailing spaces), so typing starts the first action item
  "templates/meeting.md": `---
title: {{title}}
date: {{date}}
time: "{{time}}"
client:
attendees: []
---
# {{title}}

## Agenda

## Notes

## Action items
- [ ] ${""}
`,
  "templates/personal-log.md": `---
date: {{date}}
---
# {{dateLong}}

## Tasks

## Log

`,
  "templates/note.md": `---
created: {{date}}
tags: []
---
# {{title}}

`,
  "templates/client.md": `---
name: {{title}}
---
# {{title}}

Log hours with \`- 6h @{{slug}}\` in a day's log. Each bullet below shows on the Chart
with a copy button: \`- Label: value\`. Keep secrets in a password manager, not here.

## Links

## Contacts

## Azure

## Servers

## Notes
`,
  "templates/project.md": `---
client: {{client}}
status: active
---
# {{title}}

## Links

## Repos

## Environments

## Azure

## Servers

## Decisions
`,
};

export const DEFAULT_REMINDERS = `# Reminders

Recurring reminders live here. One per bullet: \`- text @remind(when)\`

*when* can be \`daily 08:00\`, \`weekdays 17:30\`, \`weekends 10:00\`, \`mon,thu 9am\`,
\`monthly 1 09:00\` or a one-off like \`2026-12-24 18:00\`.

- Plan tomorrow @remind(weekdays 17:00)
`;

export const WELCOME_NOTE = `---
tags: [keel]
---
# Welcome to Keel

Everything in your **Hold** is a plain markdown file, so you can open it in any editor.

## Where things live
- \`logs/2026/2026-10-19.md\`: one log per day. Open it with **Today** (Ctrl+T).
- \`meetings/\`: meeting notes, named by date.
- \`notes/\`: anything else.
- \`clients/\` and \`projects/\`: one file per client and per project.
- \`reminders.md\`: recurring reminders.
- \`templates/\`: edit these to change how new files start.

## Syntax
- Tasks: \`- [ ] Call the bank @due(2026-10-21) #finance\`
- Reminder on a task: \`- [ ] Call dentist @remind(14:00)\` (the time is on that log's day)
- Work: \`- 6h @portal-rebuild\` with what you did indented under it (see below)
- Links: \`[[Some note]]\`. Ctrl+click to follow (creates the note if needed).
- Tags: \`#anything\`

Unfinished tasks in yesterday's log roll over into today's when it's created,
and the old ones are marked \`[>]\` (migrated).

## Charts (client & project reference)
Each file in \`clients/\` and \`projects/\` is shown as a **Chart**. Every bullet becomes a row with a
copy button, grouped by its \`##\` heading:
- \`- Prod portal: https://portal.acme.com\` (URLs get an open button)
- \`- Resource group: rg-acme-prod-eus\`
- \`- [Runbook](https://wiki.acme.com/runbook)\`

A project names its client in frontmatter (\`client: acme\`) and appears on that client's Chart.

A note or meeting belongs to a project with \`project: portal-rebuild\` in its frontmatter (or pick the
project when creating it). It's listed under **Notes** on the project's Chart, its client follows from
the project, and tasks ticked in it count toward that project's day on the Timesheet.

Code blocks on a Chart get a copy button, and the line above becomes the title:

    Log in to the tenant:
    \`\`\`bash
    az login --tenant acme.onmicrosoft.com
    \`\`\`

**Azure:** add \`- Tenant: acme.onmicrosoft.com\` and \`- Subscription: Prod (<subscription-guid>)\` to a
Chart, and every \`- Resource group: rg-…\` (or full \`/subscriptions/…\` resource ID) gets a **Portal ↗**
button. Projects use their client's tenant and subscription unless they list their own.

## Daily work and the weekly timesheet
Under **Work** in each day's log, give every project you worked on one line with the day's total,
and list what you did underneath:

    - 6h @portal-rebuild
      - Designed the API gateway
      - Reviewed the auth PR
    - 1.5h @contoso
      - Fixed the SSO redirect bug

Start a project with just \`- @portal-rebuild\` and fill in the hours later; press Enter at the end of
that line and the next one starts indented under it. The **Work** panel above the log does the same
with a form. Ticked tasks tagged \`#portal-rebuild\` or naming \`@portal-rebuild\` also count as that day's work.

The **Timesheet** shows the week as projects × days for entering into your time system (copy a cell,
a row, or the whole grid), with a daily report per project underneath (**Copy report** / **Copy day**).
\`@client/project\` and \`@project\` both count toward the project *and* roll up to its client.

Quick capture: \`6h @portal-rebuild\` adds hours to today's block; \`@portal-rebuild reviewed the PR\`
adds an item to it.

## Waiting on
\`- [ ] firewall rules @waiting(Jordan)\` puts the item on the **Waiting on** list, grouped by person,
with how long it's been. Quick capture: \`wait Jordan: firewall rules\`.

## Which client does something belong to?
Anything in a client or project file, or in a meeting or note with \`client: acme\` in its frontmatter,
or tagged \`#acme\` (or \`#portal-rebuild\`). **Focus** (top of the sidebar) narrows the Agenda, Flags,
Charts, Waiting on, Timesheet and Search to one client. While focused, quick capture adds the
client for you (\`2h fixed bug\` adds 2h and the item to today's \`@acme\` block).

## Dispatch (status reports)
**Dispatch** builds a client status update for a week: hours by project, what you completed,
meetings, what's in progress, what you're waiting on, and what's due next. Copy it for an email,
or save it as a note. Ticking a task stamps \`@done(date)\` so the report knows when it finished.

## Diagrams
A \`\`\`mermaid code block renders as a diagram right under it, in any note.

## Flags
A **Flag** is a sticky note that stays pinned on Today and the Agenda until you lower it.
Hoist one from the Flags board, or with quick capture: \`flag renew the TLS cert\`.

## Quick capture
Press **Ctrl+Alt+K** anywhere in Windows:
- \`6h @portal-rebuild\` adds hours to today's work for that project
- \`@portal-rebuild fixed the login bug\` adds what you did to it
- \`wait Jordan: firewall rules\` adds to Waiting on
- \`todo buy printer ink\` or \`[] buy printer ink\` adds a task
- \`remind me 3pm call the bank\` (also \`tomorrow 9am …\`) adds a reminder
- \`flag call Sam about the cutover\` hoists a Flag
- anything else becomes a timestamped line in today's log
`;

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
}

/** Characters Windows won't allow in file names. */
export function safeFileName(title: string): string {
  return title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
}

export function fillTemplate(tpl: string, vars: { date: ISODate; title?: string; now?: Date; client?: string }): string {
  const now = vars.now ?? new Date();
  const title = vars.title ?? "";
  const map: Record<string, string> = {
    client: vars.client ?? "",
    date: vars.date,
    dateLong: formatLong(vars.date),
    weekday: parseISO(vars.date).toLocaleDateString(undefined, { weekday: "long" }),
    time: hhmm(now),
    title,
    slug: slugify(title),
  };
  const fill = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (all, k) => (k in map ? map[k] : all));
  // a frontmatter value that is just a placeholder ("title: {{title}}") gets quoted when needed,
  // so titles like "Acme: kickoff" keep the YAML valid
  const fm = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(tpl)?.[0] ?? "";
  const head = fm.replace(/^(\s*[\w-]+:[ \t]*)\{\{(\w+)\}\}[ \t]*$/gm, (all, key: string, k: string) =>
    k in map && map[k] !== "" ? key + yamlScalar(map[k]) : all,
  );
  return fill(head) + fill(tpl.slice(fm.length));
}
