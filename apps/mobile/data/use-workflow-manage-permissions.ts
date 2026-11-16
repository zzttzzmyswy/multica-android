/**
 * Who may manage workflows (iteration 294) — web's `useWorkflowPermissions`
 * (`packages/views/workflows/permissions.ts:19`) as a mobile hook.
 *
 * ## Three answers, and why they cannot be one
 *
 *   - **`canCreate`** — any member may create a workflow. It is the row that
 *     makes 「新建工作流」 appear for everyone, even though almost nothing else
 *     on this screen is theirs to do.
 *   - **`canEdit(workflow)`** — the workflow's owner or a workspace admin. Per
 *     workflow, not per screen: a member who created one workflow may edit
 *     that one and no other, so a screen-level boolean would show them edit
 *     affordances on rows the server refuses with 403.
 *   - **`canCreateStatus`** — admins only, because statuses are shared by every
 *     board. Separate from `canEdit` on purpose: an owner who is not an admin
 *     may rebuild their pipeline's columns out of the EXISTING library but may
 *     not add a new status to the workspace (`status_create_forbidden`).
 *
 * The predicates themselves live in `lib/project-workflow.ts` (pure, tested);
 * this hook only supplies the three facts — the user id from the auth store,
 * the ROLE from the member list, and the workflow from the caller.
 *
 * ## Why `roleResolved` is exposed
 *
 * While the roster is in flight `role` is null, so `canEditWorkflow` answers
 * from the owner branch alone. That is correct behaviour (an owner keeps their
 * affordance and gains nothing), but it is NOT the same as "you may not edit".
 * A surface that wants to SAY so must wait for `roleResolved`, or it tells an
 * admin they lack permission for as long as the member list takes to load.
 */
import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { IssueWorkflow } from "@multica/core/types";
import { useAuthStore } from "@/data/auth-store";
import { memberListOptions } from "@/data/queries/members";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  canCreateWorkflow,
  canEditWorkflow,
} from "@/lib/project-workflow";

const ADMIN_ROLES = new Set<string>(["owner", "admin"]);

export interface WorkflowManagePermissions {
  /** Any member may create a workflow (`canCreateWorkflow: !!role`). */
  canCreate: boolean;
  /** Per-workflow: its owner or a workspace admin. */
  canEdit: (workflow: Pick<IssueWorkflow, "owner_id"> | null | undefined) => boolean;
  /** Admins only: adding a status to the shared catalog. */
  canCreateStatus: boolean;
  /** Whether the role read has answered — see the module doc. */
  roleResolved: boolean;
}

export function useWorkflowManagePermissions(): WorkflowManagePermissions {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { data: members, isPending, isError } = useQuery(memberListOptions(wsId));

  const role = members?.find((m) => m.user_id === userId)?.role ?? null;

  const canEdit = useCallback(
    (workflow: Pick<IssueWorkflow, "owner_id"> | null | undefined) =>
      canEditWorkflow({ workflow, currentUserId: userId, currentRole: role }),
    [userId, role],
  );

  return useMemo(
    () => ({
      canCreate: canCreateWorkflow(role),
      canEdit,
      canCreateStatus: !!role && ADMIN_ROLES.has(role),
      roleResolved: !isPending && !isError && !!members,
    }),
    [role, canEdit, isPending, isError, members],
  );
}
