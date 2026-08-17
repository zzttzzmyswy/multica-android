/**
 * Mobile workspace-slug helpers. Web derives slugs with pinyin romanization
 * (packages/views/workspace/slug.ts); mobile intentionally skips the pinyin
 * dependency — a pure non-ASCII name yields "" and the form asks the user to
 * type a slug by hand (MYS-371). ASCII names follow the same algorithm web
 * applies after romanization.
 */
import { describe, expect, it } from "vitest";
import { WORKSPACE_SLUG_REGEX, deriveSlug } from "./workspace-slug";

describe("WORKSPACE_SLUG_REGEX", () => {
  it("matches simple lowercase slugs", () => {
    expect(WORKSPACE_SLUG_REGEX.test("acme")).toBe(true);
    expect(WORKSPACE_SLUG_REGEX.test("acme1")).toBe(true);
  });

  it("matches hyphen-separated slugs", () => {
    expect(WORKSPACE_SLUG_REGEX.test("acme-studio")).toBe(true);
    expect(WORKSPACE_SLUG_REGEX.test("a-b-c")).toBe(true);
  });

  it("rejects uppercase", () => {
    expect(WORKSPACE_SLUG_REGEX.test("Acme")).toBe(false);
    expect(WORKSPACE_SLUG_REGEX.test("ACME")).toBe(false);
  });

  it("rejects unanchored hyphens and non-alphanumeric separators", () => {
    expect(WORKSPACE_SLUG_REGEX.test("-acme")).toBe(false);
    expect(WORKSPACE_SLUG_REGEX.test("acme-")).toBe(false);
    expect(WORKSPACE_SLUG_REGEX.test("acme--studio")).toBe(false);
    expect(WORKSPACE_SLUG_REGEX.test("acme_studio")).toBe(false);
    expect(WORKSPACE_SLUG_REGEX.test("acme studio")).toBe(false);
  });

  it("rejects blank and non-ASCII input", () => {
    expect(WORKSPACE_SLUG_REGEX.test("")).toBe(false);
    expect(WORKSPACE_SLUG_REGEX.test("工作区")).toBe(false);
  });
});

describe("deriveSlug", () => {
  it("lowercases an English name into a hyphenated slug", () => {
    expect(deriveSlug("My Workspace")).toBe("my-workspace");
  });

  it("collapses runs of non-alphanumerics to a single hyphen", () => {
    expect(deriveSlug("Acme ★ Studio")).toBe("acme-studio");
    expect(deriveSlug("a---b")).toBe("a-b");
  });

  it("trims leading and trailing hyphens", () => {
    expect(deriveSlug("  Rocket  ")).toBe("rocket");
    expect(deriveSlug(">>> Go <<<")).toBe("go");
  });

  it("keeps existing hyphens", () => {
    expect(deriveSlug("Acme-Studio")).toBe("acme-studio");
  });

  it("returns empty string for a pure non-ASCII name (Chinese)", () => {
    expect(deriveSlug("我的工作区")).toBe("");
  });

  it("returns empty string for emoji-only names", () => {
    expect(deriveSlug("🚀🚀🚀")).toBe("");
  });

  it("returns empty string for blank input", () => {
    expect(deriveSlug("")).toBe("");
    expect(deriveSlug("   ")).toBe("");
  });

  it("returns empty string for symbol-only names", () => {
    expect(deriveSlug("!!!")).toBe("");
  });

  it("strips non-ASCII from a mixed name, keeping the ASCII slug", () => {
    expect(deriveSlug("Acme 工作室")).toBe("acme");
  });

  it("keeps digits", () => {
    expect(deriveSlug("Project 42")).toBe("project-42");
  });
});