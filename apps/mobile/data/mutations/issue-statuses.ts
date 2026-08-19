/**
 * Mobile-side issue-status catalog mutations (MUL-6243), mirroring web's
 * `packages/core/issue-statuses/mutations.ts` but bound to mobile's own
 * ApiClient (`@/data/api`) and workspace store.
 *
 * The catalog query is cached for 5 minutes and read by every surface that
 * renders a status label, so each mutation invalidates it explicitly rather
 * than waiting for staleness. A rename or recolor also invalidates the issue
 * scope: a status's name is resolved from the catalog at render time, but the
 * board/list caches hold the rows whose labels have to re-render.
 *
 * Cache-patch math lives in the exported pure functions below so the Node
 * vitest lane can exercise the optimistic contract without a React renderer
 * (same split as the issue-view mutations).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreateIssueStatusRequest,
  IssueStatusCategory,
  IssueStatusEntry,
  ListIssueStatusesResponse,
  UpdateIssueStatusRequest,
} from "@multica/core/types";
import { api } from "@/data/api";
import { issueStatusKeys } from "@/data/queries/issue-statuses";
import { issueKeys } from "@/data/queries/issue-keys";
import { useWorkspaceStore } from "@/data/workspace-store";
import { compareIssueStatusEntries } from "@/lib/issue-status-catalog";

/** Appends a freshly created status to the cached envelope (no dupes). */
export function appendStatusToList(
  old: ListIssueStatusesResponse,
  entry: IssueStatusEntry,
): ListIssueStatusesResponse {
  if (old.statuses.some((s) => s.id === entry.id)) return old;
  return { ...old, statuses: [...old.statuses, entry], total: old.total + 1 };
}

/** Merges an update patch onto one cached row (used by the optimistic path). */
export function patchStatusInList(
  old: ListIssueStatusesResponse,
  id: string,
  patch: UpdateIssueStatusRequest,
): ListIssueStatusesResponse {
  return {
    ...old,
    statuses: old.statuses.map((s) => (s.id === id ? { ...s, ...patch } : s)),
  };
}

/**
 * Applies a category reorder: assigns positions 1..n to `ordered` (the
 * category's ACTIVE custom statuses — its built-in stays seeded at 0) and
 * re-sorts the whole list with the canonical comparator. Re-sorting rather
 * than only writing positions: consumers render the array in order, so
 * positions alone would leave the reorder visually undone until refetch.
 */
export function reorderStatusesInList(
  old: ListIssueStatusesResponse,
  ordered: IssueStatusEntry[],
): ListIssueStatusesResponse {
  const positionById = new Map(ordered.map((e, index) => [e.id, index + 1]));
  const statuses = old.statuses
    .map((s) =>
      positionById.has(s.id) ? { ...s, position: positionById.get(s.id)! } : s,
    )
    .sort(compareIssueStatusEntries);
  return { ...old, statuses };
}

function useCatalogContext() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const listKey = issueStatusKeys.list(wsId);
  const invalidate = () => {
    if (!wsId) return;
    void qc.invalidateQueries({ queryKey: issueStatusKeys.all(wsId) });
  };
  return { qc, wsId, listKey, invalidate };
}

export function useCreateIssueStatus() {
  const { qc, wsId, listKey, invalidate } = useCatalogContext();
  return useMutation({
    mutationFn: (data: CreateIssueStatusRequest) =>
      api.createIssueStatus(data),
    onSuccess: (entry) => {
      // Append to the cached envelope so the catalog reflects the new status
      // without waiting for a refetch.
      if (!entry.id || !wsId) return;
      qc.setQueryData<ListIssueStatusesResponse>(listKey, (old) =>
        old ? appendStatusToList(old, entry) : old,
      );
    },
    onSettled: invalidate,
  });
}

/**
 * Optimistic rename / recolor / repost — the same shape as web's
 * `useUpdateIssueStatus`. Without it, a reposted order would snap back for
 * the round-trip.
 */
export function useUpdateIssueStatus() {
  const { qc, wsId, listKey, invalidate } = useCatalogContext();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: { id: string } & UpdateIssueStatusRequest) =>
      api.updateIssueStatus(id, data),
    onMutate: async ({ id, ...data }) => {
      await qc.cancelQueries({ queryKey: listKey });
      const previous = qc.getQueryData<ListIssueStatusesResponse>(listKey);
      qc.setQueryData<ListIssueStatusesResponse>(listKey, (old) =>
        old ? patchStatusInList(old, id, data) : old,
      );
      return { previous, listKey };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous && ctx.listKey) {
        qc.setQueryData(ctx.listKey, ctx.previous);
      }
    },
    onSettled: () => {
      invalidate();
      // Issue rows render the catalog's name/color, so a rename has to reach
      // the cached lists too.
      if (wsId) void qc.invalidateQueries({ queryKey: issueKeys.all(wsId) });
    },
  });
}

/**
 * Archives a custom status. Deliberately NOT optimistic: the server refuses
 * to archive a built-in, and a row silently vanishing before that refusal
 * arrives would read as success.
 */
export function useArchiveIssueStatus() {
  const { invalidate } = useCatalogContext();
  return useMutation({
    mutationFn: (id: string) => api.archiveIssueStatus(id),
    onSettled: invalidate,
  });
}

/**
 * Commits a reorder within ONE category. Sent as a single request (atomic),
 * NOT one PATCH per row. `ordered` is that category's ACTIVE custom
 * statuses; the server assigns positions from 1 because the category's
 * built-in is seeded at 0 and never moves.
 */
export function useReorderIssueStatuses() {
  const { qc, wsId, listKey, invalidate } = useCatalogContext();
  return useMutation({
    mutationFn: ({
      category,
      ordered,
    }: {
      category: IssueStatusCategory;
      ordered: IssueStatusEntry[];
    }) =>
      api.reorderIssueStatuses(
        category,
        ordered.map((entry) => entry.id),
      ),
    onMutate: async ({ ordered }) => {
      await qc.cancelQueries({ queryKey: listKey });
      const previous = qc.getQueryData<ListIssueStatusesResponse>(listKey);
      qc.setQueryData<ListIssueStatusesResponse>(listKey, (old) =>
        old ? reorderStatusesInList(old, ordered) : old,
      );
      return { previous, listKey };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous && ctx.listKey) {
        qc.setQueryData(ctx.listKey, ctx.previous);
      }
    },
    onSettled: invalidate,
  });
}