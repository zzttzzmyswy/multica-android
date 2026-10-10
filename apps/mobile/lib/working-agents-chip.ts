/**
 * Agents-working chip: the two states a reader must be able to tell apart,
 * and the facet decode behind the header chip's number.
 *
 * Web renders this chip twice — `WorkspaceAgentWorkingChip` on the Issues and
 * My Issues headers, `SubIssuesAgentWorkingChip` on issue detail's sub-issues
 * header. Mobile's port keeps web's state machine intact rather than
 * collapsing it, because every one of these distinctions was a bug web fixed
 * on purpose:
 *
 *   - `undefined` (projection unresolved) is NOT `[]` (resolved, nobody
 *     working). Rendering "0" or the dimmed tier for an unresolved read
 *     asserts "nothing is happening here" on no evidence (MUL-5525).
 *   - the toggle being ON is NOT the same as activity existing: the filled
 *     brand tier means "you are filtering by this", the tint means "there is
 *     activity here", and they must not look alike.
 *   - the count behind the chip is the SERVER's, narrowed by the surface's
 *     own scope and filters — never a client tally over the loaded page.
 *     A header number is a claim about a scope, so the server owns the
 *     arithmetic (web `working_agents` facet, MUL-5525).
 *
 * Pure so it is testable without the native chain; the queries live in
 * `data/queries/working-agents.ts` and `data/queries/issue-facets.ts`.
 */
import type {
  IssueTableFacet,
  WorkingAgentSummary,
} from "@multica/core/types";

/**
 * What the projection says about activity in a surface. `unknown` is a
 * first-class case, not a synonym for `none` — same three states web models
 * (`workspace-agent-working-chip.tsx:25`).
 */
export type ChipActivity = "unknown" | "none" | "some";

export function chipActivity(
  agents: readonly WorkingAgentSummary[] | undefined,
): ChipActivity {
  if (agents === undefined) return "unknown";
  return agents.length > 0 ? "some" : "none";
}

/** How a chip paints itself. `variant` names the Button tier; `tone` carries
 *  the extra classes that tier is allowed to wear. */
export interface ChipAppearance {
  /** "brand" = filled brand (the filter is ON); "brandSubtle" = brand tint
   *  (activity present); "outline" = neutral. */
  variant: "brand" | "brandSubtle" | "outline";
  /** Extra classes. Only the muted-text tier carries any, and only when the
   *  surface is CONFIRMED idle — see `chipAppearance`. */
  tone: "" | "dimmed";
}

/**
 * Which tier the chip wears, mirroring web `chipAppearance`
 * (`workspace-agent-working-chip.tsx:43`).
 *
 * The order is the whole point: an active filter outranks activity (the user's
 * own switch is the stronger claim), and an unresolved projection gets the
 * NEUTRAL tier **without** the muted text. The muted text is what reads as
 * "nothing is happening here", and we do not yet know that — dimming it would
 * assert it.
 */
export function chipAppearance(
  value: boolean,
  activity: ChipActivity,
): ChipAppearance {
  if (value) return { variant: "brand", tone: "" };
  if (activity === "some") return { variant: "brandSubtle", tone: "" };
  if (activity === "unknown") return { variant: "outline", tone: "" };
  return { variant: "outline", tone: "dimmed" };
}

/**
 * The `working_agents` facet → the summaries the chip renders, or `undefined`
 * when the response carries no such facet.
 *
 * Absent is NOT empty: a deployment older than the facet answers with an
 * error or a response that omits it, and the chip must stay indeterminate
 * rather than claim zero (web: `use-issue-surface-controller.ts:549-559`).
 *
 * Keys are agent ids and counts are running-task counts, already narrowed by
 * the surface's own scope and filters — which is exactly why this facet, and
 * not a client tally, is the header number's authority.
 */
export function workingAgentsFromFacets(
  facets: readonly IssueTableFacet[] | undefined,
): WorkingAgentSummary[] | undefined {
  const facet = facets?.find((candidate) => candidate.kind === "working_agents");
  if (!facet) return undefined;
  return facet.values.map((value) => ({
    id: value.key,
    running_task_count: value.count,
  }));
}

/** The i18n base key for "N agents working", so the singular/plural pick
 *  happens at one site (`countLabelKey` resolves the suffix). */
export const WORKING_AGENTS_COUNT_LABEL = "issue.agentsWorking";
