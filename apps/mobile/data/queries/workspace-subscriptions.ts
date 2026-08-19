/**
 * Workspace-subscription query layer (iteration-67 Billing). Mirrors web's
 * `packages/core/billing/workspace-subscription-queries.ts`:
 *   workspace-subscriptions / <wsId> / entitlements|summary|prices
 *
 * Unlike account-level wallet keys, these ARE scoped by workspace ID even
 * though the server resolves the workspace from the request context: keying on
 * the workspace is what stops a cached snapshot from one workspace being shown
 * for another after a switch.
 *
 * Reads degrade to `null` (not empty) on schema drift so a contract change is
 * rendered as "unavailable" — never as Free.
 */
import { queryOptions } from "@tanstack/react-query";
import type { WorkspaceSubscriptionPrices } from "@multica/core/types";
import { api } from "@/data/api";

const WORKSPACE_SUBSCRIPTION_PRICES_STALE_TIME_MS = 10 * 60 * 1000;

export const workspaceSubscriptionKeys = {
  all: (wsId: string | null) => ["workspace-subscriptions", wsId] as const,
  entitlements: (wsId: string | null) =>
    [...workspaceSubscriptionKeys.all(wsId), "entitlements"] as const,
  summary: (wsId: string | null) =>
    [...workspaceSubscriptionKeys.all(wsId), "summary"] as const,
  prices: (wsId: string | null) =>
    [...workspaceSubscriptionKeys.all(wsId), "prices"] as const,
};

export function workspaceSubscriptionEntitlementsOptions(
  wsId: string | null,
) {
  return queryOptions({
    queryKey: workspaceSubscriptionKeys.entitlements(wsId),
    queryFn: () => api.getWorkspaceSubscriptionEntitlements(),
    enabled: !!wsId,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

/** The Billing page's secondary read — summary carries billingInterval and
 *  actual/billed seats. Short stale time plus refetch on focus so a user
 *  returning from Stripe (system browser) sees new state without reload. */
export function workspaceSubscriptionSummaryOptions(wsId: string | null) {
  return queryOptions({
    queryKey: workspaceSubscriptionKeys.summary(wsId),
    queryFn: () => api.getWorkspaceSubscriptionSummary(),
    enabled: !!wsId,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });
}

/** A validated price snapshot is stable deployment configuration, but a null
 *  parse fallback is not a snapshot — keeping null fresh lets a transient
 *  backend/contract failure recover on remount or focus. */
export function workspaceSubscriptionPricesStaleTime(
  prices: WorkspaceSubscriptionPrices | null | undefined,
): number {
  return prices ? WORKSPACE_SUBSCRIPTION_PRICES_STALE_TIME_MS : 0;
}

export function workspaceSubscriptionPricesOptions(wsId: string | null) {
  return queryOptions({
    queryKey: workspaceSubscriptionKeys.prices(wsId),
    queryFn: () => api.getWorkspaceSubscriptionPrices(),
    enabled: !!wsId,
    staleTime: (query) =>
      workspaceSubscriptionPricesStaleTime(query.state.data),
    refetchOnWindowFocus: true,
    retry: false,
  });
}