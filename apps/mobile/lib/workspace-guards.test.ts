import { describe, expect, it } from "vitest";
import {
  ISSUE_PREFIX_MAX_LENGTH,
  issuePrefixInvalid,
  normalizeIssuePrefix,
  shouldSaveIssuePrefix,
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
describe("normalizeIssuePrefix", () => {
  it("uppercases and strips everything outside A-Z0-9", () => {
    expect(normalizeIssuePrefix("acme")).toBe("ACME");
    expect(normalizeIssuePrefix("ac-me 1!")).toBe("ACME1");
    expect(normalizeIssuePrefix("a_b.c/d")).toBe("ABCD");
  });

  it("caps at the server's 10-character limit", () => {
    const long = "abcdefghijklmnop";
    expect(normalizeIssuePrefix(long)).toBe("ABCDEFGHIJ");
    expect(normalizeIssuePrefix(long).length).toBe(ISSUE_PREFIX_MAX_LENGTH);
  });

  it("maps a symbol-only input to empty", () => {
    expect(normalizeIssuePrefix("--  --")).toBe("");
    expect(normalizeIssuePrefix("")).toBe("");
  });
});

describe("issuePrefixInvalid", () => {
  it("only an empty prefix is invalid", () => {
    expect(issuePrefixInvalid("")).toBe(true);
    expect(issuePrefixInvalid("A")).toBe(false);
    expect(issuePrefixInvalid("ACME")).toBe(false);
  });
});

describe("shouldSaveIssuePrefix", () => {
  it("skips when there is nothing to save", () => {
    expect(shouldSaveIssuePrefix("ACME", "ACME")).toBe(false);
    expect(shouldSaveIssuePrefix("acme", "ACME")).toBe(false);
    expect(shouldSaveIssuePrefix("", "ACME")).toBe(false);
    expect(shouldSaveIssuePrefix("!!", "ACME")).toBe(false);
  });

  it("saves a real change, including when the workspace has no prefix yet", () => {
    expect(shouldSaveIssuePrefix("NEW", "OLD")).toBe(true);
    expect(shouldSaveIssuePrefix("acme!", null)).toBe(true);
    expect(shouldSaveIssuePrefix("acme", undefined)).toBe(true);
  });
});
