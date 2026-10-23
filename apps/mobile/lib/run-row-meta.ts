/**
 * The facts a run row states about one run — the mobile answer to web's
 * `meta` line in `packages/views/issues/components/execution-log-section.tsx`
 * (`:677-698`: agent · reason-or-duration · tokens · model) plus the
 * `formatUsd(usage.cost)` web puts in its status slot (`:713`).
 *
 * Why this file exists: on a desktop those facts can share one row and hide
 * their exact values behind hover text. On a phone they cannot. `run-row.tsx`
 * draws them as visible small text, and every decision they encode (when a
 * duration is a duration, when a figure is an em dash, how a model id is
 * shortened) lives here so it can be tested in the Node lane and cannot drift
 * from the surfaces that read it.
 *
 * Deliberate deviations from web, each noted at its site:
 *  - **no tooltip.** Web puts time/duration/model in the row's `title`. A
 *    touch screen has no hover, so a `title` there would be unreachable
 *    content — the same reasoning `run-timeline-panel.tsx` records for its
 *    readout row.
 *  - **the failure reason is not repeated.** Web has one `reason` slot in the
 *    meta line. Mobile's `StatusBadge` already prints "Failed · <reason>", so
 *    this module answers "is a reason on screen" and the row suppresses its
 *    duration when it is — the two are mutually exclusive on web too
 *    (`:685-692`: `if (reason) … else if (started_at && completed_at) …`).
 */
import type { AgentTask } from "@multica/core/types";
import { formatTokens } from "./usage-format";
import { formatDuration } from "./usage-time";
import { formatUsd, type TaskUsageSummary } from "./task-usage";

/**
 * `formatDuration`'s label for a span under one second. Same literal the
 * timeline panel uses (`run-timeline-panel.tsx`'s `UNDER_A_SECOND`), so one
 * run never reads "0s" in the sheet and "<1m" in the chart above it.
 */
export const UNDER_A_SECOND = "0s";

/**
 * How long the run actually executed, or `null`.
 *
 * Both ends are required, and it is `completed_at - started_at` — never
 * `created_at`. `created_at` is when the run was QUEUED; on a busy runtime
 * that can be hours before the agent did anything, and reporting it as the
 * run's length would blame the agent for the queue. Web gates on exactly this
 * pair (`execution-log-section.tsx:690`).
 */
export function runDurationSeconds(
  task: Pick<AgentTask, "started_at" | "completed_at">,
): number | null {
  if (!task.started_at || !task.completed_at) return null;
  const started = new Date(task.started_at).getTime();
  const completed = new Date(task.completed_at).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(completed)) return null;
  return (completed - started) / 1000;
}

/** The run's length as a compact label, or `null` when it has no length to
 *  state (never started, still running, or an unparseable timestamp). */
export function runDurationLabel(
  task: Pick<AgentTask, "started_at" | "completed_at">,
): string | null {
  const seconds = runDurationSeconds(task);
  if (seconds === null) return null;
  return formatDuration(seconds, UNDER_A_SECOND);
}

// ─── Model names ───────────────────────────────────────────────────────────

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * A model id as a compact label: "claude-opus-5-5-high" → "Opus 5.5 high",
 * "gpt-6.1-sol" → "GPT-6.1 Sol". Provider prefixes and context-window tags
 * ("[1m]") are dropped. Ids from families it does not know come back as-is,
 * so an unfamiliar model is never renamed into something misleading.
 *
 * Verbatim port of web's `shortModelName`
 * (`packages/views/issues/components/issue-run-timeline.ts:471`). The rule is
 * copied rather than re-invented because the same run's model must read the
 * same on both clients; a prefix-truncation of our own would have produced
 * "claude-opus-5-5…", which names two different models identically.
 */
export function shortModelName(model: string): string {
  const id = model
    .replace(/^[^/]+\//, "")
    .replace(/\[[^\]]*\]$/, "")
    .replace(/-\d{8}$/, "");
  // claude-<tier>-<major>[-<minor>]-<variant…>
  const claude = id.match(/^claude-([a-z]+)((?:-\d{1,2})+)(?:-(.+))?$/);
  if (claude) {
    const [, tier, version, variant] = claude;
    const versionText = version!.slice(1).replace(/-/g, ".");
    const variantText = variant?.replace(/-/g, " ");
    return [capitalize(tier!), versionText, variantText]
      .filter(Boolean)
      .join(" ");
  }
  // gpt-<version>-<variant…>, gemini-<version>-<variant…>
  const generic = id.match(/^(gpt|gemini)-([^-]+)(?:-(.+))?$/);
  if (generic) {
    const [, family, version, variant] = generic;
    const head = family === "gpt" ? `GPT-${version}` : `Gemini ${version}`;
    return [head, ...(variant?.split("-").map(capitalize) ?? [])].join(" ");
  }
  return model;
}

// ─── Usage line ────────────────────────────────────────────────────────────

/** What the row's usage line says, already formatted for display. */
export interface RunUsageParts {
  tokens: string;
  /** Short model label for the run's first model, or `null` when unknown. */
  model: string | null;
  cost: string;
}

/**
 * Tokens, model and cost for one run.
 *
 * `null` usage means "we have no figure", never "this run was free": the row
 * renders a single em dash for all three. That is web's rule
 * (`execution-log-section.tsx:678-679` — usage reporting landed after many
 * runs had already completed) and the reason `summarizeTaskUsage` distinguishes
 * `null` from a zero-filled summary.
 *
 * The model is `models[0]` — the first slice in the run's own order. A run
 * that touched two models (a fallback mid-run) reports the one it started
 * with; numbering them would cost more width than the second name is worth on
 * a phone.
 */
export function runUsageParts(summary: TaskUsageSummary | null): RunUsageParts | null {
  if (!summary) return null;
  return {
    tokens: formatTokens(summary.tokens),
    model: summary.models[0] ? shortModelName(summary.models[0]) : null,
    cost: formatUsd(summary.cost),
  };
}
