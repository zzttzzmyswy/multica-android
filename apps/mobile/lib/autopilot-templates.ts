/**
 * Empty-state quick-start templates for the autopilot list, mirroring web
 * `packages/views/autopilots/components/autopilots-page.tsx` TEMPLATES: six
 * operational prompts (daily news digest / PR review / bug triage / weekly
 * progress / dependency audit / documentation check) plus the schedule each
 * one pre-fills into the create form.
 *
 * - Prompts stay raw English — the web file keeps them that way on purpose
 *   because they are injected directly into the agent's task input; editing
 *   happens in the create form before submit.
 * - `templateScheduleToCron` serializes the same ScheduleConfig subset web's
 *   `schedule-editor/cron-mapping.ts` `toCron` handles (`at` time +
 *   every/weekly days); day-of-week ranges/consecutive runs collapse the same
 *   way (dowFieldFromDays). Unknown shapes return null — the caller falls
 *   back to a blank schedule instead of persisting a broken cron.
 */
export type AutopilotTemplateId =
  | "daily_news"
  | "pr_review"
  | "bug_triage"
  | "weekly_progress"
  | "dependency_audit"
  | "documentation_check";

export type AutopilotTemplateDays =
  | { kind: "every" }
  | { kind: "weekly"; daysOfWeek: number[] };

export interface AutopilotTemplateSchedule {
  time: { kind: "at"; time: string };
  days: AutopilotTemplateDays;
}

export interface AutopilotTemplate {
  id: AutopilotTemplateId;
  prompt: string;
  schedule: AutopilotTemplateSchedule;
}

const WEEKDAYS: AutopilotTemplateDays = {
  kind: "weekly",
  daysOfWeek: [1, 2, 3, 4, 5],
};
const MONDAY: AutopilotTemplateDays = { kind: "weekly", daysOfWeek: [1] };

export const AUTOPILOT_TEMPLATES: readonly AutopilotTemplate[] = [
  {
    id: "daily_news",
    prompt: `1. Search the web for news and announcements published today only (strictly today's date)
2. Filter for topics relevant to our team and industry
3. For each item, write a short summary including: title, source, key takeaways
4. Compile everything into a single digest post
5. Post the digest as a comment on this issue and @mention all workspace members`,
    schedule: { time: { kind: "at", time: "09:00" }, days: { kind: "every" } },
  },
  {
    id: "pr_review",
    prompt: `1. List all open pull requests in the repository
2. Identify PRs that have been open for more than 24 hours without a review
3. For each stale PR, note the author, age, and a one-line summary of the change
4. Post a comment on this issue listing all stale PRs with links
5. @mention the team to remind them to review`,
    schedule: { time: { kind: "at", time: "10:00" }, days: WEEKDAYS },
  },
  {
    id: "bug_triage",
    prompt: `1. List all backlog issues that have not been prioritized
2. For each issue, read the description and any attached logs or screenshots
3. Assess severity (critical / high / medium / low) based on user impact and scope
4. Set the priority field on the issue accordingly
5. Add a comment explaining your assessment and suggested next steps`,
    schedule: { time: { kind: "at", time: "09:00" }, days: WEEKDAYS },
  },
  {
    id: "weekly_progress",
    prompt: `1. Gather all issues completed (status "done") in the past 7 days
2. Gather all issues currently in progress
3. Identify any blocked issues and their blockers
4. Calculate key metrics: issues closed, issues opened, net change
5. Write a structured weekly report with sections: Completed, In Progress, Blocked, Metrics
6. Post the report as a comment on this issue`,
    schedule: { time: { kind: "at", time: "17:00" }, days: MONDAY },
  },
  {
    id: "dependency_audit",
    prompt: `1. Run dependency audit tools on the project (npm audit, go vuln check, etc.)
2. Identify any packages with known security vulnerabilities
3. List outdated packages that are more than 2 major versions behind
4. For each finding, note the severity, affected package, and recommended fix
5. Post a summary report as a comment with actionable items`,
    schedule: { time: { kind: "at", time: "08:00" }, days: MONDAY },
  },
  {
    id: "documentation_check",
    prompt: `1. List all code changes merged in the past 7 days (via git log)
2. For each significant change, check if related documentation was updated
3. Identify any new APIs, config options, or features missing documentation
4. Create a list of documentation gaps with file paths and suggested content
5. Post the findings as a comment on this issue`,
    schedule: { time: { kind: "at", time: "14:00" }, days: MONDAY },
  },
];

/** Consecutive runs collapse to a range ("1-5"), singles stay bare — the
 *  same day-of-week field web dowFieldFromDays produces. */
function dowFieldFromDays(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const day of sorted) {
    const last = runs[runs.length - 1];
    if (last && day === last[1] + 1) last[1] = day;
    else runs.push([day, day]);
  }
  return runs.map(([lo, hi]) => (hi > lo ? `${lo}-${hi}` : `${lo}`)).join(",");
}

export function templateScheduleToCron(
  schedule: AutopilotTemplateSchedule | undefined | null,
): string | null {
  if (!schedule) return null;
  const { time, days } = schedule;
  if (time.kind !== "at" || !/^\d{2}:\d{2}$/.test(time.time)) return null;
  const [hour, minute] = time.time.split(":").map((n) => Number(n));
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  let dom = "*";
  let dow = "*";
  if (days.kind === "weekly") {
    const valid = days.daysOfWeek.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    if (valid.length === 0) return null;
    dow = dowFieldFromDays(valid);
  }
  // web order: minute hour dom month dow — no zero-padding (web String()s them)
  return `${String(minute)} ${String(hour)} ${dom} * ${dow}`;
}

export function isTemplateId(id: string | undefined | null): id is AutopilotTemplateId {
  if (typeof id !== "string") return false;
  return AUTOPILOT_TEMPLATES.some((t) => t.id === id);
}