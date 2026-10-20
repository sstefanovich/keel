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

Log hours against this client with \`- 1.5h @{{slug}} what you did\`.

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

## Quick capture
Press **Ctrl+Alt+K** anywhere in Windows:
- \`2h @acme fixed the login bug\` logs hours
- \`todo buy printer ink\` or \`[] buy printer ink\` adds a task
- \`remind me 3pm call the bank\` (also \`tomorrow 9am …\`) adds a reminder
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

export function fillTemplate(tpl: string, vars: { date: ISODate; title?: string; now?: Date }): string {
  const now = vars.now ?? new Date();
  const title = vars.title ?? "";
  const map: Record<string, string> = {
    date: vars.date,
    dateLong: formatLong(vars.date),
    weekday: parseISO(vars.date).toLocaleDateString(undefined, { weekday: "long" }),
    time: hhmm(now),
    title,
    slug: slugify(title),
  };
  return tpl.replace(/\{\{(\w+)\}\}/g, (all, k) => (k in map ? map[k] : all));
}
