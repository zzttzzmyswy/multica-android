/**
 * Actor-profile card derivation (iteration 179, G14). Parity targets:
 * `packages/views/members/member-profile-card.tsx`,
 * `packages/views/agents/components/agent-profile-card.tsx` and
 * `packages/views/squads/components/squad-profile-card.tsx`.
 */
import { describe, expect, it } from "vitest";
import type { Agent, MemberWithUser, Squad } from "@multica/core/types";
import {
  countLabelKey,
  ownedAgentsOf,
  squadMemberRows,
  visibleWithOverflow,
} from "./actor-profile";

function agent(
  id: string,
  name: string,
  ownerId: string | null,
  archived = false,
): Agent {
  return {
    id,
    name,
    owner_id: ownerId,
    archived_at: archived ? "2026-01-01T00:00:00Z" : null,
  } as unknown as Agent;
}

function member(userId: string, name: string): MemberWithUser {
  return { user_id: userId, name } as unknown as MemberWithUser;
}

function squad(overrides: Partial<Squad>): Squad {
  return {
    id: "sq1",
    name: "Squad",
    leader_id: "a1",
    member_count: 0,
    member_preview: [],
    ...overrides,
  } as unknown as Squad;
}

describe("ownedAgentsOf", () => {
  it("keeps only live agents owned by the user", () => {
    const agents = [
      agent("a1", "Alpha", "u1"),
      agent("a2", "Beta", "u2"),
      agent("a3", "Gamma", "u1", true),
      agent("a4", "Delta", null),
    ];
    expect(ownedAgentsOf(agents, "u1", []).map((a) => a.id)).toEqual(["a1"]);
  });

  it("sorts by 30-day run count descending", () => {
    const agents = [
      agent("a1", "Alpha", "u1"),
      agent("a2", "Beta", "u1"),
      agent("a3", "Gamma", "u1"),
    ];
    const counts = [
      { agent_id: "a1", run_count: 3 },
      { agent_id: "a2", run_count: 9 },
      { agent_id: "a3", run_count: 5 },
    ];
    expect(ownedAgentsOf(agents, "u1", counts).map((a) => a.id)).toEqual([
      "a2",
      "a3",
      "a1",
    ]);
  });

  it("breaks run-count ties on name ascending", () => {
    const agents = [
      agent("a1", "zeta", "u1"),
      agent("a2", "alpha", "u1"),
      agent("a3", "Mid", "u1"),
    ];
    const counts = [
      { agent_id: "a1", run_count: 4 },
      { agent_id: "a2", run_count: 4 },
      { agent_id: "a3", run_count: 4 },
    ];
    expect(ownedAgentsOf(agents, "u1", counts).map((a) => a.name)).toEqual([
      "alpha",
      "Mid",
      "zeta",
    ]);
  });

  it("treats a missing run count as zero, not as an exclusion", () => {
    const agents = [agent("a1", "Alpha", "u1"), agent("a2", "Beta", "u1")];
    const counts = [{ agent_id: "a2", run_count: 2 }];
    expect(ownedAgentsOf(agents, "u1", counts).map((a) => a.id)).toEqual([
      "a2",
      "a1",
    ]);
  });

  it("returns nothing when the user owns nothing", () => {
    expect(ownedAgentsOf([agent("a1", "Alpha", "u2")], "u1", [])).toEqual([]);
  });
});

describe("visibleWithOverflow", () => {
  it("splits at the limit and reports the remainder", () => {
    expect(visibleWithOverflow([1, 2, 3, 4, 5], 2)).toEqual({
      visible: [1, 2],
      overflow: 3,
    });
  });

  it("reports no overflow at or below the limit", () => {
    expect(visibleWithOverflow([1, 2], 2)).toEqual({
      visible: [1, 2],
      overflow: 0,
    });
  });
});

describe("squadMemberRows", () => {
  it("takes the first three previews and counts overflow from member_count", () => {
    const s = squad({
      member_count: 7,
      member_preview: [
        { member_type: "agent", member_id: "a1", role: "" },
        { member_type: "member", member_id: "u2", role: "" },
        { member_type: "agent", member_id: "a3", role: "" },
        { member_type: "member", member_id: "u4", role: "" },
      ],
    });
    const rows = squadMemberRows(s, [], []);
    expect(rows.visible).toHaveLength(3);
    expect(rows.overflow).toBe(4);
  });

  it("falls back to member_count when member_preview is absent", () => {
    const s = squad({ member_count: 2, member_preview: undefined });
    const rows = squadMemberRows(s, [], []);
    expect(rows.visible).toEqual([]);
    expect(rows.overflow).toBe(2);
  });

  it("never reports negative overflow when previews outrun member_count", () => {
    const s = squad({
      member_count: 1,
      member_preview: [
        { member_type: "agent", member_id: "a1", role: "" },
        { member_type: "agent", member_id: "a2", role: "" },
        { member_type: "agent", member_id: "a3", role: "" },
        { member_type: "agent", member_id: "a4", role: "" },
      ],
    });
    expect(squadMemberRows(s, [], []).overflow).toBe(0);
  });

  it("marks only an agent whose id is the leader as the leader", () => {
    const s = squad({
      leader_id: "a2",
      member_count: 3,
      member_preview: [
        { member_type: "agent", member_id: "a2", role: "" },
        // A *member* carrying the leader's id is not the leader — web gates
        // the chip on member_type === "agent" as well (`:136-137`).
        { member_type: "member", member_id: "a2", role: "" },
        { member_type: "agent", member_id: "a3", role: "" },
      ],
    });
    expect(squadMemberRows(s, [], []).visible.map((r) => r.isLeader)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("resolves agent and member names from their lists", () => {
    const s = squad({
      member_count: 2,
      member_preview: [
        { member_type: "agent", member_id: "a1", role: "" },
        { member_type: "member", member_id: "u2", role: "" },
      ],
    });
    const rows = squadMemberRows(
      s,
      [agent("a1", "Mika", "u9")],
      [member("u2", "Zeta")],
    );
    expect(rows.visible.map((r) => r.name)).toEqual(["Mika", "Zeta"]);
  });

  it("falls back to the id prefix when a member cannot be resolved", () => {
    const s = squad({
      member_count: 2,
      member_preview: [
        { member_type: "agent", member_id: "abcdefgh-1234", role: "" },
        { member_type: "member", member_id: "ijklmnop-5678", role: "" },
      ],
    });
    const rows = squadMemberRows(s, [], []);
    expect(rows.visible.map((r) => r.name)).toEqual(["abcdefgh", "ijklmnop"]);
  });

  it("keys rows by type + id so a member and an agent can share an id", () => {
    const s = squad({
      member_count: 2,
      member_preview: [
        { member_type: "agent", member_id: "x", role: "" },
        { member_type: "member", member_id: "x", role: "" },
      ],
    });
    const keys = squadMemberRows(s, [], []).visible.map((r) => r.key);
    expect(new Set(keys).size).toBe(2);
  });

  it("routes an agent row by agent id and a member row by membership id", () => {
    const s = squad({
      member_count: 2,
      member_preview: [
        { member_type: "agent", member_id: "a1", role: "" },
        { member_type: "member", member_id: "u2", role: "" },
      ],
    });
    const rows = squadMemberRows(
      s,
      [agent("a1", "Mika", "u9")],
      [{ user_id: "u2", id: "m2", name: "Zeta" } as unknown as MemberWithUser],
    );
    expect(rows.visible.map((r) => r.detailId)).toEqual(["a1", "m2"]);
  });

  it("leaves detailId null for a member it cannot resolve", () => {
    const s = squad({
      member_count: 1,
      member_preview: [{ member_type: "member", member_id: "ghost", role: "" }],
    });
    expect(squadMemberRows(s, [], []).visible[0].detailId).toBeNull();
  });
});

describe("countLabelKey", () => {
  it("picks the singular key at one", () => {
    expect(countLabelKey("profileCard.moreAgents", 1)).toBe(
      "profileCard.moreAgents_one",
    );
  });

  it("picks the plural key everywhere else", () => {
    expect(countLabelKey("profileCard.moreAgents", 0)).toBe(
      "profileCard.moreAgents_other",
    );
    expect(countLabelKey("profileCard.moreAgents", 2)).toBe(
      "profileCard.moreAgents_other",
    );
  });
});
