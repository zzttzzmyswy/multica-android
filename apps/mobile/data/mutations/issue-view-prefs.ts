/**
 * View-bar preference mutation (iteration-67). Mirrors web
 * `packages/core/issue-views/preferences.ts useUpdateIssueViewPreference`:
 * whole-document upsert with an optimistic patch — show/hide toggles and
 * reorder are the canonical optimistic case (locally predictable, same
 * screen, trivial rollback).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/data/api";
import type { IssueViewPreference } from "@multica/core/api/schemas";
import {
  type IssueViewScope,
} from "@/data/queries/issue-views";
import {
  issueViewPrefKeys,
  type ViewBarPrefs,
} from "@/data/queries/issue-view-prefs";

export function useUpdateIssueViewPreference(
  wsId: string | null,
  scope: IssueViewScope,
) {
  const queryClient = useQueryClient();
  const queryKey = issueViewPrefKeys.scope(wsId, scope);
  return useMutation({
    mutationFn: (prefs: ViewBarPrefs) =>
      api.putIssueViewPreference({ ...scope, prefs }),
    onMutate: async (prefs) => {
      await queryClient.cancelQueries({ queryKey });
      const previous =
        queryClient.getQueryData<IssueViewPreference>(queryKey);
      const optimistic: IssueViewPreference = {
        scope_type: scope.scope_type,
        scope_id: scope.scope_id ?? null,
        updated_at: previous?.updated_at ?? "",
        prefs: { ...prefs },
      };
      queryClient.setQueryData<IssueViewPreference>(queryKey, optimistic);
      return { previous };
    },
    onError: (_err, _prefs, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
    },
    onSettled: () => {
      if (!wsId) return;
      void queryClient.invalidateQueries({ queryKey });
    },
  });
}