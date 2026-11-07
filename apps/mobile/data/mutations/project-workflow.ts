/**
 * Project-workflow mutations (MUL-7420, MYS-2690) — the write that binds a
 * project to a workflow, mirroring upstream's `useSetProjectWorkflow`
 * (`packages/core/issue-workflows/mutations.ts:53`).
 *
 * ## Why this write invalidates four caches rather than patching one
 *
 * A switch is not a field edit. In one transaction the server changes the
 * project row, moves issues between statuses, and rewrites which projects each
 * workflow reports as using it. So, exactly as upstream does in `onSettled`:
 *
 *   - `projectKeys.detail` / `projectKeys.list` — `workflow_id` changed, and
 *     the project detail page's Workflow row reads it;
 *   - `workflowKeys.all` — every workflow row's `project_ids` changed, so the
 *     picker's "Used by: …" line is stale for TWO workflows (the one left and
 *     the one joined);
 *   - `issueKeys.all` — the remapped issues are on new statuses, and the
 *     project's list, board and swimlane must re-render their columns.
 *
 * Invalidation rather than an optimistic patch, and in `onSettled` rather than
 * `onSuccess`: the moved issues are the server's answer, not something the
 * client can predict (it depends on the mapping the user chose and on issues
 * that changed since the dry run). Invalidating on failure too is deliberate —
 * a refused switch is how the client learns its copy of the plan was stale, and
 * the next read is what corrects it.
 *
 * ## Failure reporting
 *
 * The hook reports its own failures, so it carries
 * `WRITE_FAILURE_HANDLED_KEY` and the shared channel stays silent for it. That
 * is not a shortcut — it is required here, because this write has a failure the
 * shared channel cannot express: `409 workflow_status_mapping_required` carries
 * a PLAN the caller must turn into a dialog. A generic alert would either
 * double-report it or hide it.
 *
 * The obligation that flag creates is real, so the caller's contract is narrow:
 * every caller passes an `onError` and reports EVERY failure path — see
 * `handleSwitchFailure` below, which is the reporting decision written once so
 * the route cannot accidentally drop it.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SetProjectWorkflowRequest } from "@multica/core/types";
import { api } from "@/data/api";
import { projectKeys } from "@/data/queries/projects";
import { issueKeys } from "@/data/queries/issue-keys";
import { workflowKeys } from "@/data/queries/workflows";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  WRITE_FAILURE_HANDLED_KEY,
  WRITE_FAILURE_TITLE_KEY,
} from "@/lib/write-failure";

export interface SetProjectWorkflowVariables extends SetProjectWorkflowRequest {
  projectId: string;
}

/** The cache keys a switch invalidates, in one place so the wiring test can
 *  assert the set without re-deriving it from the hook body. */
export function projectWorkflowInvalidationKeys(
  wsId: string | null,
  projectId: string,
): readonly (readonly unknown[])[] {
  return [
    projectKeys.list(wsId),
    projectKeys.detail(wsId, projectId),
    workflowKeys.all(wsId),
    issueKeys.all(wsId),
  ];
}

export function useSetProjectWorkflow(projectId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationKey: ["setProjectWorkflow", projectId] as const,
    meta: {
      [WRITE_FAILURE_TITLE_KEY]: "workflow.project.switchFailed",
      // This hook reports its own failures — see the module doc. The caller's
      // `onError` must therefore cover every path, not only the refusal.
      [WRITE_FAILURE_HANDLED_KEY]: true,
    },
    mutationFn: ({ projectId: id, ...body }: SetProjectWorkflowVariables) =>
      api.setProjectWorkflow(id, body),
    onSettled: () => {
      for (const queryKey of projectWorkflowInvalidationKeys(wsId, projectId)) {
        void qc.invalidateQueries({ queryKey });
      }
    },
  });
}
