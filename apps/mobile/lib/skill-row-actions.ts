/**
 * Which actions a skills-LIST row offers — the pure half of the list-row kebab
 * added in iteration 230 (MYS-2097), mirroring web's `SkillRowActions`
 * (`packages/views/skills/components/skill-list-actions.tsx:537-614`).
 *
 * Before this round the row's only exit was `router.push` to the detail page,
 * and the list had no row menu at all: refreshing one of the deployment's 18
 * GitHub-sourced skills, or adding any skill to an agent, meant opening the
 * skill first. The capabilities themselves already existed on the detail page —
 * what was missing was this entry point.
 *
 * Three web rules are mirrored verbatim, each one a place a plausible edit
 * silently changes product semantics:
 *
 *   1. **`add_to_agent` is unconditional**, and it is therefore what keeps the
 *      trigger on screen for a member without edit rights. Web's kebab is
 *      always rendered — its unconditional `open_in_new_tab` guarantees that —
 *      so the menu is never empty there; here `add_to_agent` plays that role.
 *      Attaching is gated by the TARGET agent (its owner, or a workspace
 *      admin), never by edit rights on the skill, so hiding the kebab for a
 *      read-only member would take away a capability web grants.
 *
 *      NOTE, recorded because the round's issue text said otherwise: the issue
 *      proposed hiding the whole menu when `!canEdit`. Web gates only `delete`
 *      (and `refresh`) on `canEdit` (`:580`), so hiding the trigger outright
 *      would have dropped `add_to_agent` for read-only members — a regression
 *      against web, not a parity choice. The gate is mirrored, not the
 *      shorthand.
 *   2. **`refresh` needs `canEdit` AND a hosted origin** (`:537`): re-downloading
 *      overwrites SKILL.md and the whole file set, so it is an edit, and a
 *      runtime-local / manual skill has no upstream to re-download from.
 *   3. **`delete` needs `canEdit`.** Not `canDelete`, not a role check — the
 *      same per-row predicate the list already computes for the lock badge and
 *      the batch bar's `allDeletable`.
 *
 * `open_in_new_tab` is the one web entry deliberately NOT ported: a phone has
 * no tabs and the row tap already opens the skill — the same reason
 * `agent-row-menu.tsx` and `autopilot-row-menu.tsx` omit it.
 */
import type { SkillRow } from "./filter-skills";
import { isRefreshableOrigin, readOrigin } from "./skill-guards";

export type SkillRowAction = "add-to-agent" | "refresh" | "delete";

/** The slice of a list row the gating reads. */
export type SkillRowActionInput = Pick<SkillRow, "skill" | "canEdit">;

/**
 * Web's `canRefresh = row.canEdit && isRefreshableOrigin(origin)` (`:537`).
 *
 * Both halves matter: `canEdit` alone would offer a refresh on a manual skill
 * (nothing to fetch), and `isRefreshableOrigin` alone would offer one to a
 * member the server will reject. `isRefreshableOrigin` already requires a
 * non-empty `source_url`, so a GitHub-origin skill missing one is excluded
 * too — 18 of this deployment's 27 skills qualify, and all 18 carry a URL.
 */
export function canRefreshSkill(row: SkillRowActionInput): boolean {
  return row.canEdit && isRefreshableOrigin(readOrigin(row.skill));
}

/**
 * The kebab's items, in menu order. Non-empty for every row — `add_to_agent`
 * is unconditional — so the caller renders the trigger on every row rather
 * than branching on an empty list, which is where this differs from
 * `autopilotRowActions` / `agentRowActions` (both of which can return `[]`).
 * The empty-return contract is kept anyway so a future gate that removes the
 * last item does not leave an empty sheet on screen.
 */
export function skillRowActions(row: SkillRowActionInput): SkillRowAction[] {
  const actions: SkillRowAction[] = ["add-to-agent"];
  if (canRefreshSkill(row)) actions.push("refresh");
  if (row.canEdit) actions.push("delete");
  return actions;
}
