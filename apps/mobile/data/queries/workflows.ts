/**
 * Workspace workflow queries (MUL-7420) — the read half of the status-scope
 * work in `lib/workflow-status-scope.ts`.
 *
 * ## Why the failure state is carried, not swallowed
 *
 * Every other list query in this app folds "no data" and "read failed" into
 * the same empty fallback, and for most of them that is defensible: an empty
 * list of labels renders as "no labels", which is wrong but visible.
 *
 * This one is different. The consumer asks "which statuses may this issue be
 * moved to", and the honest answer when the read failed is *unknown* — not
 * "all of them". Folding failure into `[]` would silently restore exactly the
 * defect this round removes: a status picker offering columns the server
 * refuses. So the hook surfaces `state` alongside the data, and the picker is
 * obliged to say the list is unverified instead of presenting it as complete.
 *
 * The failure is still not a blocking error: the picker stays usable (a
 * control with no options at all would be worse than an optimistic one), it
 * just stops claiming to be authoritative.
 *
 * ## Cache policy
 *
 * Workflows change only when an owner or admin edits one, so a 5-minute stale
 * time keeps this off the critical path of every status control. The server
 * publishes `issue_workflow:changed` on edits; `invalidateWorkflows` is what a
 * realtime subscriber calls for it. Nothing subscribes yet — mobile has no
 * workflow-management surface, so nothing on the phone can cause the event —
 * but the invalidation entry point exists rather than being rediscovered later.
 */
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ListIssueWorkflowsResponse } from "@multica/core/types";
import { api } from "@/data/api";
import { useWorkspaceStore } from "@/data/workspace-store";
import type { WorkflowReadState } from "@/lib/workflow-status-scope";

export const workflowKeys = {
  all: (wsId: string | null) => ["issue-workflows", wsId] as const,
  list: (wsId: string | null) => [...workflowKeys.all(wsId), "list"] as const,
};

export function workflowListOptions(wsId: string | null) {
  return queryOptions({
    queryKey: workflowKeys.list(wsId),
    queryFn: ({ signal }) => api.listIssueWorkflows({ signal }),
    select: (data: ListIssueWorkflowsResponse) => data.workflows,
    // Workflows change only when an admin edits one; `issue_workflow:changed`
    // is what refreshes an open client.
    staleTime: 5 * 60_000,
    enabled: !!wsId,
  });
}

/**
 * The workspace's workflows, with the read's state preserved.
 *
 * `workflows` is `undefined` while the first read is in flight and after a
 * failure — the difference is `state`, and callers must read it. `refetch`
 * is exposed so an error surface can offer a retry without remounting.
 */
export function useIssueWorkflows(wsId: string | null): {
  workflows: Awaited<ReturnType<typeof api.listIssueWorkflows>>["workflows"] | undefined;
  state: WorkflowReadState;
  refetch: () => void;
} {
  const query = useQuery(workflowListOptions(wsId));
  const state: WorkflowReadState =
    query.isError && !query.data
      ? "failed"
      : query.data
        ? "ready"
        : "pending";
  return {
    // Deliberately `data`, never `data ?? []`: an empty array is the claim
    // "this workspace has no workflows", which only a successful read earns.
    workflows: query.data,
    state,
    refetch: () => {
      void query.refetch();
    },
  };
}

/** Refresh every workflow query for the workspace after an edit. */
export function useInvalidateWorkflows() {
  const qc = useQueryClient();
  return (wsId: string | null) => {
    if (!wsId) return;
    qc.invalidateQueries({ queryKey: workflowKeys.all(wsId) });
  };
}

/**
 * The workspace store's current id, as the workflow hooks want it.
 *
 * Exists so a status surface reads one hook instead of reaching into the store
 * for each query it composes.
 */
export function useWorkflowWorkspaceId(): string | null {
  return useWorkspaceStore((s) => s.currentWorkspaceId);
}
