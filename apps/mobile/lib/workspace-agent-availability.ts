/**
 * Mobile-owned four-state availability for "does the current user have any
 * agent they can chat with in this workspace?".
 *
 * The states are `"loading" | "error" | "none" | "available"`. `"none"` is the
 * only one that may claim the workspace has no agents, and the only one that
 * may disable the chat composer.
 *
 * Why not three states (the previous `"loading" | "none" | "available"`): the
 * hook resolved from `isFetched`, which React Query defines as
 * `dataUpdateCount + errorUpdateCount > 0` — **a failure counts as fetched**.
 * One 30s timeout left both reads settled-but-empty, so the chat tab rendered
 * 「暂无可用智能体」 + 「请在更多 → 智能体中添加或启用智能体后开始聊天。」 over a
 * workspace that demonstrably had agents, and disabled the composer with the
 * reason 「此工作区中没有智能体」 — locking the main feature while sending the
 * user off to create something they already had. Nothing on that path retried.
 *
 * `isFetched` is the wrong primitive here because it answers "has this query
 * ever completed an attempt", not "do we know the answer". `isPending`/`isError`
 * answer the latter. The decision itself lives in `./agent-availability` so it
 * is unit-testable in the Node lane — see there for the full rationale and the
 * resolution order.
 *
 * Note this deviates from web's hook, which still uses `isFetched`: the bug is
 * shared, but only mobile gates the composer on the answer, so only mobile
 * needs the extra state to avoid locking an input box.
 */
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { agentListAllOptions } from "@/data/queries/agents";
import { memberListOptions } from "@/data/queries/members";
import {
  resolveWorkspaceAgentAvailability,
  type WorkspaceAgentAvailability,
} from "./agent-availability";

export type { WorkspaceAgentAvailability };

export interface WorkspaceAgentAvailabilityResult {
  availability: WorkspaceAgentAvailability;
  /** Re-runs both reads. Wire this to the failure's retry affordance — before
   *  this existed, a failed read left the chat screen with no way out but
   *  killing the app. */
  retry: () => void;
}

export function useWorkspaceAgentAvailability(): WorkspaceAgentAvailabilityResult {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const userId = useAuthStore((s) => s.user?.id);

  // Archived-inclusive, matching core's `agentListOptions` (which the web hook
  // reads). The `!a.archived_at` filter below is what excludes them, so the
  // answer is unchanged — and the chat screen shares this one cache entry with
  // its own agent lookup instead of issuing a second request.
  const agentsQuery = useQuery(agentListAllOptions(wsId));
  const membersQuery = useQuery(memberListOptions(wsId));

  const availability = resolveWorkspaceAgentAvailability({
    agents: agentsQuery.data,
    members: membersQuery.data,
    agentsPending: agentsQuery.isPending,
    membersPending: membersQuery.isPending,
    agentsError: agentsQuery.isError,
    membersError: membersQuery.isError,
    userId,
  });

  return {
    availability,
    retry: () => {
      void agentsQuery.refetch();
      void membersQuery.refetch();
    },
  };
}
