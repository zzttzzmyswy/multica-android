/**
 * Project access mutations (MUL-8472) — mirrors `packages/core/projects/
 * access.ts` in the deployed web baseline.
 *
 * ## Three changes, three endpoints
 *
 * Upstream's `AccessChange` union is not cosmetic. Switching visibility is a
 * whole-list replace (`PUT /api/projects/{id}` carrying the complete
 * `member_ids`); adding and removing touch exactly one row each
 * (`POST /members`, `DELETE /members/{userId}`). Collapsing all three into the
 * PUT would write a stale member list over whatever another client added
 * between the read and the write — a lost update that looks like nothing
 * happened.
 *
 * ## Cache invalidation is deliberately broad
 *
 * A visibility change can add OR remove a whole project from the viewer's own
 * lists, so both the project caches and the issue caches are invalidated. The
 * issue half matters: an issue's visibility is its project's, so a project
 * flipping to private can make the viewer's own issue lists (inbox, my-issues,
 * project surfaces) shorter or longer. Upstream invalidates both
 * (`issueKeys.all`); leaving issues stale would show rows that a refetch drops.
 *
 * Targeted invalidation of the three project keys is intentional rather than a
 * blanket `projectKeys.all`: the members query lives under `detail/{id}/members`
 * and is refetched by the same prefix, so one invalidate covers the list, the
 * detail and the member rows.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ProjectVisibility } from "@multica/core/types";
import { api } from "@/data/api";
import { projectKeys } from "@/data/queries/projects";
import { issueKeys } from "@/data/queries/issues";
import { useWorkspaceStore } from "@/data/workspace-store";

export type ProjectAccessChange =
  | { type: "visibility"; visibility: ProjectVisibility; memberIds: string[] }
  | { type: "add"; userId: string }
  | { type: "remove"; userId: string };

/**
 * The wire half, as a pure function of (api, projectId, change).
 *
 * Split out from the hook so the endpoint choice is testable without a
 * renderer — this repo's vitest lane is Node-only (`vitest.config.ts`), and the
 * one thing that must never drift here is WHICH endpoint each change goes to.
 * A hook body can be read wrong; a recorded call cannot.
 */
export async function sendProjectAccessChange(
  client: Pick<typeof api, "updateProject" | "addProjectMembers" | "removeProjectMember">,
  projectId: string,
  change: ProjectAccessChange,
): Promise<void> {
  if (change.type === "visibility") {
    await client.updateProject(projectId, {
      visibility: change.visibility,
      member_ids: change.memberIds,
    });
    return;
  }
  if (change.type === "add") {
    await client.addProjectMembers(projectId, [change.userId]);
    return;
  }
  await client.removeProjectMember(projectId, change.userId);
}

/**
 * Every cache family an access change can invalidate.
 *
 * Both halves are required. The project family covers the row's own
 * `visibility` and the member list; the ISSUE family covers the fact that an
 * issue's visibility is its project's, so a project turning private changes
 * which issues the viewer's own lists (inbox, my-issues, project surfaces) may
 * contain. Invalidating only the first leaves rows on screen that a refetch
 * would drop.
 */
export function projectAccessInvalidationKeys(wsId: string | null) {
  return [projectKeys.all(wsId), issueKeys.all(wsId)];
}

export function useProjectAccessMutation(projectId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationKey: ["projectAccess", projectId] as const,
    mutationFn: (change: ProjectAccessChange) =>
      sendProjectAccessChange(api, projectId, change),
    onSettled: async () => {
      // Settled, not success: a rejected write can still have been applied
      // server-side (a timeout after the commit), and a cache that keeps
      // claiming the old visibility is the more dangerous of the two errors.
      await Promise.all(
        projectAccessInvalidationKeys(wsId).map((queryKey) =>
          qc.invalidateQueries({ queryKey }),
        ),
      );
    },
  });
}
