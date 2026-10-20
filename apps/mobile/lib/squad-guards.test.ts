import { describe, expect, it } from "vitest";
import {
  availableSquadCandidates,
  squadManageGuards,
  squadMemberActionGuards,
  squadMemberRoleField,
} from "./squad-guards";

describe("squadManageGuards", () => {
  const currentUserId = "u-current";

  it("workspace owner can manage any squad", () => {
    const canManage = squadManageGuards({
      currentRole: "owner",
      currentUserId,
      squad: { creator_id: "u-other" },
    });
    expect(canManage).toBe(true);
  });

  it("workspace admin can manage any squad", () => {
    const canManage = squadManageGuards({
      currentRole: "admin",
      currentUserId,
      squad: { creator_id: "u-other" },
    });
    expect(canManage).toBe(true);
  });

  it("creator regular member can manage their own squad", () => {
    const canManage = squadManageGuards({
      currentRole: "member",
      currentUserId,
      squad: { creator_id: currentUserId },
    });
    expect(canManage).toBe(true);
  });

  it("non-creator regular member cannot manage", () => {
    const canManage = squadManageGuards({
      currentRole: "member",
      currentUserId,
      squad: { creator_id: "u-other" },
    });
    expect(canManage).toBe(false);
  });

  it("guards are conservative while squad/role are unknown", () => {
    const canManage = squadManageGuards({
      currentRole: null,
      currentUserId,
      squad: null,
    });
    expect(canManage).toBe(false);
  });

  it("unknown current user never manages (creator scope fallback)", () => {
    const canManage = squadManageGuards({
      currentRole: null,
      currentUserId: null,
      squad: { creator_id: "u-other" },
    });
    expect(canManage).toBe(false);
  });
});

describe("squadMemberActionGuards", () => {
  const currentUserId = "u-current";

  it("manager can remove a normal agent member", () => {
    const g = squadMemberActionGuards({
      canManage: true,
      currentUserId,
      leaderId: "a-leader",
      target: { member_type: "agent", member_id: "a-worker" },
    });
    expect(g).toEqual({ canRemove: true, canSetLeader: true, canEditRole: true });
  });

  it("the leader of an agent squad cannot be removed nor re-promoted", () => {
    const g = squadMemberActionGuards({
      canManage: true,
      currentUserId,
      leaderId: "a-leader",
      target: { member_type: "agent", member_id: "a-leader" },
    });
    expect(g).toEqual({ canRemove: false, canSetLeader: false, canEditRole: true });
  });

  it("a human member cannot be promoted to leader", () => {
    const g = squadMemberActionGuards({
      canManage: true,
      currentUserId,
      leaderId: "a-leader",
      target: { member_type: "member", member_id: "u-other" },
    });
    expect(g).toEqual({ canRemove: true, canSetLeader: false, canEditRole: true });
  });

  it("self-removal is blocked (self-protection)", () => {
    const g = squadMemberActionGuards({
      canManage: true,
      currentUserId,
      leaderId: "a-leader",
      target: { member_type: "member", member_id: currentUserId },
    });
    expect(g).toEqual({ canRemove: false, canSetLeader: false, canEditRole: true });
  });

  it("non-managers see no destructive/leader actions", () => {
    const g = squadMemberActionGuards({
      canManage: false,
      currentUserId,
      leaderId: "a-leader",
      target: { member_type: "agent", member_id: "a-worker" },
    });
    expect(g).toEqual({ canRemove: false, canSetLeader: false, canEditRole: false });
  });

  it("missing target never offers actions", () => {
    const g = squadMemberActionGuards({
      canManage: true,
      currentUserId,
      leaderId: "a-leader",
      target: null,
    });
    expect(g).toEqual({ canRemove: false, canSetLeader: false, canEditRole: false });
  });

  it("unknown leaderId is treated as no leader (removal stays allowed)", () => {
    const g = squadMemberActionGuards({
      canManage: true,
      currentUserId,
      leaderId: null,
      target: { member_type: "agent", member_id: "a-worker" },
    });
    expect(g).toEqual({ canRemove: true, canSetLeader: true, canEditRole: true });
  });
});
describe("squadMemberActionGuards: archived members", () => {
  const base = {
    canManage: true,
    currentUserId: "u-current",
    leaderId: "ag-leader",
  };
  const target = { member_type: "agent" as const, member_id: "ag-2" };

  it("keeps remove available for an archived agent member", () => {
    // Web's remove clause has no archived term (squad-detail-page.tsx:1272) —
    // removing it is the FIX for an archived row, so hiding it would strand
    // the row in the roster with no way out.
    expect(
      squadMemberActionGuards({ ...base, target, targetArchived: true }).canRemove,
    ).toBe(true);
  });

  it("hides make-leader for an archived agent member", () => {
    // Web squad-detail-page.tsx:1254 requires `!isArchived(m)`: promoting an
    // archived agent would head the squad with something that cannot run.
    expect(
      squadMemberActionGuards({ ...base, target, targetArchived: true })
        .canSetLeader,
    ).toBe(false);
  });

  it("still offers make-leader for a live agent member", () => {
    expect(
      squadMemberActionGuards({ ...base, target, targetArchived: false })
        .canSetLeader,
    ).toBe(true);
  });

  it("treats an unread agent directory as not-archived", () => {
    // A caller that has not resolved the agent yet keeps today's behaviour
    // rather than losing the action it used to show.
    expect(squadMemberActionGuards({ ...base, target }).canSetLeader).toBe(true);
  });

  it("never applies the archived clause to a human member", () => {
    // `targetArchived` is only meaningful for agents; a member row carries no
    // archived flag in either client.
    expect(
      squadMemberActionGuards({
        ...base,
        target: { member_type: "member", member_id: "u-other" },
        targetArchived: true,
      }),
    ).toEqual({ canRemove: true, canSetLeader: false, canEditRole: true });
  });
});

describe("availableSquadCandidates", () => {
  const agents = [
    { id: "ag-live", archived_at: null },
    { id: "ag-archived", archived_at: "2026-01-01T00:00:00Z" },
    { id: "ag-member", archived_at: null },
  ];
  const members = [{ user_id: "u-1" }, { user_id: "u-2" }];

  it("drops archived agents and everyone already in the squad", () => {
    // Web squad-detail-page.tsx:189.
    const out = availableSquadCandidates({
      agents,
      members,
      current: new Set(["agent:ag-member", "member:u-1"]),
    });
    expect(out.agents.map((a) => a.id)).toEqual(["ag-live"]);
    expect(out.members.map((m) => m.user_id)).toEqual(["u-2"]);
  });

  it("does not archived-filter human members", () => {
    // Web has no archived concept for members (squad-detail-page.tsx:190) —
    // filtering them here would hide real people from the picker.
    const out = availableSquadCandidates({
      agents: [],
      members,
      current: new Set(),
    });
    expect(out.members).toHaveLength(2);
  });

  it("keys the exclusion by member_type so an agent and a member id never collide", () => {
    const out = availableSquadCandidates({
      agents: [{ id: "shared", archived_at: null }],
      members: [{ user_id: "shared" }],
      current: new Set(["agent:shared"]),
    });
    expect(out.agents).toHaveLength(0);
    expect(out.members).toHaveLength(1);
  });
});

describe("squadMemberRoleField", () => {
  it("omits the field entirely when no role was typed", () => {
    // Web writes `role: ""`, which reads back as "a role is set but empty" on
    // every later client. The request type makes the field optional for this
    // reason (AddSquadMemberRequest.role?).
    expect(squadMemberRoleField("")).toEqual({});
    expect(squadMemberRoleField("   ")).toEqual({});
    expect(squadMemberRoleField(null)).toEqual({});
    expect(squadMemberRoleField(undefined)).toEqual({});
  });

  it("trims and keeps a real role", () => {
    expect(squadMemberRoleField("  Reviewer ")).toEqual({ role: "Reviewer" });
  });
});

describe("squadMemberActionGuards: the server's own archived judgement", () => {
  const base = {
    canManage: true,
    currentUserId: "u-current",
    leaderId: "ag-leader",
  };

  it("hides make-leader when the squad status says archived, even with no directory row", () => {
    // The bug on-device verification caught: `agentListOptions` EXCLUDES
    // archived agents, so `targetArchived` from the directory is always false
    // for the one member that matters. The roster's 「已归档」 pill reads the
    // squad status endpoint, so the guard has to read it too or the two
    // contradict each other on screen.
    expect(
      squadMemberActionGuards({
        ...base,
        target: { member_type: "agent", member_id: "ag-retired" },
        targetArchived: false,
        targetStatus: "archived",
      }).canSetLeader,
    ).toBe(false);
  });

  it("still allows remove for that same archived member", () => {
    expect(
      squadMemberActionGuards({
        ...base,
        target: { member_type: "agent", member_id: "ag-retired" },
        targetStatus: "archived",
      }).canRemove,
    ).toBe(true);
  });

  it("does not treat a live status as archived", () => {
    for (const status of ["idle", "working", "offline", "unstable"] as const) {
      expect(
        squadMemberActionGuards({
          ...base,
          target: { member_type: "agent", member_id: "ag-2" },
          targetStatus: status,
        }).canSetLeader,
      ).toBe(true);
    }
  });

  it("contributes nothing when the status has not been read (null)", () => {
    // Humans come back with `status: null`; a guard that read null as
    // archived would silently strip a human's actions.
    expect(
      squadMemberActionGuards({
        ...base,
        target: { member_type: "member", member_id: "u-other" },
        targetStatus: null,
      }).canEditRole,
    ).toBe(true);
  });
});
