/**
 * Who the workflow surface is acting as (MUL-7420, MYS-2690).
 *
 * `canManageProjectWorkflow` (`lib/project-workflow.ts`) needs three facts, and
 * they come from three places in this app:
 *
 *   - the current user's id — the auth store;
 *   - the current user's ROLE — their own row in the workspace member list,
 *     which is the only place a role is published (the same source web reads:
 *     `members.find(m => m.user_id === userId)?.role`, `permissions.ts:29`);
 *   - the project — passed in by the caller.
 *
 * Kept as a hook of its own rather than inlined into the property row, because
 * the row is one of two places that asks (the picker sheet asks too), and the
 * role lookup is a directory read that should not be re-derived per surface.
 *
 * The role is `null` until the member list answers. That is NOT the same as
 * "member": the guard treats a null role as "not an admin" and then falls back
 * to the project-lead branch, which is decided entirely from the project row.
 * So a lead keeps their manage affordance while the roster is loading, and a
 * plain member simply gains it a moment later — never a false positive.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/data/auth-store";
import { memberListOptions } from "@/data/queries/members";
import { useWorkspaceStore } from "@/data/workspace-store";
import type { Project } from "@multica/core/types";
import { canManageProjectWorkflow } from "@/lib/project-workflow";

export interface ProjectWorkflowPermissions {
  /** Whether the current member may change this project's workflow binding. */
  canManageProject: boolean;
  /** Whether the role read has answered. Until it has, `canManageProject` is
   *  the lead branch only — a surface that wants to say "you may not" should
   *  wait for this rather than assert during the read. */
  roleResolved: boolean;
}

export function useProjectWorkflowPermissions(
  project: Pick<Project, "lead_type" | "lead_id"> | null | undefined,
): ProjectWorkflowPermissions {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { data: members, isPending, isError } = useQuery(memberListOptions(wsId));

  return useMemo(() => {
    const role = members?.find((m) => m.user_id === userId)?.role ?? null;
    return {
      canManageProject: canManageProjectWorkflow({
        project,
        currentUserId: userId,
        currentRole: role,
      }),
      roleResolved: !isPending && !isError && !!members,
    };
  }, [members, userId, project, isPending, isError]);
}
