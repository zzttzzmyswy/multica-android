import { describe, expect, it } from "vitest";
import { squadManageGuards, squadMemberActionGuards } from "./squad-guards";

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