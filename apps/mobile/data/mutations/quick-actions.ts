/**
 * Quick-action mutations (iteration-52) — create / update / delete. Mirrors
 * packages/core/quick-actions/mutations.ts bound to mobile's ApiClient and
 * workspace store. No optimistic patching: the server canonicalizes values
 * (position, prompt trim, derived visibility, last_used_at) and the settings
 * rows render from the refetched catalog, so a round-trip is acceptable.
 *
 * `useRunQuickAction` (iteration-94) is the issue-sidebar run path: posting
 * to /api/issues/:id/quick-actions/:qaid/run returns a Comment whose
 * `trigger_outcomes[0]` tells the UI what actually happened (queued /
 * coalesced / deferred / blocked). The sidebar row needs the resolved
 * Comment to paint an honest outcome, so it awaits mutateAsync. A successful
 * run moves last_used_at/use_count server-side and lands a new comment +
 * task card client-side, hence the settle invalidation of the timeline, the
 * task list and the quick-action catalog.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  Comment,
  CreateQuickActionRequest,
  UpdateQuickActionRequest,
} from "@multica/core/types";
import { api } from "@/data/api";
import { quickActionKeys } from "@/data/queries/quick-actions";
import { issueKeys } from "@/data/queries/issue-keys";
import { useWorkspaceStore } from "@/data/workspace-store";

export function useCreateQuickAction() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (data: CreateQuickActionRequest) =>
      api.createQuickAction(data),
    onSettled: () => {
      if (!wsId) return;
      void qc.invalidateQueries({ queryKey: quickActionKeys.all(wsId) });
    },
  });
}

export function useUpdateQuickAction() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: { id: string } & UpdateQuickActionRequest) =>
      api.updateQuickAction(id, data),
    onSettled: () => {
      if (!wsId) return;
      void qc.invalidateQueries({ queryKey: quickActionKeys.all(wsId) });
    },
  });
}

export function useDeleteQuickAction() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (id: string) => api.deleteQuickAction(id),
    onSettled: () => {
      if (!wsId) return;
      void qc.invalidateQueries({ queryKey: quickActionKeys.all(wsId) });
    },
  });
}

/** Run a quick action against one issue (MYS-680). Returns the resolved
 *  Comment so the caller can read `trigger_outcomes[0]` and report an honest
 *  result instead of a generic "done". Mirrors web's useRunQuickAction
 *  (packages/core/quick-actions/mutations.ts:65). */
export function useRunQuickAction(issueId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation<Comment, Error, { quickActionId: string }>({
    mutationFn: ({ quickActionId }) =>
      api.runQuickAction(issueId, quickActionId),
    onSettled: () => {
      if (!wsId) return;
      // New comment card + execution-log entry + catalog counters.
      void qc.invalidateQueries({ queryKey: issueKeys.timeline(wsId, issueId) });
      void qc.invalidateQueries({ queryKey: issueKeys.tasks(wsId, issueId) });
      void qc.invalidateQueries({ queryKey: quickActionKeys.all(wsId) });
    },
  });
}
