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
    expect(screen).toContain("filterSearchCommands(buildSearchCommands()");
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
