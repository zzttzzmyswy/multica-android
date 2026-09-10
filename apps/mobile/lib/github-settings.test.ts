import { describe, expect, it } from "vitest";
import { deriveGitHubSettings, mergeGitHubSetting } from "./github-settings";

/**
 * Mirrors web's deriveGitHubSettings (packages/core/github/settings.ts) —
 * same key names, same implied-disable semantics, same all-on defaults so
 * workspaces that predate the settings block keep historical behavior.
 */
describe("deriveGitHubSettings", () => {
  it("defaults every flag to true for null/undefined/empty settings", () => {
    expect(deriveGitHubSettings(null)).toEqual({
      enabled: true,
      prSidebar: true,
      coAuthor: true,
      autoLinkPRs: true,
    });
    expect(deriveGitHubSettings(undefined)).toEqual({
      enabled: true,
      prSidebar: true,
      coAuthor: true,
      autoLinkPRs: true,
    });
    expect(deriveGitHubSettings({ settings: {} })).toEqual({
      enabled: true,
      prSidebar: true,
      coAuthor: true,
      autoLinkPRs: true,
    });
  });

  it("disables every implied flag when the master switch is off", () => {
    expect(
      deriveGitHubSettings({ settings: { github_enabled: false } }),
    ).toEqual({
      enabled: false,
      prSidebar: false,
      coAuthor: false,
      autoLinkPRs: false,
    });
  });

  it("derives independent sub-flags from their snake_case keys", () => {
    expect(
      deriveGitHubSettings({
        settings: {
          github_pr_sidebar_enabled: false,
          co_authored_by_enabled: false,
          github_auto_link_prs_enabled: false,
        },
      }),
    ).toEqual({
      enabled: true,
      prSidebar: false,
      coAuthor: false,
      autoLinkPRs: false,
    });
  });

  it("ignores unrelated settings keys", () => {
    const flags = deriveGitHubSettings({
      settings: { issue_prefix: "MUL", some_other: 1 },
    });
    expect(flags).toEqual({
      enabled: true,
      prSidebar: true,
      coAuthor: true,
      autoLinkPRs: true,
    });
  });
});

/**
 * Mirrors web github-tab.tsx:persistSetting — the PATCH body spreads the
 * full existing settings object and overwrites exactly one key, so keys
 * unrelated to GitHub survive the write.
 */
describe("mergeGitHubSetting", () => {
  it("spreads existing settings and overwrites one key", () => {
    expect(
      mergeGitHubSetting(
        { issue_prefix: "MUL", github_enabled: true },
        "co_authored_by_enabled",
        false,
      ),
    ).toEqual({
      issue_prefix: "MUL",
      github_enabled: true,
      co_authored_by_enabled: false,
    });
  });

  it("treats a null workspace settings bag as empty", () => {
    expect(mergeGitHubSetting(null, "github_enabled", false)).toEqual({
      github_enabled: false,
    });
  });

  it("keeps unrelated keys when flipping a sub-flag", () => {
    const existing = {
      github_enabled: true,
      github_pr_sidebar_enabled: true,
      co_authored_by_enabled: true,
      github_auto_link_prs_enabled: false,
    };
    expect(
      mergeGitHubSetting(existing, "github_auto_link_prs_enabled", true),
    ).toEqual({ ...existing, github_auto_link_prs_enabled: true });
  });
});
