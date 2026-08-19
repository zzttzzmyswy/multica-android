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