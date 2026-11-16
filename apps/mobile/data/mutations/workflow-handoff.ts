/**
 * Editing one column's handoff (MUL-7420, MYS-2889 follow-up) — the write
 * behind `WorkflowHandoffForm`, mirroring upstream's `useSetWorkflowHandoff`
 * (`packages/core/issue-workflows/mutations.ts:88`).
 *
 * ## Why this write's cache handling is not "invalidate everything"
 *
 * The switch (`project-workflow.ts`) invalidates four keys because it moves
 * issues between statuses. This one does not move anything — it changes who a
 * column hands the issue to on the NEXT entry. What it invalidates depends on
 * WHICH row the server answered with:
 *
 *   - **Scope 「所有项目」** → the same workflow row came back with new steps.
 *     Patching that one row in the cached list is enough, and it is what
 *     upstream does (`onSuccess` `setQueryData`). Invalidating instead would
 *     refetch every workflow for a change the client already holds.
 *   - **Scope 「只有这个项目」** → the server COPIED the workflow and repointed
 *     the project. A row the client has never seen now exists, the project's
 *     `workflow_id` changed, and every workflow's `project_ids` changed. None of
 *     that is inferable, so those keys are invalidated.
 *
 * Getting this backwards is visible either way: patching when a copy happened
 * leaves the project pointing at the old workflow on screen, and invalidating on
 * every plain save throws away the cache on an edit that did not need it.
 *
 * ## Failure
 *
 * The write reports through the shared channel (`WRITE_FAILURE_TITLE_KEY`), not
 * a hook-level `onError`: the editor sheet can be dismissed while the request
 * is in flight, and a hook-level handler goes silent with its observer
 * (`lib/write-failure.ts` states the rule). A refused write — 403 for a member
 * who is not the workflow's owner or a workspace admin — must not look like a
 * saved one.
 *
 * On failure the workflow list is invalidated rather than left alone: a refusal
 * is how the client learns its copy of the workflow was stale (someone else
 * changed the steps), and the next read is what corrects it. Upstream does the
 * same in `onError`.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  IssueWorkflow,
  ListIssueWorkflowsResponse,
  SetWorkflowHandoffRequest,
} from "@multica/core/types";
import { api } from "@/data/api";
import { issueKeys } from "@/data/queries/issue-keys";
import { projectKeys } from "@/data/queries/projects";
import { workflowKeys } from "@/data/queries/workflows";
import { useWorkspaceStore } from "@/data/workspace-store";
import { handoffSaveResultKind } from "@/lib/workflow-handoff-edit";
import { WRITE_FAILURE_TITLE_KEY } from "@/lib/write-failure";

export interface SetWorkflowHandoffVariables extends SetWorkflowHandoffRequest {
  workflowId: string;
  statusKey: string;
  /** Set when the user chose 「只有这个项目」 — the change lands on a copy. */
  copyForProjectId?: string;
}

/** What a successful save means for the cache. */
export type HandoffCacheEffect =
  | { kind: "patch"; workflow: IssueWorkflow }
  | { kind: "invalidateCopy"; copyProjectId: string };

/**
 * The cache effect of one save, as a pure decision.
 *
 * Split out so the Node lane can assert the two branches without a renderer —
 * and, more importantly, so the branch cannot be decided in two places (the
 * `onSuccess` body and a test would otherwise each re-derive it).
 *
 * The `copy` branch is chosen when EITHER the server answered with a different
 * workflow row OR the request carried `copyForProjectId`. Both signals are
 * checked because they can disagree on a drifted body: a copy request whose
 * answer failed to parse returns `EMPTY_ISSUE_WORKFLOW` (id `""`), and trusting
 * the id alone would then take the `patch` branch and overwrite the cache entry
 * of the workflow the user did NOT edit with an empty row.
 */
export function handoffCacheEffect(input: {
  editedWorkflowId: string;
  copyForProjectId: string | undefined;
  saved: IssueWorkflow | null | undefined;
}): HandoffCacheEffect | null {
  const copied =
    !!input.copyForProjectId ||
    handoffSaveResultKind({
      editedWorkflowId: input.editedWorkflowId,
      saved: input.saved,
    }) === "copy";
  if (copied) {
    // Without the project id there is nothing to repoint, so there is no
    // narrower effect to take — fall through to the full invalidate.
    return input.copyForProjectId
      ? { kind: "invalidateCopy", copyProjectId: input.copyForProjectId }
      : null;
  }
  // A missing id means the response body drifted; there is no row to patch.
  if (!input.saved?.id) return null;
  return { kind: "patch", workflow: input.saved };
}

/**
 * Replaces one workflow row in the cached list, keeping the list's own order.
 *
 * Order-preserving on purpose: the workflows list is rendered as the server
 * sent it (Default first, then named ones by creation), and a patch that
 * appended or re-sorted would reorder the project picker on every handoff save.
 * A row that is not in the cache is a no-op — the caller's invalidate covers it.
 */
export function patchWorkflowInList(
  old: ListIssueWorkflowsResponse | undefined,
  workflow: IssueWorkflow,
): ListIssueWorkflowsResponse | undefined {
  if (!old) return old;
  let found = false;
  const workflows = old.workflows.map((w) => {
    if (w.id !== workflow.id) return w;
    found = true;
    return workflow;
  });
  return found ? { ...old, workflows } : old;
}

/** The keys a copy-scope save invalidates, in one place for the wiring test. */
export function handoffCopyInvalidationKeys(
  wsId: string | null,
  projectId: string,
): readonly (readonly unknown[])[] {
  return [
    // A new workflow row exists and every row's `project_ids` changed.
    workflowKeys.all(wsId),
    // The project now points at the copy.
    projectKeys.list(wsId),
    projectKeys.detail(wsId, projectId),
    // The board's column badges resolve through the project's workflow.
    issueKeys.all(wsId),
  ];
}

export function useSetWorkflowHandoff() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationKey: ["setWorkflowHandoff"] as const,
    meta: {
      [WRITE_FAILURE_TITLE_KEY]: "workflow.handoff.saveFailed",
    },
    mutationFn: ({
      workflowId,
      statusKey,
      copyForProjectId,
      ...body
    }: SetWorkflowHandoffVariables) =>
      api.setWorkflowHandoff(workflowId, statusKey, body, copyForProjectId),
    onSuccess: (saved, { workflowId, copyForProjectId }) => {
      const effect = handoffCacheEffect({
        editedWorkflowId: workflowId,
        copyForProjectId,
        saved,
      });
      if (!effect) {
        // Nothing patchable came back (drifted body, or a copy with no project
        // to repoint). Invalidate rather than assume the write did nothing:
        // it may well have succeeded.
        void qc.invalidateQueries({ queryKey: workflowKeys.all(wsId) });
        return;
      }
      if (effect.kind === "invalidateCopy") {
        for (const queryKey of handoffCopyInvalidationKeys(wsId, effect.copyProjectId)) {
          void qc.invalidateQueries({ queryKey });
        }
        return;
      }
      qc.setQueryData<ListIssueWorkflowsResponse>(
        workflowKeys.list(wsId),
        (old) => patchWorkflowInList(old, effect.workflow),
      );
    },
    onError: () => {
      // A refusal means this client's copy of the workflow is stale.
      void qc.invalidateQueries({ queryKey: workflowKeys.all(wsId) });
    },
  });
}
