/**
 * The handoff preview query (MUL-7420, MYS-2743) — `GET
 * /api/issues/{id}/workflow-handoff`, read once immediately before the write
 * it describes.
 *
 * ## Why this is not just `useQuery(...)` at the call site
 *
 * The answer decides whether a status change is applied silently or shown for
 * confirmation, and it depends on facts that move under it (the issue's
 * assignee, its agent's live runs). Two consequences:
 *
 *  - **`staleTime: 0`** — a cached answer describes an agent that may have
 *    finished since. Upstream sets the same, for the same reason.
 *  - **Failure is carried, not swallowed.** Every other read in this app folds
 *    a failure into an empty fallback; here that fallback means "there is no
 *    handoff", and the caller would then reassign silently — the exact defect
 *    this iteration removes. So the hook reports `state` alongside the data and
 *    the dialog refuses to confirm on `"failed"`.
 *
 * ## When it runs
 *
 * `enabled` is the caller's `open` flag: no request fires until the user
 * actually picks a column. That keeps every status picker in the app off the
 * network for work it may never do — the same reason upstream's dialog is
 * query-gated on `open`.
 */
import { queryOptions, useQuery } from "@tanstack/react-query";
import type { WorkflowHandoffPreview } from "@multica/core/types";
import { api } from "@/data/api";
import { useWorkspaceStore } from "@/data/workspace-store";
import type { WorkflowReadState } from "@/lib/workflow-status-scope";

export const handoffKeys = {
  all: (wsId: string | null) => ["issue-workflows", wsId] as const,
  preview: (
    wsId: string | null,
    issueId: string,
    status: string,
    projectId: string,
  ) => [...handoffKeys.all(wsId), "handoff-preview", issueId, status, projectId] as const,
};

/**
 * The preview for one (issue, target) pair.
 *
 * The key carries `status` AND `projectId` so switching between two columns
 * refetches instead of reusing the other column's answer; `staleTime: 0`
 * means even a repeat of the same pair re-reads. `gcTime` is short — the
 * answer is only useful for the dialog currently on screen.
 *
 * `enabled: false` (no issue) reports `pending`, never a fabricated answer.
 */
export function handoffPreviewOptions(input: {
  wsId: string | null;
  issueId: string | null;
  status: string;
  projectId?: string | null;
  enabled: boolean;
}) {
  const { wsId, issueId, status, projectId, enabled } = input;
  return queryOptions({
    queryKey: handoffKeys.preview(wsId, issueId ?? "", status, projectId ?? ""),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api.previewWorkflowHandoff(issueId ?? "", status, projectId ?? undefined, { signal }),
    staleTime: 0,
    gcTime: 30_000,
    enabled: enabled && !!issueId && !!wsId,
  });
}

/**
 * The preview plus its read state, for a dialog that must not guess.
 *
 * `preview` is `undefined` while the first read is in flight AND after a
 * failure — the difference is `state`, and callers must read it. `refetch` is
 * exposed so the dialog's error state can offer a retry without remounting the
 * sheet.
 */
export function useHandoffPreview(input: {
  issueId: string | null;
  status: string;
  projectId?: string | null;
  enabled: boolean;
}): {
  preview: WorkflowHandoffPreview | undefined;
  state: WorkflowReadState;
  refetch: () => void;
} {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const query = useQuery(handoffPreviewOptions({ wsId, ...input }));
  const state: WorkflowReadState =
    query.isError && !query.data ? "failed" : query.data ? "ready" : "pending";
  return {
    // Deliberately `data`, never `data ?? EMPTY`: "there is no handoff" is a
    // claim only a successful read earns.
    preview: query.data,
    state,
    refetch: () => {
      void query.refetch();
    },
  };
}
