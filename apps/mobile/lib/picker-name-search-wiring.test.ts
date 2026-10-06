/**
 * Wiring guard for pinyin-aware name search in the directory pickers.
 *
 * Mobile's vitest lane is Node-only (see vitest.config.ts) — there is no RN
 * renderer, so a correct pure predicate that no picker calls fixes nothing.
 * This is exactly how the gap survived: `lib/pinyin-match.ts` shipped, was
 * unit-tested, and was wired into three non-picker surfaces only, while every
 * picker kept the bare `includes` arm. A passing `pinyin-match.test.ts` said
 * nothing about any of that.
 *
 * So this file asserts the *call site*, not the helper: for each surface that
 * has a web counterpart searching with `matchesPinyin`, the mobile file must
 * route its name predicate through `matchesNameOrPinyin`, and must no longer
 * contain the old substring-only predicate.
 *
 * Matching runs against comment-stripped source, so a comment quoting the call
 * cannot satisfy an assertion.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// This file lives in `lib/`, so one level up is the mobile app root.
const APP_ROOT = path.resolve(__dirname, "..");

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** Each entry: the mobile surface, and the web source whose search it mirrors.
 *  The web path is only documentation — it is what a reviewer checks to see
 *  that the mobile predicate has a counterpart that actually does this. */
const PINYIN_PICKER_SITES: { file: string; web: string }[] = [
  {
    file: "components/issue/pickers/assignee-picker-body.tsx",
    web: "packages/views/issues/components/pickers/assignee-picker.tsx:132-138",
  },
  {
    file: "components/issue/pickers/mention-picker-body.tsx",
    web: "packages/views/editor/extensions/mention-suggestion.tsx:721,732,753",
  },
  {
    file: "components/issue/pickers/project-picker-body.tsx",
    web: "packages/views/projects/components/project-picker.tsx:64",
  },
  {
    file: "components/project/pickers/project-lead-picker-body.tsx",
    web: "packages/views/projects/components/project-lead-picker.tsx:31-32",
  },
  {
    file: "components/issue/mention-suggestion-bar.tsx",
    web: "packages/views/editor/extensions/mention-suggestion.tsx:721,732,753",
  },
  {
    file: "components/issue/pickers/filter-picker-bodies.tsx",
    web: "packages/views/issues/components/issues-header.tsx:335-343",
  },
  {
    file: "components/quick-action/agent-squad-picker-modal.tsx",
    web: "packages/views/autopilots/components/pickers/agent-picker.tsx:59-62",
  },
  {
    file: "lib/filter-projects.ts",
    web: "packages/views/projects/components/projects-page.tsx:870",
  },
];

describe("picker name search is pinyin-aware", () => {
  for (const { file, web } of PINYIN_PICKER_SITES) {
    describe(file, () => {
      const src = code(file);

      it("routes its name predicate through the shared helper", () => {
        expect(
          src,
          `${file} must search names through matchesNameOrPinyin — web's ` +
            `counterpart at ${web} matches with ` +
            "`name.includes(q) || matchesPinyin(name, q)`, so a Chinese name " +
            "is reachable by pinyin there and here",
        ).toContain("matchesNameOrPinyin");
      });

      it("imports the helper from name-search", () => {
        // Either form: app code under `components/` uses the `@/` alias, while
        // `lib/` modules import their neighbour relatively (`./name-search`).
        // Both resolve to the same module; the assertion is that this file
        // imports *the helper*, not which spelling of the path it used.
        expect(src).toMatch(
          /from\s+"(?:@\/lib|\.)\/name-search"/,
        );
      });
    });
  }

  it("leaves no substring-only name predicate in the wired surfaces", () => {
    // The old shape was `matchName = (n) => !q || n.toLowerCase().includes(q)`
    // — one definition per file, reused by every section. Each file below is
    // asserted to have dropped it entirely.
    //
    // `filter-picker-bodies.tsx` is deliberately absent: it holds FOUR picker
    // bodies, and only the actor one has a web counterpart that pinyin-matches.
    // Web's ProjectSubContent (issues-header.tsx:515-517) and LabelSubContent
    // (:608) both search with a bare `title`/`name.toLowerCase().includes(q)`
    // and no `matchesPinyin`, so mirroring pinyin there would *create* a
    // divergence rather than close one. That file is covered instead by the
    // assertion below, which pins the actor section to the helper while
    // leaving its project/label sections alone.
    const offenders: string[] = [];
    const strictFiles = PINYIN_PICKER_SITES.map((s) => s.file).filter(
      (f) => f !== "components/issue/pickers/filter-picker-bodies.tsx",
    );
    for (const file of strictFiles) {
      const src = code(file);
      const legacy = [
        /matchName\s*=\s*\([^)]*\)\s*=>\s*!q\s*\|\|\s*\w+\.toLowerCase\(\)\.includes\(q\)/,
        /const match\s*=\s*\([^)]*\)\s*=>\s*!q\s*\|\|\s*\w+\.toLowerCase\(\)\.includes\(q\)/,
      ];
      for (const pattern of legacy) {
        if (pattern.test(src)) offenders.push(`${file}: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("routes the issue-filter actor sections through the helper, not " +
    "the project/label ones", () => {
    // The issue filter sheet's `assignee` and `creator` dimensions share
    // FilterActorPickerBody, which mirrors web's ActorSubContent — the one
    // sub-content that DOES pinyin-match (:335-343). Its project section
    // mirrors ProjectSubContent and must keep the plain predicate, so this
    // asserts the count rather than mere presence.
    const src = code("components/issue/pickers/filter-picker-bodies.tsx");
    const calls = src.match(/matchesNameOrPinyin\(/g) ?? [];
    expect(calls).toHaveLength(3); // member + agent + squad
    const legacyCalls = src.match(/toLowerCase\(\)\.includes\(q\)/g) ?? [];
    expect(legacyCalls).toHaveLength(1); // the project section's, mirroring web
  });
});

describe("assignee picker usage sort", () => {
  const src = code("components/issue/pickers/assignee-picker-body.tsx");

  it("reads the frequency endpoint through its query options", () => {
    expect(src).toContain("assigneeFrequencyOptions");
    expect(src).toContain('from "@/data/queries/assignee-frequency"');
  });

  it("sorts every actor section by frequency", () => {
    // Three sections (member / agent / squad) — web sorts all three
    // (assignee-picker.tsx:132-138). One call per section is the assertion;
    // dropping one would leave that section alphabetical while the others
    // reorder, which reads as a bug rather than a preference.
    const calls = src.match(/sortByAssigneeFrequency\(/g) ?? [];
    expect(calls).toHaveLength(3);
  });

  it("builds the lookup with the shared map builder", () => {
    expect(src).toContain("buildAssigneeFrequencyMap");
  });

  it("keeps the pinned-selection rule that diverges from web", () => {
    // Mobile pins the current actor below Unassigned; web has no equivalent.
    // The frequency sort must not have replaced that product choice.
    expect(src).toContain("isRowSelected");
  });
});
