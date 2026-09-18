/**
 * Wiring guard for the cross-workspace unread dot.
 *
 * Mobile's vitest lane is Node-only — no RN renderer — so a correct pure
 * helper that no screen calls fixes nothing. That is the iter-157 lesson:
 * three test files each inlined their own copy of a shared list, so the
 * contract stayed green while the behaviour was wrong.
 *
 * Three things are asserted here, none of which a logic test can see:
 *   1. Both surfaces fetch the summary and derive the dot through the shared
 *      helper, gated on the active workspace.
 *   2. `lib/workspace-unread-badge.ts` imports the derivations from
 *      `@multica/core/inbox/unread-summary` instead of carrying a second copy
 *      of them — a mirror would drift from web silently.
 *   3. The unread row's accessibility label is a real key in both bundles.
 *
 * Matches call syntax, never prose: a comment quoting a call must not satisfy
 * the guard.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// This file lives in `lib/`, so one level up is the mobile app root.
const APP_ROOT = path.resolve(__dirname, "..");

const read = (rel: string) => readFileSync(path.join(APP_ROOT, rel), "utf8");

/** Strip comments so prose that quotes a call cannot satisfy an assertion. */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const SWITCH_SHEET = "app/(app)/[workspace]/switch-workspace.tsx";
const MORE_POPOVER = "components/nav/more-tab-dropdown.tsx";
const BADGE = "lib/workspace-unread-badge.ts";

describe("switch-workspace sheet wiring", () => {
  const src = code(SWITCH_SHEET);

  it("fetches the account-level summary, gated on the active workspace", () => {
    expect(src).toContain("...inboxUnreadSummaryOptions(),");
    expect(src).toContain("enabled: !!activeSlug,");
  });

  it("derives the dot through the shared helper", () => {
    expect(src).toContain("workspaceUnreadBadge(unreadSummary, activeId)");
  });

  it("dots the row from that derivation, not from its own scan", () => {
    expect(src).toContain("hasUnread={badge.unreadIds.has(ws.id)}");
    expect(src).not.toMatch(/\.count\s*>\s*0/);
  });
});

describe("More popover WorkspaceCard wiring", () => {
  const src = code(MORE_POPOVER);

  it("fetches the account-level summary, gated on the active workspace", () => {
    expect(src).toContain("...inboxUnreadSummaryOptions(),");
    expect(src).toContain("enabled: !!wsId,");
  });

  it("derives the aggregate dot through the shared helper", () => {
    expect(src).toContain("workspaceUnreadBadge(unreadSummary, wsId)");
    expect(src).toContain(".showAggregateDot;");
  });

  it("renders that dot on the collapsed entry", () => {
    expect(src).toContain("showUnreadDot={otherWorkspaceUnread}");
    expect(src).not.toMatch(/\.count\s*>\s*0/);
  });
});

describe("the badge helper has no mirror of the web derivation", () => {
  const src = code(BADGE);

  it("imports both derivations from the shared core module", () => {
    expect(src).toContain('from "@multica/core/inbox/unread-summary"');
    expect(src).toContain("hasOtherWorkspaceUnread,");
    expect(src).toContain("unreadWorkspaceIds,");
  });

  it("does not reimplement either derivation", () => {
    // Delegating means the module never inspects a count or a workspace id —
    // any of these is the mirror copy this guard exists to catch, in whatever
    // spelling (`.count > 0`, a truthy `.count`, a hand-rolled `.some(...)`).
    expect(src).not.toMatch(/\.count\b/);
    expect(src).not.toMatch(/\.some\(/);
    expect(src).not.toMatch(/workspace_id/);
  });
});

describe("the unread row announces itself", () => {
  const src = code(SWITCH_SHEET);

  it("uses the unread-specific label when the row has unread items", () => {
    expect(src).toContain('tr.t("a11y.switchToUnread"');
  });

  it("resolves that key in both mobile bundles", () => {
    for (const locale of ["zh", "en"]) {
      const bundle = JSON.parse(read(`lib/i18n/locales/${locale}.json`)) as Record<
        string,
        string
      >;
      expect(bundle["a11y.switchToUnread"]).toBeTruthy();
      expect(bundle["a11y.workspaceHasUnread"]).toBeTruthy();
    }
  });
});
