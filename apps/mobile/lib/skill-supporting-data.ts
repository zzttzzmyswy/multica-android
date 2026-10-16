/**
 * What a skills surface may say about a row whose *supporting* reads — the
 * workspace directories its cells are resolved through, not the skill rows
 * themselves — have not produced an answer.
 *
 * Web states the same failure twice: a banner that names it
 * (`packages/views/skills/components/skills-page.tsx:778-810`, `!!agentsError
 * || !!membersError || !!runtimesError`), and the cells underneath rendered
 * exactly as if the data were known. Desktop gets away with the second half
 * because the banner is right there AND because a lock glyph carries a
 * `TooltipContent` on hover. A phone has neither relief: the list wrote
 * 「未使用」 straight onto the row and hung a lock next to the name, both
 * derived from a request that had failed, and the lock's explanation lives
 * only in an `accessibilityLabel` a sighted user never sees. A user therefore
 * read "nobody uses this, I can delete it" and "I cannot edit this" as facts.
 *
 * So this module splits one failure into two decisions, deliberately not the
 * same predicate:
 *
 *   - `supportingDataWarningVisible` — the banner. Web's gate exactly: fire
 *     only on a FAILED read. Loading is self-explanatory (the rows are still
 *     arriving) and a banner over it would flash on every cold open.
 *   - `usedByCell` / `skillLockCell` / `usedBySection` / `usedByCount` — the
 *     cells. These stop asserting whenever the read has not SETTLED, which is
 *     the wider `isResolved` (ready | empty): a cell is a claim, not a status,
 *     and a claim may only be made once the directory is the whole answer.
 *
 * `empty` is on the trusted side of both, on purpose: it means the request
 * succeeded and the workspace really has none, which is the one case where
 * 「未使用」 is a fact rather than a guess (`lib/catalog-state.ts` states this
 * rule for the directory vocabulary as a whole).
 *
 * Note what is NOT here: web's third disjunct, `runtimesError`. Mobile's skills
 * list and detail read no runtime directory at all — the one thing web uses it
 * for is printing a runtime-local skill's CLI name, and neither screen prints
 * one (the origin badge 「本地运行时」 is a static label off the skill record).
 * Gating on a read the screen does not make would show a banner over a banner's
 * worth of nothing.
 *
 * Kept DOM-free and framework-free so every branch is unit-testable in the
 * Node vitest lane, where there is no RN renderer to exercise a component.
 */
import type { CatalogState } from "./catalog-state";

/** State of the two directories a skills row's cells resolve through. */
export interface SkillSupportingStates {
  agents: CatalogState;
  members: CatalogState;
}

/**
 * Whether the supporting-data degradation banner belongs on screen —
 * web's `supportingQueryDown`, one disjunct shorter (see the module note).
 *
 * Failure only, never loading: this is the pre-fix shape the two surfaces
 * shipped, where the banner was missing entirely, so `false` on a failed read
 * is the exact regression this gate exists to catch.
 */
export function supportingDataWarningVisible(
  states: SkillSupportingStates,
): boolean {
  return states.agents === "error" || states.members === "error";
}

/** What the list row's "Used by" slot may render. */
export type UsedByCell = "agents" | "unused" | "unknown";

/**
 * Row decision for web's `UsedByCell` (`skills-page.tsx:251-258`).
 *
 * `agents` (there are bound agents) is not gated: a non-empty list is evidence
 * the read landed, and hiding rows that did arrive would lose information. The
 * two zero branches are where the defect lived — `agentsResolved === false`
 * means the count of zero is unread, not measured, so the row says
 * `unknown` (the app's "—" placeholder) instead of 「未使用」.
 */
export function usedByCell(
  agentCount: number,
  agentsResolved: boolean,
): UsedByCell {
  if (agentCount > 0) return "agents";
  return agentsResolved ? "unused" : "unknown";
}

/** What the list row's lock slot may render. */
export type SkillLockCell = "pencil" | "lock" | "none";

/**
 * Row decision for web's read-only lock (`skills-page.tsx:238-249`).
 *
 * `canEdit === true` is always trustworthy: it comes either from a role the
 * members read produced or from `skill.created_by === userId`, and the second
 * half holds whatever the members read did. Only the negative needs the read:
 * `canEditSkill` (`lib/skill-guards.ts`) falls back to creator-only when
 * `role` is null, so under a failed members read every skill the user did not
 * create grows a lock — 「只读——只有创建者或管理员能编辑」 asserted from a
 * request that never answered.
 *
 * `none` rather than a guess in either direction. Drawing the pencil would
 * invite a write the server may reject, which is worse than saying nothing;
 * drawing the lock would keep stating the false conclusion this round removes.
 */
export function skillLockCell(
  canEdit: boolean,
  membersResolved: boolean,
): SkillLockCell {
  if (canEdit) return "pencil";
  return membersResolved ? "lock" : "none";
}

/** What the detail page's "Used by" section body may render. */
export type SkillUsedBySection = "agents" | "empty" | "status";

/**
 * Section decision for web's `skill-detail-page.tsx:525` block. `status` sends
 * the caller to `CatalogStatus`, which paints the live state (a spinner, or the
 * failure with its retry) from `agentsRead.state` — the detail page already
 * does exactly this one row up, for the labels read.
 *
 * The claim being removed: `usedByAgents.length === 0` rendered 「还未分配给任
 * 何智能体。打开某个智能体的 Skills 标签页进行分配。」 over a failed agents
 * read, i.e. the same false-absence sentence the pickers were swept for in
 * MYS-1892/MYS-1907, sitting on a page that never joined that sweep.
 */
export function usedBySection(
  agentCount: number,
  agentsResolved: boolean,
): SkillUsedBySection {
  if (agentCount > 0) return "agents";
  return agentsResolved ? "empty" : "status";
}

/**
 * The detail header's 「被 N 个智能体使用」 count, or `null` when it may not be
 * stated — the caller renders the app's "—" placeholder, the same treatment
 * `components/issue/agents-working-chip.tsx` gives an unresolved projection.
 *
 * One claim, one gate: this must agree with `usedBySection` on every input, or
 * the page would put 「被 0 个智能体使用」 above a failure notice. So the
 * non-zero branch is ungated for the same reason it is there — agents that
 * arrived are evidence the read landed, and only a zero needs the directory to
 * have settled.
 */
export function usedByCount(
  agentCount: number,
  agentsResolved: boolean,
): number | null {
  if (agentCount > 0) return agentCount;
  return agentsResolved ? 0 : null;
}
