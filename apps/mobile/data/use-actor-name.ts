import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceStore } from "@/data/workspace-store";
import { memberListOptions } from "@/data/queries/members";
import { agentListAllOptions } from "@/data/queries/agents";
import { squadListOptions } from "@/data/queries/squads";
import { catalogRead } from "@/lib/catalog-read";
import {
  actorNameState,
  type ActorNameState,
  type ActorReadiness,
  type ActorType,
} from "@/lib/actor-name-state";

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
  const membersRead = catalogRead(useQuery(memberListOptions(wsId)));
  const agentsRead = catalogRead(useQuery(agentListAllOptions(wsId)));
  const squadsRead = catalogRead(useQuery(squadListOptions(wsId)));
  const members = membersRead.items;
  const agents = agentsRead.items;
  const squads = squadsRead.items;

  // Whether each directory a name can come from has ANSWERED, keyed by the
  // actor type it answers for. A surface that renders an actor's name as a
  // fact needs this: `getName` falls back to "Unknown" / "Unknown Agent" both
  // when the read is still in flight and when the id is genuinely gone, and
  // those two must not be told the same way (the read-side rule
  // `lib/catalog-state.ts` states).
  //
  // Per TYPE rather than one combined flag, because the combined form makes a
  // surface wait on a directory it cannot use: a run row only ever draws
  // agents, so requiring the members read would blank agent names whenever the
  // member list is slow. Iteration 253 shipped the combined form for the
  // projects list's lead cell, which is the one surface that genuinely needs
  // both (a lead is a member or an agent) — hence `resolved` below, kept as
  // exactly that surface's gate.
  const resolvedBy: ActorReadiness = useMemo(
    () => ({
      member: membersRead.isResolved,
      agent: agentsRead.isResolved,
      squad: squadsRead.isResolved,
    }),
    [membersRead.isResolved, agentsRead.isResolved, squadsRead.isResolved],
  );

  // The projects list's gate: a lead can point at either directory, so that
  // cell may only state its lead once both have answered. Squads are excluded
  // on purpose — no `Project.lead_type` ever names a squad
  // (`packages/core/types/project.ts:13`), so requiring it would make the lead
  // cell wait on a read it cannot use.
  const resolved = resolvedBy.member && resolvedBy.agent;

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

  // `getName`'s read-state-aware twin. `getName` answers "what string do I
  // have for this actor right now"; this answers "may I state it as a fact
  // yet" — the distinction the issue table's assignee / creator columns and
  // every other name-rendering cell needs (`lib/actor-name-state.ts`). Same
  // memo discipline as `getName`: rows pass it to memoised children.
  const resolveActorName = useCallback(
    (
      type: ActorType | string | null | undefined,
      id: string | null | undefined,
    ): ActorNameState => {
      // The raw row, read straight off the maps rather than through `getName`:
      // the decision needs "is there a row", not "what string did the fallback
      // produce", and routing it through `getName` would make the `gone`
      // branch depend on the exact sentinel wording.
      const name =
        !id || (type !== "member" && type !== "agent" && type !== "squad")
          ? ""
          : (type === "member"
              ? maps.members.get(id)
              : type === "agent"
                ? maps.agents.get(id)
                : maps.squads.get(id)
            )?.name ?? "";

      return actorNameState({ type, id, name, readiness: resolvedBy });
    },
    [maps, resolvedBy],
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

  return { getName, getAvatarUrl, resolveActorName, resolved, resolvedBy };
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
