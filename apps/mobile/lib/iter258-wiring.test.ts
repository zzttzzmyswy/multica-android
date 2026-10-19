/**
 * Iteration 258 (MYS-2236) — wiring ratchet for the three fixes.
 *
 * The mobile vitest lane has no RN renderer, so a green pure-function suite
 * proves nothing about whether a screen calls it. That gap is exactly where
 * this round's defects lived: `runtimeDeleteTarget` could be perfect while
 * both menu branches still called `requestRuntimeDelete()`, and
 * `applyFilterReset` could be perfect while the sheet still called
 * `clearFilters()`.
 *
 * Each assertion corresponds to one link in the chain, and each is written so
 * that the plausible half-fix turns it red — comments are stripped before
 * matching, so a comment describing a branch cannot satisfy one.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("the runtime row menu routes the two deletes apart", () => {
  const menu = code("components/runtimes/runtime-row-menu.tsx");

  /** The body of the `delete-profile` branch — up to the closing brace of its
   *  own block, found by brace matching (the branch contains early `return;`
   *  statements, so the first one is not the end). */
  const profileBranch = (() => {
    const marker = 'if (action === "delete-profile") {';
    const start = menu.indexOf(marker);
    if (start < 0) return "";
    let depth = 0;
    for (let i = start + marker.length - 1; i < menu.length; i++) {
      if (menu[i] === "{") depth++;
      else if (menu[i] === "}") {
        depth--;
        if (depth === 0) return menu.slice(start, i + 1);
      }
    }
    return menu.slice(start);
  })();

  it("imports the profile confirmation", () => {
    expect(menu).toContain("DeleteRuntimeProfileDialog");
  });

  it("opens the PROFILE dialog for the delete-profile action", () => {
    expect(profileBranch).toContain("setDeletingProfile");
  });

  it("the delete-profile branch never calls the runtime delete flow", () => {
    // The shipped defect lived here, not in the label: both branches ran
    // `requestRuntimeDelete()`. A correct helper proves nothing if the menu
    // ignores which action fired.
    expect(profileBranch).not.toContain("requestRuntimeDelete");
  });

  it("keeps the runtime flow for the plain delete action", () => {
    expect(menu).toMatch(/action === "delete"\) requestRuntimeDelete\(\)/);
  });

  it("never folds the two actions back into one condition", () => {
    expect(menu).not.toMatch(
      /action === "delete" \|\| action === "delete-profile"/,
    );
  });

  it("builds the subject from the runtime's own profile_id, not from a loaded list", () => {
    // Web falls through to the RUNTIME dialog when its profile list has not
    // answered (`runtime-list.tsx:619-630`). Copying that on the phone would
    // reproduce the very confusion this round fixes, so the id comes from
    // `runtime.profile_id`; the list only supplies the printable name.
    expect(profileBranch).toMatch(/runtime\.profile_id/);
  });
});

describe("the runtime detail page splits the same way", () => {
  const detail = code("app/(app)/[workspace]/more/runtimes/[id].tsx");

  it("decides through the tested helper", () => {
    expect(detail).toContain("dispatchRuntimeDelete");
    expect(detail).toMatch(/runtimeDeleteTarget\(runtime\)/);
  });

  it("does not hand-roll a runtime target (that IS the original bug)", () => {
    expect(detail).not.toMatch(/kind:\s*"runtime"/);
  });

  it("does not wire the delete button straight to the runtime flow", () => {
    expect(detail).not.toMatch(/onPress=\{handleDeletePress\}/);
  });

  it("routes a profile target into the confirmation", () => {
    expect(detail).toMatch(/deleteProfile: \(profileId\) =>/);
  });

  it("renders the profile confirmation dialog", () => {
    expect(detail).toContain("<DeleteRuntimeProfileDialog");
  });

  it("labels the entry by the object it removes", () => {
    expect(detail).toMatch(
      /isCustom[\s\S]{0,80}"runtimes\.row\.deleteProfile"/,
    );
  });
});

describe("the filter sheet resets to the view, not to nothing", () => {
  const panel = code("app/(app)/[workspace]/issues-filter.tsx");

  it("resolves the open view's baseline", () => {
    expect(panel).toMatch(/useFilterSheetBaseline\(/);
  });

  it("performs the reset through the tested routine", () => {
    // `applyFilterReset` owns the view-vs-clear branch AND the trailing
    // date / workingOnly undo, so neither can be dropped at a call site.
    expect(panel).toContain("applyFilterReset(s, baseline");
    // Neither primitive may be called directly: a second copy of the branch
    // is how the two halves drift apart.
    expect(panel).not.toMatch(/act\(\)\.resetFiltersTo\(/);
    expect(panel).not.toMatch(/act\(\)\.clearFilters\(/);
  });

  it("counts active dimensions against the baseline", () => {
    // The old `hasActiveIssueFilters(s)` was baseline-blind, so a freshly
    // opened view offered a Reset that would erase it.
    expect(panel).toMatch(
      /const activeDimensions = activeFilterDimensions\(s, baseline\)/,
    );
    // ...and that set is what gates the entry.
    expect(panel).toMatch(
      /const hasActive = activeDimensions\.length > 0/,
    );
    expect(panel).not.toContain("hasActiveIssueFilters");
  });

  it("renders view-fixed options as unremovable", () => {
    expect(panel).toMatch(/baseline\?\.status\.has\(option\.key\)/);
    expect(panel).toMatch(/baseline\?\.priority\.has\(priority\)/);
    expect(panel).toMatch(/fixed=\{baseline\?\.includeNoAssignee === true\}/);
    expect(panel).toMatch(/fixed=\{baseline\?\.includeNoProject === true\}/);
    // Those predicates must actually gate the press, not merely be computed.
    // Exactly three: the status row, the priority row, and BoolRow (which the
    // two "none of" rows share).
    expect((panel.match(/disabled=\{fixed\}/g) ?? [])).toHaveLength(3);
  });
});

describe("the filter picker sheets carry the same fixity", () => {
  const picker = code("app/(app)/[workspace]/issues-filter-picker.tsx");
  const bodies = code("components/issue/pickers/filter-picker-bodies.tsx");

  it("the picker route resolves the same baseline as the panel", () => {
    expect(picker).toMatch(
      /const baseline = useFilterSheetBaseline\(resolvedScope, projectIdParam \?\? null\)/,
    );
  });

  it("every dimension body receives its fixed set", () => {
    expect(picker).toMatch(/fixedKeys=\{[^}]*baseline\?\.(assignee|creator)/);
    expect(picker).toContain("fixedIds={baseline?.project}");
    expect(picker).toContain("fixedIds={baseline?.label}");
    expect(picker).toMatch(/baseline\?\.property\.get\(propertyDef\.id\)/);
  });

  it("the bodies compute fixity for every dimension", () => {
    expect(bodies).toMatch(/fixedKeys\?\.has\(actorKey\)/);
    expect(bodies).toMatch(/fixedIds\?\.has\(item\.project\.id\)/);
    expect(bodies).toMatch(/fixedIds\?\.has\(item\.id\)/);
    expect(bodies).toContain('t("filter.fixedByView")');
  });

  it("the bodies actually DISABLE a fixed row", () => {
    // Four list rows (actor / project / label / property) gate on `fixed`;
    // presence of the predicate alone would let a fix compute it and ignore it.
    expect((bodies.match(/disabled=\{fixed\}/g) ?? [])).toHaveLength(4);
  });

  it("a fixed scalar value makes the input read-only rather than silently ignored", () => {
    expect(bodies).toMatch(/editable=\{!valueFixed\}/);
  });
});

describe("a system pause is not a user pause", () => {
  const detail = code("app/(app)/[workspace]/more/autopilots/[id].tsx");
  const list = code("app/(app)/[workspace]/more/autopilots.tsx");

  it("the detail page derives and renders the system reason", () => {
    expect(detail).toMatch(
      /const runtimeRequired = isRuntimeRequiredPause\(autopilot\)/,
    );
    expect(detail).toContain("pauseBannerCopy");
    expect(detail).toContain('t("autopilots.detail.bindRuntime")');
  });

  it("the banner is rendered behind that flag (not a dead branch)", () => {
    expect(detail).toMatch(/\{runtimeRequired \? \(/);
  });

  it("the bind-runtime jump goes through the tested helpers", () => {
    expect(detail).toContain("runtimeBindingHref(wsSlug");
    expect(detail).toContain("canJumpToRuntimeBinding");
  });

  it("the list pill reads the reason instead of printing the bare status", () => {
    expect(list).toContain("pauseStatusLabelKey");
    expect(list).toMatch(/const pill = rowStatusPill\(autopilot\)/);
    expect(list).not.toMatch(/const pill = statusPill\(autopilot\.status\)/);
  });
});

describe("every new key resolves in both bundles", () => {
  const en = JSON.parse(
    readFileSync(path.join(APP_ROOT, "lib/i18n/locales/en.json"), "utf8"),
  ) as Record<string, string>;
  const zh = JSON.parse(
    readFileSync(path.join(APP_ROOT, "lib/i18n/locales/zh.json"), "utf8"),
  ) as Record<string, string>;

  const KEYS = [
    "filter.fixedByView",
    "autopilots.status.pausedRuntimeRequired",
    "autopilots.detail.pausedRuntimeRequired",
    "autopilots.detail.pausedRuntimeRequiredUnnamed",
    "autopilots.detail.bindRuntime",
  ];

  it.each(KEYS)("%s exists in en and zh", (key) => {
    expect(en[key], `missing in en: ${key}`).toBeTruthy();
    expect(zh[key], `missing in zh: ${key}`).toBeTruthy();
    // A zh value identical to the en one means the translation never happened.
    expect(zh[key]).not.toBe(en[key]);
  });

  it("the named pause sentence interpolates the assignee", () => {
    expect(en["autopilots.detail.pausedRuntimeRequired"]).toContain("{{name}}");
    expect(zh["autopilots.detail.pausedRuntimeRequired"]).toContain("{{name}}");
  });

  it("the unnamed sentence carries no placeholder the caller cannot fill", () => {
    expect(en["autopilots.detail.pausedRuntimeRequiredUnnamed"]).not.toContain(
      "{{",
    );
    expect(zh["autopilots.detail.pausedRuntimeRequiredUnnamed"]).not.toContain(
      "{{",
    );
  });
});
