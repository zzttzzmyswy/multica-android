import { describe, expect, it } from "vitest";
import { memberManageGuards } from "./member-guards";

describe("memberManageGuards", () => {
  const currentUserId = "u-current";

  it("owner can manage a normal member (not self)", () => {
    const g = memberManageGuards({
      currentRole: "owner",
      currentUserId,
      target: { user_id: "u-other", role: "member" },
    });
    expect(g).toEqual({ canEditRole: true, canRemove: true });
  });

  it("admin can manage a normal member (not self)", () => {
    const g = memberManageGuards({
      currentRole: "admin",
      currentUserId,
      target: { user_id: "u-other", role: "member" },
    });
    expect(g).toEqual({ canEditRole: true, canRemove: true });
  });

  it("self is untouchable even when the current user would otherwise manage", () => {
    for (const currentRole of ["owner", "admin"] as const) {
      const g = memberManageGuards({
        currentRole,
        currentUserId,
        target: { user_id: currentUserId, role: "admin" },
      });
      expect(g).toEqual({ canEditRole: false, canRemove: false });
    }
  });

  it("owner target is untouchable even for an owner actor", () => {
    const g = memberManageGuards({
      currentRole: "owner",
      currentUserId,
      target: { user_id: "u-owner", role: "owner" },
    });
    expect(g).toEqual({ canEditRole: false, canRemove: false });
  });

  it("plain member sees no management at all", () => {
    const g = memberManageGuards({
      currentRole: "member",
      currentUserId,
      target: { user_id: "u-other", role: "member" },
    });
    expect(g).toEqual({ canEditRole: false, canRemove: false });
  });

  it("guards are conservative while role/self are unknown (list not loaded)", () => {
    const g = memberManageGuards({
      currentRole: null,
      currentUserId,
      target: { user_id: "u-other", role: "member" },
    });
    expect(g).toEqual({ canEditRole: false, canRemove: false });
  });

  it("missing target (member not found) never offers management", () => {
    const g = memberManageGuards({
      currentRole: "owner",
      currentUserId,
      target: null,
    });
    expect(g).toEqual({ canEditRole: false, canRemove: false });
  });
});