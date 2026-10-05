import { describe, expect, it } from "vitest";
import type { Agent } from "@multica/core/types";
import { resolveWorkspaceAgentAvailability } from "./agent-availability";

/**
 * The chat tab asks one question — "does this user have an agent they can chat
 * with in this workspace?" — and answers it from two directory reads: the
 * agent list and the member list (membership decides whether an agent is
 * reachable at all).
 *
 * The answer used to be resolved from `isFetched`, which React Query defines as
 * `dataUpdateCount + errorUpdateCount > 0`. A **failure counts as fetched**. So
 * one 30s timeout left both queries "fetched" with `data: undefined`, the
 * `(agents ?? [])` fold produced zero visible agents, and the chat screen
 * declared 「暂无可用智能体」 over a workspace full of them — then, because
 * mobile gates the composer on that same value, **disabled the input box** with
 * the reason 「此工作区中没有智能体」. The main feature was locked by a network
 * blip and the only advice offered was to go create an agent the user already
 * had. There was no retry anywhere on that path.
 *
 * So failure needs its own answer, and only a *settled* read may state the
 * absence. Both directions are pinned here:
 *
 *   - a failed read is never `none` (the reported bug), and
 *   - a settled read that really holds zero usable agents is still `none`
 *     (the banner's existing, correct behaviour).
 *
 * Resolution order, mirroring `resolveCatalogState`:
 *
 *   1. A positive answer wins outright — one reachable agent is enough to
 *      chat, and a background refetch that fails on top of data already in
 *      hand must not blank a working composer.
 *   2. `error` outranks `loading`, for the same reason
 *      `unsettledCatalogStatus` ranks it that way: a spinner drawn over a
 *      request that already failed hides both the failure and its retry.
 *   3. `loading` is the honest "nothing has resolved yet".
 *   4. `none` — both reads settled, and there is genuinely no agent to talk to.
 */

const WS = "ws-1";
const ME = "user-me";

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    workspace_id: WS,
    archived_at: null,
    visibility: "workspace",
    owner_id: null,
    ...overrides,
  } as Agent;
}

const MEMBER = { user_id: ME, role: "member" as const };

function base(
  overrides: Partial<
    Parameters<typeof resolveWorkspaceAgentAvailability>[0]
  > = {},
) {
  return {
    agents: [agent()],
    members: [MEMBER],
    agentsPending: false,
    agentsError: false,
    membersPending: false,
    membersError: false,
    userId: ME,
    ...overrides,
  };
}

describe("workspace agent availability", () => {
  describe("a settled read", () => {
    it("is available when one agent is visible to the caller", () => {
      expect(resolveWorkspaceAgentAvailability(base())).toBe("available");
    });

    it("is none when the workspace really has no agents", () => {
      expect(resolveWorkspaceAgentAvailability(base({ agents: [] }))).toBe(
        "none",
      );
    });

    it("is none when every agent is archived", () => {
      expect(
        resolveWorkspaceAgentAvailability(
          base({ agents: [agent({ archived_at: "2026-01-01T00:00:00Z" })] }),
        ),
      ).toBe("none");
    });

    it("is none when a private agent belongs to someone else", () => {
      expect(
        resolveWorkspaceAgentAvailability(
          base({
            agents: [
              agent({ visibility: "private", owner_id: "user-someone-else" }),
            ],
          }),
        ),
      ).toBe("none");
    });

    it("is available for a private agent the caller owns", () => {
      expect(
        resolveWorkspaceAgentAvailability(
          base({ agents: [agent({ visibility: "private", owner_id: ME })] }),
        ),
      ).toBe("available");
    });

    it("is none when the caller is not a workspace member", () => {
      // `canAssignAgent` reads the membership to decide reachability, so an
      // empty member list settles the question rather than leaving it open.
      expect(
        resolveWorkspaceAgentAvailability(base({ members: [] })),
      ).toBe("none");
    });
  });

  describe("a read that failed", () => {
    // The regression. `isFetched` was true here (errorUpdateCount > 0) and
    // `data` was undefined, so the old resolver answered "none" — a false
    // claim about the workspace that also disabled the composer.
    it("is never none when the agent list failed", () => {
      const state = resolveWorkspaceAgentAvailability(
        base({ agents: undefined, agentsError: true }),
      );
      expect(state).not.toBe("none");
      expect(state).toBe("error");
    });

    it("is never none when the member list failed", () => {
      const state = resolveWorkspaceAgentAvailability(
        base({ agents: [], members: undefined, membersError: true }),
      );
      expect(state).not.toBe("none");
      expect(state).toBe("error");
    });
  });

  describe("a read that has not settled", () => {
    it("is loading while the agent list is in flight", () => {
      expect(
        resolveWorkspaceAgentAvailability(
          base({ agents: undefined, agentsPending: true }),
        ),
      ).toBe("loading");
    });

    it("is loading while the member list is in flight", () => {
      expect(
        resolveWorkspaceAgentAvailability(
          base({ agents: [], members: undefined, membersPending: true }),
        ),
      ).toBe("loading");
    });

    it("is loading — not none — on the first paint of an empty workspace", () => {
      // Otherwise the banner flashes for the few hundred ms before the list
      // lands, which is why this was three-state in the first place.
      expect(
        resolveWorkspaceAgentAvailability(
          base({
            agents: undefined,
            members: undefined,
            agentsPending: true,
            membersPending: true,
          }),
        ),
      ).toBe("loading");
    });
  });

  it("names the failure when one read failed and the other is still in flight", () => {
    // A spinner over a failed request hides the failure *and* its retry, so the
    // retry affordance would never be reachable.
    expect(
      resolveWorkspaceAgentAvailability(
        base({
          agents: undefined,
          members: undefined,
          agentsError: true,
          membersPending: true,
        }),
      ),
    ).toBe("error");
  });

  describe("a positive answer outranks a failed refetch", () => {
    // React Query keeps the last good `data` when a *background* refetch fails,
    // so both lists can be present while `isError` is true. The answer is
    // already known in that case; downgrading it to `error` would blank a
    // composer that was working a second ago.
    it("stays available when the lists are in hand and a refetch failed", () => {
      expect(
        resolveWorkspaceAgentAvailability(
          base({ agentsError: true, membersError: true }),
        ),
      ).toBe("available");
    });

    it("stays none when the lists are in hand, empty, and a refetch failed", () => {
      // Cached-but-empty plus a failure is still not evidence of a populated
      // workspace, so this is `error` — but the point is that it is not a
      // *silent* none either way; `none` requires a settled read with no error.
      expect(
        resolveWorkspaceAgentAvailability(
          base({ agents: [], agentsError: true }),
        ),
      ).toBe("error");
    });
  });
});
