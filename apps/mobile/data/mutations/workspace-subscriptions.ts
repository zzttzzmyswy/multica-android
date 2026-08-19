/**
 * Workspace-subscription mutations (iteration-67 Billing). Mirror web's
 * `packages/core/billing/workspace-subscription-mutations.ts`: all three settle
 * by invalidating the entitlements read, because a checkout/portal/reconcile
 * changes what the workspace is entitled to (or refreshes what we know).
 *
 * All mutations expect the server to be the real gate: checkout/portal are
 * owner/admin actions server-side, and the UI only renders them for managers.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateWorkspaceSubscriptionCheckoutRequest } from "@multica/core/types";
import { api } from "@/data/api";
import { workspaceSubscriptionKeys } from "@/data/queries/workspace-subscriptions";
import { useWorkspaceStore } from "@/data/workspace-store";

export function useCreateWorkspaceSubscriptionCheckout() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (data: CreateWorkspaceSubscriptionCheckoutRequest) =>
      api.createWorkspaceSubscriptionCheckout(data),
    onSuccess: () => {
      if (!wsId) return;
      void qc.invalidateQueries({
        queryKey: workspaceSubscriptionKeys.entitlements(wsId),
      });
    },
  });
}

export function useReconcileWorkspaceSubscriptionSeats() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: () => api.reconcileWorkspaceSubscriptionSeats(),
    onSuccess: () => {
      if (!wsId) return;
      void qc.invalidateQueries({
        queryKey: workspaceSubscriptionKeys.entitlements(wsId),
      });
    },
  });
}

export function useCreateWorkspaceSubscriptionPortal() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (idempotencyKey: string) =>
      api.createWorkspaceSubscriptionPortal(idempotencyKey),
    onSuccess: () => {
      if (!wsId) return;
      void qc.invalidateQueries({
        queryKey: workspaceSubscriptionKeys.entitlements(wsId),
      });
    },
  });
}