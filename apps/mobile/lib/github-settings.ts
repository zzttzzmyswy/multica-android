/**
 * Mirror of web's deriveGitHubSettings (packages/core/github/settings.ts).
 * Pure derivation, default-all-on for workspaces predating MUL-2414, and the
 * implied-disable semantics (every sub-flag requires the master switch).
 *
 * Mirrored per apps/mobile/CLAUDE.md — the same flags must derive to the same
 * values on web and mobile, so a flipped workspace setting can't show one
 * state on web and another on the phone. Mobile re-implements (importing from
 * @multica/core is allowed for pure functions, but keeping a local mirror lets
 * mobile tests pin the exact semantics without a packages build).
 */
export interface GitHubSettings {
  /** Master switch — false hides every UI affordance and stops side-effects. */
  enabled: boolean;
  /** Issue-detail PR sidebar visibility. Implies `enabled`. */
  prSidebar: boolean;
  /** Co-authored-by trailer in agent commits. Implies `enabled`. */
  coAuthor: boolean;
  /** Auto-link issues ↔ PRs from webhook payloads. Implies `enabled`. */
  autoLinkPRs: boolean;
}

/** The four workspace-settings keys the GitHub features section writes. */
export type GitHubSettingsKey =
  | "github_enabled"
  | "github_pr_sidebar_enabled"
  | "co_authored_by_enabled"
  | "github_auto_link_prs_enabled";

export function deriveGitHubSettings(
  workspace: { settings: Record<string, unknown> } | null | undefined,
): GitHubSettings {
  const s = workspace?.settings ?? {};
  const enabled = s.github_enabled !== false;
  return {
    enabled,
    prSidebar: enabled && s.github_pr_sidebar_enabled !== false,
    coAuthor: enabled && s.co_authored_by_enabled !== false,
    autoLinkPRs: enabled && s.github_auto_link_prs_enabled !== false,
  };
}

/** PATCH body for flipping one setting — spreads the existing bag so
 *  unrelated workspace settings survive, mirroring web github-tab.tsx. */
export function mergeGitHubSetting(
  settings: Record<string, unknown> | null | undefined,
  key: GitHubSettingsKey,
  value: boolean,
): Record<string, unknown> {
  return { ...(settings ?? {}), [key]: value };
}
