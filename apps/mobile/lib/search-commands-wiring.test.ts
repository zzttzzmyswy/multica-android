/**
 * Wiring ratchet for the search panel's Pages + Commands groups (iteration 205).
 *
 * Mobile's vitest lane is Node-only (see vitest.config.ts) — no RN renderer —
 * so `lib/search-commands.test.ts` proving the two groups *correct* says
 * nothing about whether the search screen actually renders them. That gap has
 * bitten this repo before: a predicate can be green while nobody calls it.
 *
 * Four assertions, because any one alone is passable:
 *
 *   1. The screen builds both groups from the shared module.
 *   2. It passes them into `buildSearchRows` — building them and dropping them
 *      on the floor would leave the list unchanged.
 *   3. `renderItem` handles both new row kinds. A row kind with no branch
 *      renders nothing (the switch returns `undefined`), which is invisible to
 *      every other test here.
 *   4. Every page key and command key has a glyph. `PAGE_ICONS[key]` being
 *      `undefined` makes `<Ionicons name={undefined}>` render an empty box.
 *
 * Comments are stripped before matching so a comment quoting a construct can
 * neither satisfy nor trip an assertion.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");
const SCREEN = "app/(app)/[workspace]/search.tsx";

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("search panel wiring", () => {
  const screen = code(SCREEN);

  it("builds both action groups from the shared module", () => {
    expect(screen).toContain("filterSearchPages(buildSearchPages()");
    // Iteration 228: the command group now takes the issue the panel was
    // opened over, so the call carries an argument. Asserting the callee (not
    // the exact argument text) keeps this from breaking on a later rename of
    // the property while still failing if the group stops being built here.
    expect(screen).toMatch(/filterSearchCommands\(\s*buildSearchCommands\(/);
  });

  it("gates the four issue-scoped commands on the opened issue", () => {
    // The whole point of this round's second half: the rows appear only when
    // the panel knows which issue it is over.
    //
    // The exact call text is asserted, not a loose pattern, because the way
    // this gate fails is by acquiring a FALLBACK — `currentIssue?.identifier
    // ?? someDefault` renders four dead entries on every screen while still
    // "passing the identifier through". A `toMatch` on the prefix accepts
    // that; this does not.
    expect(screen).toContain(
      "buildSearchCommands({ issueIdentifier: currentIssue?.identifier })",
    );
  });

  it("reads that issue from its own route param, not from a global", () => {
    // The panel is its own modal route, so the fact arrives as a param and is
    // resolved through the issue detail query — the mobile counterpart of
    // web's `currentIssueId && currentIssue` gate.
    expect(screen).toContain("useLocalSearchParams<{ issueId?: string }>");
    expect(screen).toMatch(/issueDetailOptions\(wsId,\s*issueId \?\? ""\)/);
    expect(screen).toMatch(/enabled:\s*!!issueId/);
  });

  it("defines a handler for every issue-scoped command key", () => {
    // A key with no `case` falls out of the switch and the row does nothing
    // when tapped — invisible to the unit lane, which only sees the list.
    for (const key of [
      "copy-issue-link",
      "copy-issue-identifier",
      "fold-all-comments",
      "unfold-all-comments",
    ]) {
      expect(screen).toContain(`case "${key}":`);
    }
  });

  it("folds BOTH kinds of comment folding on fold/unfold-all", () => {
    // Web's two rows drive the per-comment fold store AND the resolved-thread
    // expand set. Wiring only the first leaves every resolved thread visibly
    // expanded after "fold all comments" — half the command.
    expect(screen).toMatch(/collapse\.collapseAll\(wsId, issueId, rootCommentIds\(entries\)\)/);
    expect(screen).toMatch(/resolvedExpand\.collapseAll\(issueId\)/);
    expect(screen).toMatch(/collapse\.expandAll\(wsId, issueId\)/);
    expect(screen).toMatch(
      /resolvedExpand\.expandAll\(\s*issueId,\s*resolvedThreadRootIds\(entries\),?\s*\)/,
    );
  });

  it("gives the four issue-scoped keys a glyph too", () => {
    const icons = screen.slice(screen.indexOf("const COMMAND_ICONS"));
    for (const key of [
      '"copy-issue-link"',
      '"copy-issue-identifier"',
      '"fold-all-comments"',
      '"unfold-all-comments"',
    ]) {
      expect(icons).toContain(`${key}:`);
    }
  });

  it("hands both groups to the row builder", () => {
    // The exact property names `buildSearchRows` reads. Renaming one here
    // without renaming it there is a silent no-op for the user.
    expect(screen).toMatch(/buildSearchRows\(\{[\s\S]*?\bpages,/);
    expect(screen).toMatch(/buildSearchRows\(\{[\s\S]*?\bcommands,/);
  });

  it("renders a row branch for each new kind", () => {
    expect(screen).toContain('case "page":');
    expect(screen).toContain('case "command":');
  });

  it("counts the action rows toward `hasResults`", () => {
    // Without this the screen shows "No results for <query>" underneath a
    // perfectly good Pages list.
    expect(screen).toMatch(/hasResults\s*=[\s\S]*?pages\.length > 0/);
    expect(screen).toMatch(/hasResults\s*=[\s\S]*?commands\.length > 0/);
  });

  it("gives every page and command key a glyph", () => {
    const icons = screen.slice(screen.indexOf("const PAGE_ICONS"));
    for (const key of [
      "inbox",
      "myIssues",
      "issues",
      "projects",
      "agents",
      "runtimes",
      "skills",
      "settings",
    ]) {
      expect(icons).toMatch(new RegExp(`\\b${key}:\\s*"`));
    }
    for (const key of [
      '"new-issue"',
      '"new-project"',
      '"theme-light"',
      '"theme-dark"',
      '"theme-system"',
    ]) {
      expect(icons).toContain(`${key}:`);
    }
  });
});
