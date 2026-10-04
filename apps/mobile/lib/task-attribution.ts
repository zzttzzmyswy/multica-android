/**
 * Run attribution — the pure predicates behind the mobile "on behalf of
 * <member>" affordance. Mobile port of web's
 * `packages/views/issues/components/attribution-badge.tsx` (MUL-4302 §9);
 * the rendering lives in `components/agent/attribution-badge.tsx`, this
 * module holds only the decision logic so it stays Node-testable.
 *
 * Three questions, mirroring web's three:
 *   - `attributionSourceLabelKey` — which i18n key explains HOW the human was
 *     resolved. Eight known levels; an unknown one returns `null` so the
 *     caller prints the raw `source` instead of a blank (the server owns this
 *     vocabulary and may add a level at any time).
 *   - `isAttributionUncertain` — whether the displayed name might NOT be the
 *     real responsible person, which is the ONLY thing warranting a cautionary
 *     tone. See the function for why this is narrower than the server's
 *     `precise` flag.
 *   - `attributionShouldRender` — whether there is anything to show at all.
 */
import type { TaskAttribution } from "@multica/core/types";

/** The eight resolution levels the server resolves through its attribution
 *  waterfall, in web's switch order. */
const SOURCE_LABEL_KEYS: Record<string, string> = {
  direct_human: "agents.activity.attribution.sourceDirectHuman",
  delegation: "agents.activity.attribution.sourceDelegation",
  comment_source: "agents.activity.attribution.sourceCommentSource",
  trigger_owner: "agents.activity.attribution.sourceTriggerOwner",
  rule_owner: "agents.activity.attribution.sourceRuleOwner",
  owner_fallback: "agents.activity.attribution.sourceOwnerFallback",
  backfill: "agents.activity.attribution.sourceBackfill",
  unattributed: "agents.activity.attribution.sourceUnattributed",
};

/**
 * i18n key for a resolution source, or `null` when the level is unknown to
 * this build. `null` is not an error: the caller falls back to the raw
 * `source` string, so a server-added level reads as itself rather than blank
 * (web's `default: sourceLabel = attribution.source`).
 */
export function attributionSourceLabelKey(source: string): string | null {
  return SOURCE_LABEL_KEYS[source] ?? null;
}

/**
 * True when the named human may not actually be accountable — the only state
 * that earns a cautionary colour.
 *
 * Deliberately narrower than the server's `precise` flag, which is an
 * attribution-*coverage* health bit that `owner_fallback`, `backfill` AND
 * `unattributed` all fail. Coverage is an ops metric, not a reader-facing
 * signal: the only question a viewer of "on behalf of <name>" has is whether
 * that name could be wrong. That is true for a fallback guess
 * (`owner_fallback` — nothing resolved, so the agent owner was substituted),
 * but NOT for `backfill`, which is a historical after-the-fact record: the
 * name itself is right, only its provenance is less rigorous (MUL-4768).
 *
 * Keeping `precise === false` as the base means a future unknown degraded
 * level still warns (fail-safe) rather than silently reading as confident.
 */
export function isAttributionUncertain(
  attribution: TaskAttribution | undefined,
): boolean {
  return attribution?.precise === false && attribution.source !== "backfill";
}

/**
 * Whether there is anything to render. An avatar-only or inline surface has
 * nothing meaningful to show without a resolved human, so the absence of an
 * `initiator` silences the whole affordance — including its leading separator
 * (web's two call sites guard on `task.attribution?.initiator` for exactly
 * this reason: an unattributed run must not leave a dangling middot).
 */
export function attributionShouldRender(
  attribution: TaskAttribution | undefined,
): boolean {
  return Boolean(attribution?.initiator);
}
