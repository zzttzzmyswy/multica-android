/**
 * Mobile-owned three-state availability for "does the current user have any
 * agent they can chat with in this workspace?".
 *
 * Mirror of `packages/core/agents/use-workspace-agent-availability.ts` —
 * see there for the design rationale on why this is a three-state
 * `"loading" | "none" | "available"` instead of a boolean.
 *
 * The chat NoAgentBanner uses this: only `"none"` triggers the banner +
 * input-disable; `"loading"` stays neutral to avoid a fake-empty flash on
 * mount.
 */
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { agentListAllOptions } from "@/data/queries/agents";
import { memberListOptions } from "@/data/queries/members";
import { canAssignAgent } from "./can-assign-agent";

export type WorkspaceAgentAvailability = "loading" | "none" | "available";

export function useWorkspaceAgentAvailability(): WorkspaceAgentAvailability {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const userId = useAuthStore((s) => s.user?.id);

  // Archived-inclusive, matching core's `agentListOptions` (which the web hook
  // reads). The `!a.archived_at` filter below is what excludes them, so the
  // answer is unchanged — and the chat screen shares this one cache entry with
  // its own agent lookup instead of issuing a second request.
  const { data: agents, isFetched: agentsFetched } = useQuery(
    agentListAllOptions(wsId),
  );
  const { data: members, isFetched: membersFetched } = useQuery(
    memberListOptions(wsId),
  );

  if (!agentsFetched || !membersFetched) return "loading";

  const memberRole = members?.find((m) => m.user_id === userId)?.role;

  const hasVisibleAgent = (agents ?? []).some(
    (a) => !a.archived_at && canAssignAgent(a, userId, memberRole),
  );

  return hasVisibleAgent ? "available" : "none";
}
