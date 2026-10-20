# Keel

A markdown life organizer for Windows: daily logs, meeting notes, tasks, reminders, hours billed and loose notes. Everything is kept as plain `.md` files in a folder called the **Hold** (default `C:\Users\<you>\Keel`).

## Develop

Prerequisites: Node 20+, Rust (rustup), Visual Studio Build Tools with the C++ workload (plus the ARM64 tools component on ARM machines).

```sh
npm install
npm run tauri dev     # run the app
npm test              # core logic tests (parser, schedule, hold)
npm run tauri build   # installer in src-tauri/target/release/bundle/nsis
```

`npm run dev` runs the UI in a browser. There, the hold lives in localStorage, which is handy for UI work.

## Layout

| Path | What |
|---|---|
| `src/core/` | Framework-free logic: markdown parsing, reminders, the Hold index, quick capture. Unit tested. |
| `src/ui/` | React views and the CodeMirror editor. |
| `src/lib/platform.ts` | Tauri calls (files, notifications, dialogs, autostart), with browser fallbacks. |
| `src-tauri/` | Rust shell: sandboxed file commands, tray icon, close-to-tray, global Ctrl+Alt+K, single instance. |

## Hold format

```
logs/2026/2026-10-19.md     daily log (Tasks / Hours / Log sections)
meetings/2026-10-19 Acme kickoff.md
notes/…                     anything else
clients/acme.md             frontmatter: name, rate, currency
reminders.md                recurring reminders
templates/{log,meeting,note,client}.md
```

Line syntax:

- Task: `- [ ] text @due(2026-10-21) #tag`. `[x]` is done, `[>]` migrated, `[-]` cancelled.
- Reminder: `@remind(14:00)`, `@remind(2026-12-24 18:00)`, `@remind(daily 08:00)`, `weekdays`, `weekends`, `mon,thu 9am`, `monthly 1 09:00`.
- Hours: `- 2.5h @acme what you did`, `- 45m @acme …`, `- 1h30m @acme …`
- Links: `[[Note name]]`

When today's log is created, open top-level tasks from the previous log are carried over, and the old copies are marked `[>]`.
