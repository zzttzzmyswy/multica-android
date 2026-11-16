/**
 * Who the access surface is acting as (MUL-8472, MYS-2915).
 *
 * The same three facts `useProjectWorkflowPermissions` gathers — user id, the
 * user's role from the workspace directory, and the project — feeding the
 * access rules instead of the workflow ones. Kept separate rather than
 * generalised: the two predicates read DIFFERENT project fields (`visibility`
 * here, `lead_type`/`lead_id` there), and one hook returning both would make
 * every caller pay for a read it does not use.
 *
 * `roleResolved` is the same idea as the workflow hook's: until the roster
 * answers, `canManageProject` reflects the lead branch only. A surface that
 * wants to say "you may not" must wait for this, or it accuses an admin during
 * a read it has not finished.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Project } from "@multica/core/types";
import { useAuthStore } from "@/data/auth-store";
import { memberListOptions } from "@/data/queries/members";
import { useWorkspaceStore } from "@/data/workspace-store";
import { canManageProjectAccess } from "@/lib/project-access";

export interface ProjectAccessPermissions {
  /** Whether the current member may change this project's visibility or the
   *  lead of a private project. */
  canManageProject: boolean;
  /** Whether the role read has answered. */
  roleResolved: boolean;
}

export function useProjectAccessPermissions(
  project: Pick<Project, "lead_type" | "lead_id" | "visibility"> | null | undefined,
): ProjectAccessPermissions {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { data: members, isPending, isError } = useQuery(memberListOptions(wsId));

  return useMemo(() => {
    const role = members?.find((m) => m.user_id === userId)?.role ?? null;
    return {
      canManageProject: canManageProjectAccess(
        project ?? { lead_type: null, lead_id: null },
        userId,
        role,
      ),
      roleResolved: !isPending && !isError && !!members,
    };
  }, [members, userId, project, isPending, isError]);
}
