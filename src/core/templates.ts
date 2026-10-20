import { ISODate, formatLong, hhmm, parseISO } from "./dates";

export const DEFAULT_TEMPLATES: Record<string, string> = {
  "templates/log.md": `---
date: {{date}}
---
# {{dateLong}}

## Tasks

## Hours

## Log

`,
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

`,
  "templates/note.md": `---
created: {{date}}
tags: []
---
# {{title}}

`,
  "templates/client.md": `---
name: {{title}}
rate: 0
currency: USD
---
# {{title}}

Log hours with \`- 1.5h @{{slug}} what you did\`. Each bullet below shows on the Chart
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
- \`clients/\`: one file per client with an hourly \`rate\` in the frontmatter.
- \`reminders.md\`: recurring reminders.
- \`templates/\`: edit these to change how new files start.

## Syntax
- Tasks: \`- [ ] Call the bank @due(2026-10-21) #finance\`
- Reminder on a task: \`- [ ] Call dentist @remind(14:00)\` (the time is on that log's day)
- Hours: \`- 2.5h @acme API refactor\` or \`- 45m @acme standup\`
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

Code blocks on a Chart get a copy button, and the line above becomes the title:

    Log in to the tenant:
    \`\`\`bash
    az login --tenant acme.onmicrosoft.com
    \`\`\`

**Azure:** add \`- Tenant: acme.onmicrosoft.com\` and \`- Subscription: Prod (<subscription-guid>)\` to a
Chart, and every \`- Resource group: rg-…\` (or full \`/subscriptions/…\` resource ID) gets a **Portal ↗**
button. Projects use their client's tenant and subscription unless they list their own.

## Hours per project
\`- 2h @acme/portal-rebuild API work\` (or just \`@portal-rebuild\`) counts toward the project
*and* rolls up to the client in the Timesheet and in Dispatch.

## Waiting on
\`- [ ] firewall rules @waiting(Jordan)\` puts the item on the **Waiting on** list, grouped by person,
with how long it's been. Quick capture: \`wait Jordan: firewall rules\`.

## Which client does something belong to?
Anything in a client or project file, or in a meeting or note with \`client: acme\` in its frontmatter,
or tagged \`#acme\` (or \`#portal-rebuild\`). **Focus** (top of the sidebar) narrows the Agenda, Flags,
Charts, Waiting on, Timesheet and Search to one client. While focused, quick capture adds the
client for you (\`2h fixed bug\` → \`- 2h @acme fixed bug\`).

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
- \`2h @acme fixed the login bug\` logs hours
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
  return tpl.replace(/\{\{(\w+)\}\}/g, (all, k) => (k in map ? map[k] : all));
}
