import { describe, expect, it } from "vitest";
import { memberManageGuards, roleChangeOptions } from "./member-guards";

describe("memberManageGuards", () => {
  const currentUserId = "u-current";

  it("owner can manage a normal member (not self)", () => {
    const g = memberManageGuards({
      currentRole: "owner",
      currentUserId,
      target: { user_id: "u-other", role: "member" },
    });
    expect(g.canEditRole).toBe(true);
    expect(g.canRemove).toBe(true);
  });

  it("admin can manage a normal member (not self)", () => {
    const g = memberManageGuards({
      currentRole: "admin",
      currentUserId,
      target: { user_id: "u-other", role: "member" },
    });
    expect(g.canEditRole).toBe(true);
    expect(g.canRemove).toBe(true);
  });

  it("self is untouchable even when the current user would otherwise manage", () => {
    for (const currentRole of ["owner", "admin"] as const) {
      const g = memberManageGuards({
        currentRole,
        currentUserId,
        target: { user_id: currentUserId, role: "admin" },
      });
      expect(g.canEditRole).toBe(false);
      expect(g.canRemove).toBe(false);
    }
  });

  it("plain member sees no management at all", () => {
    const g = memberManageGuards({
      currentRole: "member",
      currentUserId,
      target: { user_id: "u-other", role: "member" },
    });
    expect(g.canEditRole).toBe(false);
    expect(g.canRemove).toBe(false);
  });

  it("guards are conservative while role/self are unknown (list not loaded)", () => {
    const g = memberManageGuards({
      currentRole: null,
      currentUserId,
      target: { user_id: "u-other", role: "member" },
    });
    expect(g.canEditRole).toBe(false);
    expect(g.canRemove).toBe(false);
  });

  it("missing target (member not found) never offers management", () => {
    const g = memberManageGuards({
      currentRole: "owner",
      currentUserId,
      target: null,
    });
    expect(g.canEditRole).toBe(false);
    expect(g.canRemove).toBe(false);
  });
});

// Iteration 129 (MYS-1060): mobile used to freeze every owner target. That
// exclusion (MYS-303) is lifted — the sheet now carries the owner option and
// mirrors web's two extra rules (members-tab.tsx:100-103,152-155), which in
// turn mirror the server (server/internal/handler/workspace.go:660-680).
describe("memberManageGuards — owner targets", () => {
  const currentUserId = "u-current";

  it("only an owner may manage an owner", () => {
    const g = memberManageGuards({
      currentRole: "owner",
      currentUserId,
      target: { user_id: "u-owner", role: "owner" },
    });
    expect(g.canManageOwners).toBe(true);
    expect(g.canEditRole).toBe(true);
    expect(g.canRemove).toBe(true);
  });

  it("an admin cannot touch an owner (server: 403)", () => {
    const g = memberManageGuards({
      currentRole: "admin",
      currentUserId,
      target: { user_id: "u-owner", role: "owner" },
    });
    expect(g.canManageOwners).toBe(false);
    expect(g.canEditRole).toBe(false);
    expect(g.canRemove).toBe(false);
  });

  it("self-owner is still untouchable", () => {
    const g = memberManageGuards({
      currentRole: "owner",
      currentUserId,
      target: { user_id: currentUserId, role: "owner" },
    });
    expect(g.canEditRole).toBe(false);
    expect(g.canRemove).toBe(false);
  });

  it("canManageOwners is owner-only, and never true for unknown/self role", () => {
    for (const [currentRole, expected] of [
      ["owner", true],
      ["admin", false],
      ["member", false],
      [null, false],
    ] as const) {
      const g = memberManageGuards({
        currentRole,
        currentUserId,
        target: { user_id: "u-other", role: "member" },
      });
      expect(g.canManageOwners).toBe(expected);
    }
  });

  it("last owner cannot be demoted, but a non-last owner can", () => {
    const lastOwner = memberManageGuards({
      currentRole: "owner",
      currentUserId,
      target: { user_id: "u-owner", role: "owner" },
      ownerCount: 1,
    });
    expect(lastOwner.wouldDemoteLastOwner).toBe(true);

    const notLastOwner = memberManageGuards({
      currentRole: "owner",
      currentUserId,
      target: { user_id: "u-owner", role: "owner" },
      ownerCount: 2,
    });
    expect(notLastOwner.wouldDemoteLastOwner).toBe(false);
  });

  it("demoting a non-owner is never a last-owner demotion", () => {
    const g = memberManageGuards({
      currentRole: "owner",
      currentUserId,
      target: { user_id: "u-admin", role: "admin" },
      ownerCount: 1,
    });
    expect(g.wouldDemoteLastOwner).toBe(false);
  });
});

describe("roleChangeOptions", () => {
  it("an owner sees all three roles in owner/admin/member order", () => {
    expect(roleChangeOptions({ canManageOwners: true })).toEqual([
      "owner",
      "admin",
      "member",
    ]);
  });

  it("an admin does not see the owner option (server would 403)", () => {
    expect(roleChangeOptions({ canManageOwners: false })).toEqual([
      "admin",
      "member",
    ]);
  });
});
