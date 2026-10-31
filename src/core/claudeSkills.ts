/**
 * Claude Code skills seeded into the Hold (.claude/skills/…), run from the Claude panel by the
 * Timesheet's "Fill timecard" and "Status report" buttons. Each starts as a playbook with blanks
 * that Claude fills in with the owner on the first run, so they're seeded once and never replaced.
 */

/** Where Keel writes the week's hours and work for these skills (dot folders aren't indexed). */
export const WEEK_BRIEF_PATH = ".keel/claude/week.md";

const BROWSER_SETUP = `Check that you have browser tools (such as \`browser_navigate\`). If not, offer to add the Playwright
   MCP server to this Hold's \`.mcp.json\`, with its own Edge profile outside the Hold so sign-ins persist
   (use the owner's real home folder, with forward slashes):
   \`\`\`json
   { "mcpServers": { "browser": { "command": "npx", "args": ["@playwright/mcp@latest", "--browser", "msedge",
     "--user-data-dir", "C:/Users/<owner>/AppData/Local/Keel/browser"] } } }
   \`\`\`
   Then ask the owner to open Claude's terminal in Keel (Ctrl+Shift+\`), approve the server there, and start a
   new chat; stop until they have.`;

const SIGN_IN_RULE = `- Never type, store or ask for passwords or MFA codes. When a site wants a sign-in, ask the owner to sign in
  in the browser window and tell you when they're done.`;

export const TIMECARD_SKILL = `---
name: timecard
description: Enter a week's hours from Keel into the owner's timecard website using a browser. Use when asked to fill in, enter or do the timecard or timesheet.
argument-hint: "[week start YYYY-MM-DD]"
---

# Fill in the timecard

Keel writes the week to \`${WEEK_BRIEF_PATH}\` (hours grid, gaps, work per project) just before it runs
this skill from Timesheet → **Fill timecard**. Read it first. If it's missing, or it's for a different week
than the one asked for ($ARGUMENTS), ask the owner to press **Fill timecard** on that week in Keel. Don't
add the hours up from the logs yourself: the brief is what the owner sees in Keel.

## Rules

- Enter the hours in the brief exactly. Never round, move, split or invent hours.
- **Never press Submit, Sign, Certify or Approve.** Save as a draft if the site has one, then stop.
- If the brief lists gaps, tell the owner before entering anything and ask whether to go ahead.
- If a project has no charge code below, or the site shows something unexpected (a locked or already
  submitted week, a different total, an error), stop and ask.
${SIGN_IN_RULE}

## First run

If **Site** below still says TODO, set it up with the owner before entering anything:

1. ${BROWSER_SETUP}
2. Ask for the timecard site's address, open it, and have the owner sign in.
3. Go through entering one week together. Write down under **Site** how to reach the week's entry screen,
   how the grid works (adding rows, day columns, description fields) and how to save a draft.
4. Ask which timecard project or charge code each project in the brief goes to; fill in **Charge codes**.

Keep this file up to date as you learn the site's quirks, and keep it short.

## Site

TODO: address, how to reach a week's entry screen, how the grid works, how to save a draft.

## Charge codes

| Keel project (client) | Timecard project / code | Notes |
|---|---|---|
| TODO | | |

## Each run

1. Read the brief and report any gaps.
2. Open the site and go to the week starting on the brief's first day.
3. For each row in the brief's **Hours** table, enter each day's hours against its charge code. If the
   site has a per-day description, use that day's items from **Work by project**.
4. Check that the site's day and week totals match the brief's.
5. Save as a draft, then stop. Show a table of what you entered and remind the owner to review and submit.
`;

export const STATUS_REPORT_SKILL = `---
name: status-report
description: Draft the owner's weekly status report from Keel's logs, then enter it where it goes (a website, via the browser). Use when asked for a status report or weekly update.
argument-hint: "[week start YYYY-MM-DD]"
---

# Status report

Keel writes the week to \`${WEEK_BRIEF_PATH}\` (hours, gaps, work per project per day) just before it runs
this skill from Timesheet → **Status report**. Start from its **Work by project**. For context, also read
that week's logs (\`logs/YYYY/YYYY-MM-DD.md\`, the \`## Log\` sections) and meeting notes (\`meetings/\`), and
the open tasks tagged to each project for "next week". If the brief is missing or for a different week than
the one asked for ($ARGUMENTS), ask the owner to press **Status report** on that week in Keel.

## Rules

- Draft first and show the owner the draft here. Only enter it anywhere after they've approved it.
- Report what the logs say: don't invent progress, dates or percentages. Note anything unclear as a question.
- **Never press Send, Submit or Publish.** Fill it in, then stop for the owner to review and send.
- Leave personal items (anything under \`personal/\`) out.
${SIGN_IN_RULE}

## First run

If **Where it goes** below still says TODO, set it up with the owner:

1. Ask where status reports go (a website form, a wiki page, an email) and who reads them.
2. Ask for the format: one report per project or one combined, the sections, the length, and the tone.
   An earlier report pasted in is the best guide; save its shape under **Format**.
3. Ask whether to keep a copy in the Hold (for example \`notes/Status reports/YYYY-MM-DD <Project>.md\`).
4. If it goes on a website: ${BROWSER_SETUP}

Keep this file up to date as the owner corrects drafts, and keep it short.

## Where it goes

TODO: the site or recipient, how to reach the right form or page, and who reads it.

## Format

TODO: per project or combined; sections (for example Done / Next / Risks and blockers); length; tone.

## Each run

1. Read the brief, the week's logs and meeting notes, and the open tasks per project.
2. Draft the report in the format above and show it here. Revise it until the owner approves.
3. If it goes on a website, open it in the browser, fill it in, and stop before sending.
4. Keep a copy in the Hold if the owner asked for one.
`;
