import { WEEK_BRIEF_PATH } from "../core/claudeSkills";
import { Hold } from "../core/hold";
import { Week, WeekCheck, weekBrief } from "../core/week";
import { Nav } from "./nav";

/** Hold skills (in .claude/skills) that work from Keel's week brief. */
export type WeekSkill = "timecard" | "status-report";

/**
 * Write the week's brief where the skill reads it, then run the skill in the Claude panel.
 * Claude takes the numbers from the brief, so they match the Timesheet view exactly.
 */
export async function handToClaude(hold: Hold, nav: Nav, week: Week, check: WeekCheck, skill: WeekSkill, focus?: string) {
  const clientName = focus ? (hold.clients().get(focus)?.name ?? focus) : undefined;
  await hold.fs.write(WEEK_BRIEF_PATH, weekBrief(week, check, clientName));
  nav.askClaude(`/${skill} ${week.days[0]}`);
}
