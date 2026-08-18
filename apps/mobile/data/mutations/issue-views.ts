/**
 * Saved-issue-view mutations (iteration-65). Cache-patching helpers are pure
 * functions exported so the Node vitest lane can cover the optimistic update
 * contract without a React renderer; the hooks wire them to the query cache.
 *
 * Optimistic strategy:
 * - create: NOT optimistic — a confirmed dialog flow; the new view is seeded
 *   into its scope list on success (so activating it immediately doesn't read
 *   as "view deleted" against a stale list) then the canonical list
 *   invalidates. Mirrors web `useCreateIssueView`.
 * - update: optimistic — rename / visibility / edits snap back into the bar
 *   the frame they're confirmed; the expected_revision guard stays server-
 *   enforced, so a 409 rolls the patch back and surfaces the conflict.
 * - delete: optimistic — the view leaves the bar immediately; rollback on
 *   error. Mirrors the tap-and-it's-gone phone expectation.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/data/api";
import type { IssueView } from "@multica/core/api/schemas";
import {
  issueViewKeys,
  type IssueViewScope,
} from "@/data/queries/issue-views";

export interface UpdateIssueViewInput {
  id: string;
  name?: string;
  visibility?: "private" | "workspace";
  scope_variant?: string | null;
  query?: Record<string, unknown>;
  display?: Record<string, unknown>;
  expected_revision: number;
}

/** Apply the defined fields of an update input to one cached view without
 *  advancing revision (the server bump arrives on success). */
export function applyViewUpdatePatch(
  view: IssueView,
  patch: Omit<UpdateIssueViewInput, "id" | "expected_revision">,
): IssueView {
  return {
    ...view,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
    ...(patch.scope_variant !== undefined
      ? { scope_variant: patch.scope_variant }
      : {}),
    ...(patch.query !== undefined ? { query: patch.query } : {}),
    ...(patch.display !== undefined ? { display: patch.display } : {}),
  };
}

/** Patch one view in a scope's cached list (used by optimistic update). */
export function patchViewInList(
  list: IssueView[] | undefined,
  id: string,
  patch: Omit<UpdateIssueViewInput, "id" | "expected_revision">,
): IssueView[] | undefined {
  if (!list) return list;
  return list.some((v) => v.id === id)
    ? list.map((v) => (v.id === id ? applyViewUpdatePatch(v, patch) : v))
    : list;
}

/** Replace one cached view wholesale with the server-confirmed value. */
export function replaceViewInList(
  list: IssueView[] | undefined,
  view: IssueView,
): IssueView[] | undefined {
  if (!list) return list;
  return list.some((v) => v.id === view.id)
    ? list.map((v) => (v.id === view.id ? view : v))
    : list;
}

/** Drop one view from a scope's cached list (used by optimistic delete). */
export function removeViewFromList(
  list: IssueView[] | undefined,
  id: string,
): IssueView[] | undefined {
  if (!list) return list;
  return list.filter((v) => v.id !== id);
}

/** Append a freshly-created view to its scope list (stale-list guard). */
export function appendViewToList(
  list: IssueView[] | undefined,
  view: IssueView,
): IssueView[] | undefined {
  return list && !list.some((v) => v.id === view.id)
    ? [...list, view]
    : list;
}

export function useCreateIssueView(wsId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof api.createIssueView>[0]) =>
      api.createIssueView(data),
    onSuccess: (created) => {
      if (!created || !wsId) return;
      // Seed the created view into its scope's list BEFORE invalidating:
      // callers activate it immediately, and an id absent from the (stale)
      // list reads as "view deleted" and bounces the surface back to the
      // default tab. The invalidate still fetches the canonical list.
      const scope: IssueViewScope = {
        scope_type: created.scope_type as IssueViewScope["scope_type"],
        scope_id: created.scope_id,
      };
      queryClient.setQueryData<IssueView[]>(
        issueViewKeys.list(wsId, scope),
        (old) => appendViewToList(old, created),
      );
      void queryClient.invalidateQueries({ queryKey: issueViewKeys.all(wsId) });
    },
  });
}

export function useUpdateIssueView(wsId: string | null, viewScope: IssueViewScope) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: UpdateIssueViewInput) =>
      api.updateIssueView(id, patch),
    onMutate: async ({ id, ...patch }: UpdateIssueViewInput) => {
      if (!wsId) return undefined;
      const key = issueViewKeys.list(wsId, viewScope);
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<IssueView[]>(key);
      const patchFields = {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
        ...(patch.scope_variant !== undefined
          ? { scope_variant: patch.scope_variant }
          : {}),
        ...(patch.query !== undefined ? { query: patch.query } : {}),
        ...(patch.display !== undefined ? { display: patch.display } : {}),
      };
      queryClient.setQueryData<IssueView[]>(key, (old) =>
        patchViewInList(old, id, patchFields),
      );
      return { key, prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.key && ctx.prev !== undefined) {
        queryClient.setQueryData(ctx.key, ctx.prev);
      }
    },
    onSuccess: (updated) => {
      if (!updated || !wsId) return;
      const key = issueViewKeys.list(wsId, viewScope);
      queryClient.setQueryData<IssueView[]>(key, (old) =>
        replaceViewInList(old, updated),
      );
    },
    onSettled: () => {
      if (!wsId) return;
      void queryClient.invalidateQueries({ queryKey: issueViewKeys.all(wsId) });
    },
  });
}

export function useDeleteIssueView(wsId: string | null, viewScope: IssueViewScope) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteIssueView(id),
    onMutate: async (id: string) => {
      if (!wsId) return undefined;
      const key = issueViewKeys.list(wsId, viewScope);
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<IssueView[]>(key);
      queryClient.setQueryData<IssueView[]>(key, (old) =>
        removeViewFromList(old, id),
      );
      return { key, prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.key && ctx.prev !== undefined) {
        queryClient.setQueryData(ctx.key, ctx.prev);
      }
    },
    onSettled: () => {
      if (!wsId) return;
      void queryClient.invalidateQueries({ queryKey: issueViewKeys.all(wsId) });
    },
  });
}