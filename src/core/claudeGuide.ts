/**
 * CLAUDE.md written into the Hold root (only if missing; the user owns it after that).
 * Claude Code reads it automatically when it runs in the Hold, so its edits stay in
 * formats Keel understands.
 */
export const CLAUDE_GUIDE = `# Keel hold: guide for Claude

This folder is a **Keel** "Hold": a personal organizer kept as plain markdown files. Keel (a desktop
app) reads these files and re-indexes them a few seconds after they change, so anything you edit here
shows up in the app. The owner is a software architect working across several clients and projects.

**Edit the markdown directly, and keep it in the formats below.** Keel parses them, so invented syntax
won't show up anywhere. Prefer small, targeted edits over rewriting whole files.

## Layout

| Path | What |
|---|---|
| \`logs/YYYY/YYYY-MM-DD.md\` | One log per day (e.g. \`logs/2026/2026-10-21.md\`). Sections: \`## Tasks\`, \`## Work\` (older logs: \`## Hours\`), \`## Log\` |
| \`meetings/YYYY-MM-DD Title.md\` | Meeting notes; frontmatter has \`date\` and \`client\` |
| \`notes/…\` | Free-form notes, organised in subfolders (\`notes/Clients/Hogan/…\`). \`archived: <date>\` in frontmatter files a note in the Archive |
| \`clients/<key>.md\` | One per client; file name is the client key (e.g. \`clients/hogan-lovells.md\`); frontmatter \`name\` |
| \`projects/<Name>.md\` | One per project; frontmatter \`client: <client-key>\` and \`status: active / paused / done\` |
| \`flags/…md\` | Sticky notes ("Flags"); frontmatter \`color\`, \`created\`, and \`lowered: <date>\` once done |
| \`reminders.md\` | Recurring reminders |
| \`templates/\` | Templates for new files: don't change unless asked |

Dates are always \`YYYY-MM-DD\`. Every file may start with YAML frontmatter between \`---\` lines: keep it valid.

## Keys
- A **client key** is its file name without \`.md\`: \`clients/hogan-lovells.md\` → \`hogan-lovells\`.
- A **project key** is its file name slugified: lowercase, spaces → \`-\`, punctuation dropped.
  \`projects/FLIS Retain PA.md\` → \`flis-retain-pa\`.
- Never rename client or project files or change their keys: hours already logged reference them.

## Daily work and hours (the important one)
Under \`## Work\` in a day's log: **one line per project with that day's total hours**, and the work done
listed underneath, indented two spaces. Hours are per project per day, never per item.

\`\`\`markdown
## Work
- 6h @flis-retain-pa
  - Reviewed retention policy draft
  - Call with records team
- 1.5h @vbs-2026-2027-pa
  - Updated the timeline
\`\`\`

- The tag is \`@project-key\`, \`@client-key\` (general client work), or \`@client-key/project-key\`.
- Durations: \`6h\`, \`0.25h\`, \`1.5h\`, \`6h 30m\`, \`90 min\`. When writing, use the \`6h\` / \`0.25h\` form.
- To add hours for a project that already has a line that day, **update its total**; don't add a second line.
- A line with no hours yet is just \`- @project-key\`.
- No rates, money or billing: hours only.
- Timesheet weeks run **Saturday to Friday**.

## Tasks
- \`- [ ] text\` open · \`- [x] text @done(YYYY-MM-DD)\` done · \`- [>] text\` carried to a later day · \`- [-] text\` cancelled
- When ticking a task, add \`@done(<today>)\`.
- Due date: \`@due(YYYY-MM-DD)\`. Reminder: \`@remind(14:00)\`, \`@remind(2026-12-24 18:00)\`, \`@remind(weekdays 09:00)\`.
- Waiting on someone: \`- [ ] firewall rules @waiting(Jordan Lee)\` (keep any \`@since(…)\` tag).
- Tag tasks with a client or project with \`#client-key\` or \`#project-key\`. A ticked task tagged to a
  project also counts as that day's work on the timesheet.
- Each morning Keel moves open top-level tasks from the previous log into today's and marks the old ones \`[>]\`.

## Links and tags
- \`[[Note name]]\` links to another note by file name or title; \`[[Note|label]]\` sets the shown text.
- \`#tag\` anywhere is a tag. Text inside \`backticks\` is ignored by Keel (examples, not data).

## Charts (client and project reference pages)
In \`clients/\` and \`projects/\` files, every bullet under a \`##\` heading is a reference row:
\`- Label: value\`, \`- [Label](https://…)\`, or \`- value\`. Fenced code blocks there are copyable snippets
(the line just above becomes the title). \`- Tenant: …\` and \`- Subscription: Name (<guid>)\` enable
Azure portal links for \`- Resource group: rg-…\` rows. Never store passwords or secrets in these files.

## Meetings and notes
Meeting files have frontmatter \`title\`, \`date\`, \`client\`, \`attendees\`. A note or meeting can set
\`project: <project-key>\` to belong to a project (its client follows from the project), or \`client: <key>\`
to belong to a client only. Either form works with or without \`@\` (\`project: @flis-retain-pa\`), and
\`project: @client-key/project-key\` names both. Notes tied to a project are listed on its Chart, and ticked tasks inside them
count as that day's work on the project. When creating a note about a project, set \`project:\`.
Diagrams: \`\`\`mermaid code blocks render in Keel.

## When asked to…
- **"Log N hours on X today"** → today's log, \`## Work\`: add or update \`- Nh @key\` and list the work under it.
  Create today's log from \`templates/log.md\` if it doesn't exist (fill \`{{date}}\` and \`{{dateLong}}\`).
- **"What did I do on X this week?"** → read the \`## Work\` blocks for that key in the week's logs (Sat to Fri),
  plus ticked tasks tagged to it.
- **Summaries or reports** → answer in the chat unless asked to save one; saved reports go in \`notes/\`.
`;
