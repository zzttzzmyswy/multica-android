/**
 * Workspace-subscriptions capability gate (iteration 209).
 *
 * `billing_workspace_subscriptions` is a deployment capability, not a
 * per-user preference. Web reads it once and uses it for two things
 * (`packages/views/settings/components/settings-page.tsx`):
 *
 *   - the Billing tab leaves the visible tab list when it is off (`:151`);
 *   - a `?tab=billing` deep link is redirected to `workspace` (`:171`), so
 *     the hidden tab is not reachable by URL either.
 *
 * The server enforces the same flag as a hard gate: with it off every
 * `/api/cloud-subscriptions/*` endpoint answers 503
 * (`server/internal/handler/cloud_billing.go:76`). So on such a deployment
 * there is no state in which a Billing screen can succeed.
 *
 * Mobile previously had no gate. The Settings row stayed tappable, the screen
 * issued a query that could only 503, and the failure rendered as
 * "Billing is temporarily unavailable" with a Retry button. That sentence is
 * wrong twice: the capability is not temporarily down (retrying is futile),
 * and it tells the reader to keep trying something the deployment will never
 * offer.
 *
 * The key comes from `@multica/core/feature-flags` — a pure constant module
 * with no React or DOM dependency, so it satisfies the mobile import rule in
 * `apps/mobile/CLAUDE.md`. Hard-coding the string here would let the key drift
 * from the one web and the server read.
 */
import { BILLING_WORKSPACE_SUBSCRIPTIONS_FLAG } from "@multica/core/feature-flags";

export { BILLING_WORKSPACE_SUBSCRIPTIONS_FLAG };

export type BillingScreenState = "disabled" | "loading" | "error" | "ready";

/**
 * Which of the four states the Billing screen is in.
 *
 * `disabled` is checked FIRST and outranks the query's own state: while the
 * capability is off the screen must not consult the read at all, so a gated
 * query that is somehow still pending (or errored) cannot leak "loading" /
 * "temporarily unavailable" copy for a deployment that has no billing.
 */
export function billingScreenState(input: {
  /** The deployment capability, from `/api/config`. */
  enabled: boolean;
  isPending: boolean;
  isError: boolean;
}): BillingScreenState {
  if (!input.enabled) return "disabled";
  if (input.isPending) return "loading";
  if (input.isError) return "error";
  return "ready";
}
