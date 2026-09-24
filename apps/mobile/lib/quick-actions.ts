import type { QuickAction } from "@multica/core/types";

// Mirrors web quick-actions-tab.tsx isStale/daysSince (MUL-5465). A usage
// figure is only worth flagging once it has had time to be used — a freshly
// created action is "never used" by definition.
const UNUSED_DAYS_THRESHOLD = 90;

export function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86_400_000);
}

/** True when the action has sat unused (or uncreated) for ≥90 days. */
export function isStaleQuickAction(
  action: Pick<QuickAction, "last_used_at" | "created_at">,
): boolean {
  const sinceLastUse = daysSince(action.last_used_at);
  if (sinceLastUse !== null) return sinceLastUse >= UNUSED_DAYS_THRESHOLD;
  const age = daysSince(action.created_at);
  return age !== null && age >= UNUSED_DAYS_THRESHOLD;
}
/**
 * Client-side name + target search over the quick-action catalog, mirroring
 * web's `QuickActionsTab` filter (packages/views/settings/components/
 * quick-actions-tab.tsx:217-226). The catalog is capped at 30 rows, so a
 * server round-trip would buy nothing but a loading flicker per keystroke.
 *
 * `target_name` is searched as well as the name because the target is what the
 * user usually remembers ("the deploy one") while the name is often a private
 * label they wrote months ago. It is optional on the row — a target the viewer
 * cannot see arrives as null — so a missing one simply never matches.
 */
export function filterQuickActions(
  actions: readonly QuickAction[],
  query: string,
): QuickAction[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...actions];
  return actions.filter(
    (action) =>
      action.name.toLowerCase().includes(q) ||
      (action.target_name ?? "").toLowerCase().includes(q),
  );
}
