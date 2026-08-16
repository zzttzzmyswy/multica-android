import { describe, expect, it } from "vitest";
import {
  workspaceManagementGuards,
  workspaceNameValidationError,
} from "./workspace-guards";
import { canManageRole } from "./member-guards";

describe("workspaceManagementGuards", () => {
  it("owner can manage and is the delete-authorized owner", () => {
    expect(workspaceManagementGuards({ currentRole: "owner" })).toEqual({
      canManage: true,
      isOwner: true,
    });
  });

  it("admin can manage but is not an owner (no delete)", () => {
    expect(workspaceManagementGuards({ currentRole: "admin" })).toEqual({
      canManage: true,
      isOwner: false,
    });
  });

  it("plain member sees no management at all", () => {
    expect(workspaceManagementGuards({ currentRole: "member" })).toEqual({
      canManage: false,
      isOwner: false,
    });
  });

  it("guards are conservative while the role is unknown (members not loaded)", () => {
    expect(workspaceManagementGuards({ currentRole: null })).toEqual({
      canManage: false,
      isOwner: false,
    });
    expect(workspaceManagementGuards({ currentRole: undefined })).toEqual({
      canManage: false,
      isOwner: false,
    });
  });
});

describe("canManageRole", () => {
  it("is true for owner and admin, false otherwise", () => {
    expect(canManageRole("owner")).toBe(true);
    expect(canManageRole("admin")).toBe(true);
    expect(canManageRole("member")).toBe(false);
    expect(canManageRole(null)).toBe(false);
    expect(canManageRole(undefined)).toBe(false);
  });
});

describe("workspaceNameValidationError", () => {
  it("returns a validation marker for blank/whitespace-only names", () => {
    expect(workspaceNameValidationError("")).toBe("required");
    expect(workspaceNameValidationError("   ")).toBe("required");
  });

  it("accepts any non-empty name (server trims + uppercases prefix)", () => {
    expect(workspaceNameValidationError("Acme")).toBeNull();
    expect(workspaceNameValidationError("   Acme Co  ")).toBeNull();
  });
});