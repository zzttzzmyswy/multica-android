import { describe, expect, it } from "vitest";
import { isValidInviteEmail } from "./invite-validation";

describe("isValidInviteEmail", () => {
  it("accepts well-formed addresses", () => {
    expect(isValidInviteEmail("ada@example.com")).toBe(true);
    expect(isValidInviteEmail("first.last@example.co.uk")).toBe(true);
    expect(isValidInviteEmail(" a+b@example.com ")).toBe(true); // trims
  });

  it("rejects empty / whitespace-only input", () => {
    expect(isValidInviteEmail("")).toBe(false);
    expect(isValidInviteEmail("   ")).toBe(false);
  });

  it("rejects missing local part, domain, or TLD", () => {
    expect(isValidInviteEmail("@example.com")).toBe(false);
    expect(isValidInviteEmail("ada@")).toBe(false);
    expect(isValidInviteEmail("ada@example")).toBe(false); // no dot-TLD
    expect(isValidInviteEmail("ada.example.com")).toBe(false); // no @
  });

  it("rejects embedded whitespace", () => {
    expect(isValidInviteEmail("ada @example.com")).toBe(false);
    expect(isValidInviteEmail("a da@example.com")).toBe(false);
  });
});