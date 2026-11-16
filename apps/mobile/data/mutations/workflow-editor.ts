/**
 * Managing workflows (iteration 294, MUL-7420) — the writes behind the
 * workflow editor and the list page's delete, mirroring upstream's
 * `useCreateIssueWorkflow` / `useUpdateIssueWorkflow` / `useDeleteIssueWorkflow`
 * (`packages/core/issue-workflows/mutations.ts:24-56`).
 *
 * ## Why every one of these invalidates, where a handoff save patches
 *
 * Iteration 293's handoff write patches the ONE row the server answered with,
 * because that write changes a single row and cannot move an issue. These three
 * are different in exactly that respect:
 *
 *   - **create** — a row the cache has never seen, and the list's order is the
 *     server's (`Default` first, then by creation);
 *   - **update** — the edit can REMOVE columns, and the server remaps issues
 *     off them (`remapIssues`, `issue_workflow.go:800`). Issues change status,
 *     their wakeups can be cancelled, and every project's board columns follow.
 *     Patching the workflow row would leave the boards showing issues in
 *     columns that no longer exist;
 *   - **delete** — a row disappears, and `project_ids` on the others can change.
 *
 * So all three invalidate the workflow list plus the issue lists. Doing this in
 * `onSettled` rather than `onSuccess` is deliberate and mirrors upstream: a
 * REFUSED edit is how this client learns its copy of the workflow was stale
 * (someone else changed the steps), and the next read is what corrects it.
 *
 * ## The dry run is not a mutation
 *
 * `dryRunIssueWorkflowUpdate` lives on the API object and is called directly by
 * the screen, not through `useMutation`. It writes nothing, it is asked once
 * immediately before the write it previews, and caching it would let a stale
 * plan describe a workflow that changed underneath it — the same reasoning as
 * `dryRunProjectWorkflow` (`data/api.ts`).
 *
 * ## Failure reporting
 *
 * Create and update report through the shared channel
 * (`WRITE_FAILURE_TITLE_KEY`), which is enough: the editor stays open on
 * failure and keeps the draft, so the alert is a report rather than the only
 * trace. Delete is the exception — its two expected refusals are already
 * prevented on screen (`deleteBlocked`), and the caller confirms through an
 * `Alert` before sending, so a failure there needs its own sentence; it carries
 * the permission line too, because losing ownership of a workflow between
 * opening the menu and confirming is a real race.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { IssueWorkflowWriteRequest } from "@multica/core/types";
import { api } from "@/data/api";
import { issueKeys } from "@/data/queries/issue-keys";
import { projectKeys } from "@/data/queries/projects";
import { workflowKeys } from "@/data/queries/workflows";
import { useWorkspaceStore } from "@/data/workspace-store";
import { WRITE_FAILURE_PERMISSION_KEY, WRITE_FAILURE_TITLE_KEY } from "@/lib/write-failure";

/**
 * The keys an edit or a delete invalidates, in one place so the wiring test can
 * assert the set without re-deriving it from the hook body.
 *
 * `workflowKeys.all` covers the list AND every workflow-scoped query derived
 * from it (the handoff previews). `issueKeys.all` is the part that is easy to
 * miss: an edit that removes a column really does move issues, and the board,
 * the swimlane and the issue list all read `issue.status`.
 */
export function workflowWriteInvalidationKeys(
  wsId: string | null,
): readonly (readonly unknown[])[] {
  return [workflowKeys.all(wsId), issueKeys.all(wsId)];
}

/**
 * Projects' cached rows carry `workflow_id`, which changes when a workflow is
 * deleted (they fall back to Default) — so a delete also invalidates them.
 * Split from the edit case above on purpose: a rename moves no project.
 */
export function workflowDeleteInvalidationKeys(
  wsId: string | null,
): readonly (readonly unknown[])[] {
  return [...workflowWriteInvalidationKeys(wsId), projectKeys.list(wsId)];
}

export function useCreateIssueWorkflow() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationKey: ["createIssueWorkflow"] as const,
    meta: {
      [WRITE_FAILURE_TITLE_KEY]: "workflow.editor.createFailed",
    },
    mutationFn: (body: IssueWorkflowWriteRequest) => api.createIssueWorkflow(body),
    onSettled: () => {
      for (const queryKey of workflowWriteInvalidationKeys(wsId)) {
        void qc.invalidateQueries({ queryKey });
      }
    },
  });
}

export interface UpdateIssueWorkflowVariables extends IssueWorkflowWriteRequest {
  id: string;
}

export function useUpdateIssueWorkflow() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationKey: ["updateIssueWorkflow"] as const,
    meta: {
      [WRITE_FAILURE_TITLE_KEY]: "workflow.editor.saveFailed",
    },
    mutationFn: ({ id, ...body }: UpdateIssueWorkflowVariables) =>
      api.updateIssueWorkflow(id, body),
    onSettled: () => {
      for (const queryKey of workflowWriteInvalidationKeys(wsId)) {
        void qc.invalidateQueries({ queryKey });
      }
    },
  });
}

export function useDeleteIssueWorkflow() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationKey: ["deleteIssueWorkflow"] as const,
    meta: {
      [WRITE_FAILURE_TITLE_KEY]: "workflow.settings.deleteFailed",
      // A 403 is an expected answer here — ownership can change between the
      // menu opening and the confirm — and the server's own body ("only the
      // workflow owner and workspace admins…") is written for a caller.
      [WRITE_FAILURE_PERMISSION_KEY]: "workflow.settings.deleteForbidden",
    },
    mutationFn: (id: string) => api.deleteIssueWorkflow(id),
    onSettled: () => {
      for (const queryKey of workflowDeleteInvalidationKeys(wsId)) {
        void qc.invalidateQueries({ queryKey });
      }
    },
  });
}
