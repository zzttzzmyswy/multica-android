/**
 * Reachability ratchet for the global search entry (iteration 228).
 *
 * The defect this round fixes was not that the panel was wrong — it was that
 * almost nothing could reach it. Only two of 113 workspace screens mounted an
 * entry, because `components/ui/app-header-actions.tsx` (the sole
 * `router.push(".../search")` before this) is imported by the Inbox and My
 * Issues tabs and nowhere else. A pure-function lane cannot see that: every
 * helper stayed green while the panel was unreachable from Chat, Projects,
 * Pins, More, the issue detail page and ~60 other push screens.
 *
 * So these assertions are about WIRING, and each one pins a distinct way the
 * coverage can silently regress:
 *
 *   1. The navigator declares the entry as its default `headerRight` — that
 *      default is what covers every push screen that declares none.
 *   2. The screens that DO declare one compose the shared entry. React
 *      Navigation merges options key-by-key over the screen's own, so a
 *      screen's `headerRight` replaces the default wholesale; each such screen
 *      is a place the entry can vanish.
 *   3. The issue detail page passes its issue id, which is what turns the four
 *      issue-scoped commands on.
 *   4. The entry builds exactly ONE URL shape, through the shared helper.
 *
 * Comments are stripped before matching so a comment naming a construct
 * cannot satisfy an assertion — both JS block comments and single-line `//`
 * comments, which is what `code()` below does.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");
const WORKSPACE_DIR = "app/(app)/[workspace]";

/** Source with comments removed — an assertion must match real code. */
function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** Every `.tsx` route under the workspace tree, repo-relative. */
function routeFiles(dir = WORKSPACE_DIR): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(APP_ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(path.join(APP_ROOT, rel)).isDirectory()) {
      out.push(...routeFiles(rel));
    } else if (name.endsWith(".tsx")) {
      out.push(rel);
    }
  }
  return out;
}

describe("the search entry is declared once, at the navigator level", () => {
  const layout = code(`${WORKSPACE_DIR}/_layout.tsx`);

  it("sets it as the Stack's default headerRight", () => {
    // Without this, every push screen that declares no `headerRight` has no
    // entry at all — the ~67 screens this round is about.
    expect(layout).toMatch(/screenOptions=\{\{\s*headerRight:\s*\(\)\s*=>\s*<HeaderSearchButton\s*\/>\s*\}\}/);
  });

  it("makes the search panel itself opt out of that default", () => {
    // A navigator-level default is inherited by EVERY route under it —
    // including `/search`. Left alone, the panel's own header would carry a
    // search button that pushes the panel onto itself, which is exactly the
    // kind of self-referential control a reachability change introduces.
    // `headerRight: undefined` in the screen's own options clears the default
    // (options merge with `Object.assign`, so an own `undefined` wins).
    const search = layout.slice(layout.indexOf('name="search"'));
    expect(search.slice(0, 400)).toMatch(/headerRight:\s*undefined/);
  });
});

describe("every screen that replaces the default carries the entry", () => {
  const files = routeFiles();

  /**
   * Screens whose `headerRight` is their own, i.e. the navigator default is
   * replaced — each with the reason it is allowed to be. Derived from the
   * source rather than hand-listed, so a NEW screen that declares one fails
   * the exact-list assertion below until it either composes the entry or is
   * added here with a reason.
   *
   * Every entry is a composition form whose header is the modal's own
   * commit/dismiss control and nothing else: adding search beside a
   * half-filled form (or a Save button) would offer a way to leave it. A
   * browse screen never belongs on this list.
   */
  const EXCLUDED: Record<string, string> = {
    "new-issue.tsx": "modal draft; header is the submit arrow",
    "issue/[id]/edit.tsx": "modal form; header is Save",
    "project/new.tsx": "modal form; header is Create",
    "project/[id]/edit.tsx": "modal form; header is Save",
    "more/autopilots/new.tsx": "modal form; header is Create",
    "more/autopilots/[id]/edit.tsx": "modal form; header is Save",
    "more/autopilots/[id]/trigger.tsx": "modal form; header is Save",
    "more/squads/new.tsx": "form; header is Create",
    "more/labels/new.tsx": "form; header is Create",
    "more/skills/new.tsx": "form; header is Create",
    "more/mcp-servers/new.tsx": "form; header is Create",
    "more/agents/new.tsx": "create-method chooser, no list to search",
    "search.tsx": "the destination itself",
  };
  const EXCLUDED_SUFFIXES = Object.keys(EXCLUDED);

  const owners = files.filter((rel) => {
    const src = code(rel);
    if (!/headerRight/.test(src)) return false;
    return !EXCLUDED_SUFFIXES.some((suffix) => rel.endsWith(suffix));
  });

  it("discovers exactly the expected owner set", () => {
    // An exact list rather than a count: a NEW screen that declares its own
    // `headerRight` must fail here until it either composes the entry or is
    // added to EXCLUDED with a reason. That is the whole failure mode this
    // round exists to prevent, so it is worth an explicit, reviewable list.
    expect(owners.map((r) => r.replace(`${WORKSPACE_DIR}/`, "")).sort()).toEqual([
      // The navigator default lives here, so it is an "owner" too.
      "_layout.tsx",
      "issue/[id].tsx",
      "more/agents.tsx",
      "more/autopilots.tsx",
      "more/autopilots/[id].tsx",
      "more/labels.tsx",
      "more/mcp-servers.tsx",
      "more/projects.tsx",
      "more/properties.tsx",
      "more/runtimes.tsx",
      "more/settings/quick-actions.tsx",
      "more/skills.tsx",
      "more/squads.tsx",
      "more/squads/[id].tsx",
      "project/[id].tsx",
    ]);
  });

  it("gives every exclusion a reason", () => {
    for (const [suffix, why] of Object.entries(EXCLUDED)) {
      expect(why.length, `${suffix} needs a reason`).toBeGreaterThan(10);
    }
  });

  for (const rel of owners) {
    it(`${rel} composes the shared entry`, () => {
      const src = code(rel);
      // The JSX USAGE, not merely the import: a file that imports the
      // component but renders its own bare header actions has the same defect
      // as one that never imported it, and matching the import name would
      // call that covered.
      expect(src).toMatch(/<HeaderSearch(Group|Button)\b/);
    });
  }
});

describe("the issue detail page hands its id to the panel", () => {
  const src = code(`${WORKSPACE_DIR}/issue/[id].tsx`);

  it("passes the route's issue id", () => {
    // This is what makes the four issue-scoped commands appear on the one
    // screen web shows them on. `<HeaderSearchGroup />` here would satisfy the
    // reachability check above while silently disabling all four rows.
    expect(src).toMatch(/<HeaderSearchButton\s+issueId=\{id\}\s*\/>/);
  });
});

describe("the entry builds its URL only through the shared helper", () => {
  const button = code("components/ui/header-search-button.tsx");

  it("uses searchPath()", () => {
    expect(button).toContain("searchPath(");
  });

  it("does not hand-roll a /search URL", () => {
    // A second hand-rolled URL is how the issueId param gets dropped on one
    // path and kept on another.
    expect(button).not.toMatch(/`\/\$\{slug\}\/search`/);
  });

  it("no other file pushes the search route", () => {
    // Before this round `app-header-actions.tsx` held the only push, spelled
    // as a template literal at the call site. It now delegates to the shared
    // button, so the raw `/${slug}/search` push survives in exactly one place
    // — `lib/search-route.ts` — and nothing else grows a second URL shape
    // that forgets the issueId param.
    const offenders = routeFiles(WORKSPACE_DIR)
      .concat([
        "components/ui/app-header-actions.tsx",
        "components/ui/header-search-button.tsx",
      ])
      .filter((rel) => /`\/\$\{[A-Za-z.]+\}\/search/.test(code(rel)));
    expect(offenders).toEqual([]);
  });
});

// ── Iteration 228: Recent depth ───────────────────────────────────────────
// The "same data, different answer on each platform" half of this round. Web
// stores 20 recents (`MAX_RECENT_ISSUES`) and renders all 20; mobile stored 10
// and rendered 5, so on a phone in an 11-project workspace "Recent" answered
// with a quarter of what web showed. Both numbers are asserted because either
// one alone still truncates: a 20-deep store rendered 5 at a time is the same
// defect one layer down.
describe("Recent renders as deep as web's", () => {
  const WEB_MAX_RECENT_ISSUES = 20;

  it("stores as many recents per workspace as web does", () => {
    const store = code("data/viewed-issues-store.ts");
    expect(store).toContain(`const CAPACITY = ${WEB_MAX_RECENT_ISSUES};`);
  });

  it("renders the whole stored bucket, not a prefix of it", () => {
    const screen = code("app/(app)/[workspace]/search.tsx");
    expect(screen).toContain(`const RECENT_LIMIT = ${WEB_MAX_RECENT_ISSUES};`);
    // The render limit must actually be applied to the viewed ids — a constant
    // that nothing reads would pass the assertion above and change nothing.
    expect(screen).toMatch(/viewedIds\.slice\(0,\s*RECENT_LIMIT\)/);
  });
});
