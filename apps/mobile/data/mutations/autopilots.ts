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
 *
 * The list cache is `Autopilot[]` (autopilotListOptions selects
 * `data.autopilots`), unlike web's `ListAutopilotsResponse` — patch the
 * element list directly.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  GetAutopilotResponse,
  ListAutopilotsResponse,
  UpdateAutopilotRequest,
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