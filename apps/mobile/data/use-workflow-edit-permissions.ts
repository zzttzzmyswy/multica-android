/**
 * Who may edit a workflow's handoffs (MUL-7420, MYS-2889 follow-up).
 *
 * The two predicates live in `lib/project-workflow.ts` (pure, tested); this
 * hook supplies the three facts they need, which come from three places in this
 * app — the auth store for the user id, the member list for the ROLE, and the
 * caller for the workflow. Web reads the same three (`permissions.ts:29-33`).
 *
 * ## Why the role's read state is exposed
 *
 * `canEditWorkflow` needs the role, and the role comes from the member list.
 * While that read is in flight `role` is null, so the predicate answers from the
 * owner branch alone — a workflow's owner keeps their edit affordance, and
 * everyone else gains theirs a moment later. That is correct behaviour but it
 * is NOT the same as "you may not edit": a surface that wants to SAY so must
 * wait for `roleResolved`, or it will tell an admin they lack permission for as
 * long as the roster takes to load.
 *
 * Same shape and same reasoning as `useProjectWorkflowPermissions`, which is
 * the neighbouring question ("may this member switch the project's binding").
 * Kept as a separate hook rather than folded into that one because the two
 * answers differ for the same person: a project lead may switch a workflow but
 * still not edit someone else's.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { IssueWorkflow } from "@multica/core/types";
import { useAuthStore } from "@/data/auth-store";
import { memberListOptions } from "@/data/queries/members";
import { useWorkspaceStore } from "@/data/workspace-store";
import { canEditWorkflow } from "@/lib/project-workflow";

export interface WorkflowEditPermissions {
  /** Whether this member may change the workflow's handoffs. */
  canEdit: boolean;
  /** Whether the role read has answered — see the module doc. */
  roleResolved: boolean;
}

export function useWorkflowEditPermissions(
  workflow: Pick<IssueWorkflow, "owner_id"> | null | undefined,
): WorkflowEditPermissions {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { data: members, isPending, isError } = useQuery(memberListOptions(wsId));

  return useMemo(() => {
    const role = members?.find((m) => m.user_id === userId)?.role ?? null;
    return {
      canEdit: canEditWorkflow({
        workflow,
        currentUserId: userId,
        currentRole: role,
      }),
      roleResolved: !isPending && !isError && !!members,
    };
  }, [members, userId, workflow, isPending, isError]);
}
