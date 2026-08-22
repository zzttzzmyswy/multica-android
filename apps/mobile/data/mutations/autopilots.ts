/**
 * Autopilot mutations. Optimistic strategy mirrors web
 * `packages/core/autopilots/mutations.ts`:
 *
 *  - `useUpdateAutopilot` — an optimistic status flip (active ↔ paused). The
 *    post-state is locally predictable, the user stays on the same screen,
 *    failure is rare, and rollback is a cache restore — so it patches the
 *    list + detail caches synchronously and settles with an invalidate
 *    (authoritative server payload wins).
 *  - `useTriggerAutopilot` — no optimistic patch (the resulting run's
 *    id/status are server-authoritative); invalidate runs + detail on settle.
 *  - `useDeleteAutopilot` — optimistic list removal + detail-cache eviction,
 *    rolled back on error (mirrors core, no async onMutate here per the RN
 *    sync-before-await rule).
 *  - Trigger mutations — no optimistic patching: the detail query refetch on
 *    settle owns the (un)present rows; rotate's new URL is read off the
 *    mutation's resolved value, not the cache.
 *
 * The list cache is `Autopilot[]` (autopilotListOptions selects
 * `data.autopilots`), unlike web's `ListAutopilotsResponse` — patch the
 * element list directly.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreateAutopilotRequest,
  CreateAutopilotTriggerRequest,
  GetAutopilotResponse,
  ListAutopilotsResponse,
  UpdateAutopilotRequest,
  UpdateAutopilotTriggerRequest,
} from "@multica/core/types";
import { api } from "@/data/api";
import { autopilotKeys } from "@/data/queries/autopilots";
import { useWorkspaceStore } from "@/data/workspace-store";

export function useUpdateAutopilot() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & UpdateAutopilotRequest) =>
      api.updateAutopilot(id, data),
    onMutate: ({ id, ...data }) => {
      if (!wsId) return;
      const listKey = autopilotKeys.list(wsId);
      const detailKey = autopilotKeys.detail(wsId, id);
      // Request shape (AutopilotSubscriberInput) lacks `created_at`, so it's
      // not assignable to the response shape — the settle invalidate refetches
      // the authoritative payload anyway (mirrors core).
      const { subscribers: _omitSubscribers, ...optimistic } = data;
      // Optimistic patch FIRST (sync), then cancel in-flight queries — the
      // RN sync-before-await rule (apps/mobile/CLAUDE.md "Synchronous
      // setQueryData before await cancelQueries") keeps the UI from
      // flashing the pre-flip state during a navigation snapshot.
      //
      // NOTE the LIST cache holds the raw `ListAutopilotsResponse` shape
      // (`{ autopilots, total }`), not the selected `Autopilot[]` — TQ stores
      // the queryFn result and applies `select` at read time. Patching the
      // object shape, not the array (this tripped `old.map` once).
      const prevList = qc.getQueryData<ListAutopilotsResponse>(listKey);
      const prevDetail = qc.getQueryData<GetAutopilotResponse>(detailKey);
      qc.setQueryData<ListAutopilotsResponse>(listKey, (old) =>
        old
          ? {
              ...old,
              autopilots: old.autopilots.map((a) =>
                a.id === id ? { ...a, ...optimistic } : a,
              ),
            }
          : old,
      );
      qc.setQueryData<GetAutopilotResponse>(detailKey, (old) =>
        old
          ? { ...old, autopilot: { ...old.autopilot, ...optimistic } }
          : old,
      );
      void qc.cancelQueries({ queryKey: listKey });
      void qc.cancelQueries({ queryKey: detailKey });
      return { prevList, prevDetail };
    },
    onError: (_err, vars, ctx) => {
      if (!wsId) return;
      if (ctx?.prevList) {
        qc.setQueryData(autopilotKeys.list(wsId), ctx.prevList);
      }
      if (ctx?.prevDetail) {
        qc.setQueryData(autopilotKeys.detail(wsId, vars.id), ctx.prevDetail);
      }
    },
    onSettled: (_data, _err, vars) => {
      if (!wsId) return;
      void qc.invalidateQueries({
        queryKey: autopilotKeys.detail(wsId, vars.id),
      });
      void qc.invalidateQueries({ queryKey: autopilotKeys.list(wsId) });
    },
  });
}

export function useTriggerAutopilot() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (id: string) => api.triggerAutopilot(id),
    onSettled: (_data, _err, id) => {
      if (!wsId) return;
      void qc.invalidateQueries({ queryKey: autopilotKeys.runs(wsId, id) });
      void qc.invalidateQueries({ queryKey: autopilotKeys.detail(wsId, id) });
    },
  });
}

export function useCreateAutopilot() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (data: CreateAutopilotRequest) => api.createAutopilot(data),
    onSettled: () => {
      if (!wsId) return;
      void qc.invalidateQueries({ queryKey: autopilotKeys.list(wsId) });
    },
  });
}

// Access grant/revoke commit immediately through their own mutations
// (mirrors web's AutopilotAccessManager — independent of the form's Save).
// No optimistic patch: the detail query refetch on settle owns the updated
// collaborator list.
export function useGrantAutopilotAccess() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: ({
      autopilotId,
      userId,
    }: {
      autopilotId: string;
      userId: string;
    }) => api.grantAutopilotAccess(autopilotId, userId),
    onSettled: (_data, _err, vars) => {
      if (!wsId) return;
      void qc.invalidateQueries({
        queryKey: autopilotKeys.detail(wsId, vars.autopilotId),
      });
    },
  });
}

export function useRevokeAutopilotAccess() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: ({
      autopilotId,
      userId,
    }: {
      autopilotId: string;
      userId: string;
    }) => api.revokeAutopilotAccess(autopilotId, userId),
    onSettled: (_data, _err, vars) => {
      if (!wsId) return;
      void qc.invalidateQueries({
        queryKey: autopilotKeys.detail(wsId, vars.autopilotId),
      });
    },
  });
}

// Optimistic removal returns the user to the list instantly; the detail row
// is evicted rather than patched (it's gone). onError restores the list.
export function useDeleteAutopilot() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (id: string) => api.deleteAutopilot(id),
    onMutate: (id) => {
      if (!wsId) return undefined;
      const listKey = autopilotKeys.list(wsId);
      const prevList = qc.getQueryData<ListAutopilotsResponse>(listKey);
      qc.setQueryData<ListAutopilotsResponse>(listKey, (old) =>
        old
          ? {
              ...old,
              autopilots: old.autopilots.filter((a) => a.id !== id),
              total: Math.max(0, old.total - 1),
            }
          : old,
      );
      qc.removeQueries({ queryKey: autopilotKeys.detail(wsId, id) });
      return { prevList };
    },
    onError: (_err, _id, ctx) => {
      if (!wsId || !ctx?.prevList) return;
      qc.setQueryData(autopilotKeys.list(wsId), ctx.prevList);
    },
    onSettled: () => {
      if (!wsId) return;
      void qc.invalidateQueries({ queryKey: autopilotKeys.list(wsId) });
    },
  });
}

export function useCreateAutopilotTrigger() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: ({
      autopilotId,
      ...data
    }: { autopilotId: string } & CreateAutopilotTriggerRequest) =>
      api.createAutopilotTrigger(autopilotId, data),
    onSettled: (_data, _err, vars) => {
      if (!wsId) return;
      void qc.invalidateQueries({
        queryKey: autopilotKeys.detail(wsId, vars.autopilotId),
      });
    },
  });
}

export function useUpdateAutopilotTrigger() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: ({
      autopilotId,
      triggerId,
      ...data
    }: {
      autopilotId: string;
      triggerId: string;
    } & UpdateAutopilotTriggerRequest) =>
      api.updateAutopilotTrigger(autopilotId, triggerId, data),
    onSettled: (_data, _err, vars) => {
      if (!wsId) return;
      void qc.invalidateQueries({
        queryKey: autopilotKeys.detail(wsId, vars.autopilotId),
      });
    },
  });
}

export function useDeleteAutopilotTrigger() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: ({
      autopilotId,
      triggerId,
    }: {
      autopilotId: string;
      triggerId: string;
    }) => api.deleteAutopilotTrigger(autopilotId, triggerId),
    onSettled: (_data, _err, vars) => {
      if (!wsId) return;
      void qc.invalidateQueries({
        queryKey: autopilotKeys.detail(wsId, vars.autopilotId),
      });
    },
  });
}

// The returned trigger carries the fresh webhook URL — callers read it off
// the resolved value to show the user, then settle invalidates the detail
// query so the trigger card masks the new token on next render.
export function useRotateAutopilotWebhookToken() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: ({
      autopilotId,
      triggerId,
    }: {
      autopilotId: string;
      triggerId: string;
    }) => api.rotateAutopilotWebhookToken(autopilotId, triggerId),
    onSettled: (_data, _err, vars) => {
      if (!wsId) return;
      void qc.invalidateQueries({
        queryKey: autopilotKeys.detail(wsId, vars.autopilotId),
      });
    },
  });
}

// Replay creates a NEW delivery row — the deliveries list is invalidated so
// the refetched list shows both the original and its replay.
export function useReplayAutopilotDelivery() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: ({
      autopilotId,
      deliveryId,
    }: {
      autopilotId: string;
      deliveryId: string;
    }) => api.replayAutopilotDelivery(autopilotId, deliveryId),
    onSettled: (_data, _err, vars) => {
      if (!wsId) return;
      void qc.invalidateQueries({
        queryKey: autopilotKeys.deliveries(wsId, vars.autopilotId),
      });
    },
  });
}