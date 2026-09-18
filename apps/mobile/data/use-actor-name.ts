import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceStore } from "@/data/workspace-store";
import { memberListOptions } from "@/data/queries/members";
import { agentListAllOptions } from "@/data/queries/agents";
import { squadListOptions } from "@/data/queries/squads";

/**
 * Resolve actor (member / agent / squad) name + avatar URL from the
 * workspace lists. Mirrors packages/core/workspace/hooks.ts useActorName.
 *
 * Returns synchronous lookup helpers — they read whatever is in the TQ
 * cache. If the lists haven't loaded yet, lookups return null/initials
 * fallback; the row will re-render once data arrives.
 *
 * The agent list is the **archived-inclusive** one. Core's `agentListOptions`
 * — which `useActorName` reads — already passes `include_archived: true`, and
 * a retired agent still has to render its own name and avatar wherever it
 * appears in history (chat session rows, old comments, activity rows).
 * Resolving from the archived-free list degraded every one of those to an
 * initials chip.
 */
export function useActorLookup() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const { data: agents = [] } = useQuery(agentListAllOptions(wsId));
  const { data: squads = [] } = useQuery(squadListOptions(wsId));

  // Index the three lists once per data change. Avatar rows (inbox, issue
  // rows, run rows, comment cards) call name + avatar lookups per render —
  // `.find()` over each list per call is O(N) on the hot path middle of a
  // scroll. Maps make both lookups O(1). Costs one build per data change,
  // which happens far less often than a render pass.
  const maps = useMemo(
    () => ({
      members: new Map(members.map((m) => [m.user_id, m])),
      agents: new Map(agents.map((a) => [a.id, a])),
      squads: new Map(squads.map((s) => [s.id, s])),
    }),
    [members, agents, squads],
  );

  // Both helpers are memoised on `maps` so their identity is stable across
  // renders. Rows hand `getName` straight to memoised children (issue table
  // rows, chat rows, run rows), and a fresh function per render would defeat
  // every one of those memo checks — the cheapest fix is here, once.
  const getName = useCallback(
    (
      type: "member" | "agent" | "squad" | null | undefined,
      id: string | null | undefined,
    ): string => {
      if (!type || !id) return "System";
      if (type === "member") {
        return maps.members.get(id)?.name ?? "Unknown";
      }
      if (type === "agent") {
        return maps.agents.get(id)?.name ?? "Unknown Agent";
      }
      return maps.squads.get(id)?.name ?? "Squad";
    },
    [maps],
  );

  const getAvatarUrl = useCallback(
    (
      type: "member" | "agent" | "squad" | null | undefined,
      id: string | null | undefined,
    ): string | null => {
      if (!type || !id) return null;
      if (type === "member") {
        return maps.members.get(id)?.avatar_url ?? null;
      }
      if (type === "agent") {
        return maps.agents.get(id)?.avatar_url ?? null;
      }
      return maps.squads.get(id)?.avatar_url ?? null;
    },
    [maps],
  );

  return { getName, getAvatarUrl };
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .join("")
    .toUpperCase()
    .slice(0, 2);
}
