/**
 * Wiring guards for iteration 262 (MYS-2268).
 *
 * All four gaps this round closes are CALL-SITE relationships, not pure
 * functions — a chip bar with a clear-all handler nobody wired, a search box
 * whose query never reaches the property section, a keep-open branch that
 * forgets to reset one of the two draft representations, a row that opens a
 * sheet with the wrong kind of selection. Pure-function tests cannot see any of
 * them; iteration 261's stage bug was exactly this shape (a tested `reset()`
 * with no caller).
 *
 * Every assertion is anchored to a statement or an exact expression, never to a
 * bare token: a token match survives the line being replaced by a constant
 * whenever a nearby comment happens to use the same word.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string =>
  readFileSync(resolve(here, "..", rel), "utf8");

describe("iteration 262 wiring", () => {
  describe("#1 the chip bar can clear everything at once", () => {
    const chrome = src("components/issue/issue-surface-chrome.tsx");
    const myIssues = src("app/(app)/[workspace]/(tabs)/my-issues.tsx");
    const issues = src("app/(app)/[workspace]/more/issues.tsx");
    const project = src("components/project/project-issue-surface.tsx");

    it("the bar renders a clear-all control", () => {
      expect(chrome).toMatch(/onPress=\{onClearAll\}/);
      expect(chrome).toMatch(/translate\("filter\.clearAll"\)/);
    });

    it("the shared hook implements BOTH branches, not just clearFilters", () => {
      // Web's `clearAll` has two branches. Implementing only `clearFilters()`
      // would silently edit the open view: its name would keep claiming
      // conditions the list no longer applies.
      expect(chrome).toMatch(/state\.resetFiltersTo\(baseline\.raw\)/);
      expect(chrome).toMatch(/state\.clearFilters\(\)/);
    });

    it("each of the three surfaces pairs the reset with the date clear", () => {
      // The date window is NOT in `IssueFilterSnapshot`, so `resetFiltersTo`
      // structurally cannot drop it. Web pairs every branch with
      // `onDateFilterChange?.(null)`; so must each surface. Asserted as an
      // exact statement inside the handler body so deleting the line fails —
      // a bare token match would survive the store name appearing elsewhere
      // on the page.
      const pairs: [string, string, string][] = [
        ["my-issues", myIssues, "useMyIssuesViewStore"],
        ["issues", issues, "useIssuesViewStore"],
        ["project", project, "useProjectIssuesViewStore"],
      ];
      for (const [name, screen, store] of pairs) {
        const handler = screen.match(
          new RegExp(
            `onClearAll=\\{\\(\\) => \\{([\\s\\S]*?)\\n\\s*\\}\\}`,
          ),
        );
        expect(handler, `${name}: no onClearAll handler`).not.toBeNull();
        const body = handler![1];
        expect(body, `${name}: must call clearAllChips()`).toMatch(
          /clearAllChips\(\);/,
        );
        expect(
          body,
          `${name}: must clear the date window the snapshot cannot carry`,
        ).toMatch(
          new RegExp(`${store}\\.getState\\(\\)\\.setDateFilter\\(null\\);`),
        );
      }
    });
  });

  describe("#2 the column picker searches both sections", () => {
    const table = src("components/issue/table-view.tsx");

    it("the picker renders a search input", () => {
      expect(table).toMatch(/placeholder=\{t\("table\.columnsSearch"\)\}/);
      expect(table).toMatch(/onChangeText=\{setSearch\}/);
    });

    it("the query is resolved over BOTH sections", () => {
      // A half-port (system columns filtered, properties not) is the failure
      // this asserts against: both maps must feed the one call.
      expect(table).toMatch(/const matched = useMemo\(/);
      expect(table).toMatch(/searchTableColumns\(/);
      expect(table).toMatch(/TABLE_SYSTEM_COLUMNS\.map\(/);
      expect(table).toMatch(/properties\.map\(/);
    });

    it("the rendered rows come from the matched sets, not the raw lists", () => {
      // The defect would be computing `matched` and then rendering
      // `TABLE_SYSTEM_COLUMNS.map` anyway — a search box that does nothing.
      expect(table).toMatch(/\{matched\.columns\.map\(/);
      expect(table).toMatch(/\{matched\.properties\.map\(/);
      expect(table).not.toMatch(/\{TABLE_SYSTEM_COLUMNS\.map\(/);
    });

    it("each section disappears on its own and an empty result says so", () => {
      expect(table).toMatch(/\{matched\.empty \? \(/);
      expect(table).toMatch(/\{matched\.columns\.length > 0 \? \(/);
      expect(table).toMatch(/\{matched\.properties\.length > 0 \? \(/);
    });
  });

  describe("#3 create-another keeps the form open on a clean draft", () => {
    const screen = src("app/(app)/[workspace]/new-issue.tsx");
    const draftStore = src("data/stores/new-issue-draft-store.ts");

    it("the form reads the persisted preference", () => {
      expect(screen).toMatch(/const keepOpen = useNewIssueKeepOpen\(wsId\);/);
    });

    it("a successful create branches on the preference in BOTH modes", () => {
      // Two submit paths (manual + agent). Wiring only one leaves the other
      // closing the form the user asked to keep open. Both must go through
      // the one `finishCreate`, which owns the branch.
      const calls = screen.match(/^\s*finishCreate\(\);$/gm) ?? [];
      expect(calls.length).toBe(2);
      // ...and the branch itself exists exactly once, in `finishCreate`.
      const branches = screen.match(/if \(keepOpen\) \{/g) ?? [];
      expect(branches.length).toBe(1);
    });

    it("the close branch both resets the draft and pops", () => {
      // Dropping the pop leaves the form permanently open; dropping the reset
      // makes the next open restore the issue just filed.
      expect(screen).toMatch(
        /if \(keepOpen\) \{\s*resetForNextIssueLocally\(\);\s*return;\s*\}\s*resetDraft\(\);\s*router\.back\(\);/,
      );
    });

    it("the batch reset keeps the assignee AND the status", () => {
      // The whole point of the feature: five tasks for one person must not
      // need five assignee picks, and (MUL-7648) five status picks either.
      // "Clear everything" looks correct and is not.
      expect(draftStore).toMatch(/const \{ assignee, status \} = get\(\);/);
      expect(draftStore).toMatch(
        /\.\.\.EMPTY_NEW_ISSUE_DRAFT,\s*assignee,\s*status,/,
      );
    });

    it("the batch reset records a continuation baseline", () => {
      // Without it an untouched continuation is indistinguishable from a
      // draft the user is working on, and every batch leaves a phantom dot.
      expect(draftStore).toMatch(/batchContinuationBaseline: next/);
    });

    it("the batch reset does NOT clear the module-level stage pick", () => {
      // MUL-7648 reversed MYS-2255's keep-open behaviour: the parent and its
      // stage now survive the batch, so clearing them here would undo the
      // feature. Lifetime is still bounded — `useNewIssueStagePick()` resets
      // on unmount, and the pick is tagged by parent.
      const body = screen.match(
        /const resetForNextIssueLocally = useCallback\(\(\) => \{([\s\S]*?)\}, \[/,
      );
      expect(body).not.toBeNull();
      expect(body![1]).not.toMatch(/useNewIssueStagePickStore/);
      // ...but the form still scopes the pick to its own lifetime.
      expect(screen).toMatch(/useNewIssueStagePick\(\);/);
    });

    it("the batch reset clears both mention-input bodies", () => {
      // The store only MIRRORS these; the editor owns the text. Resetting just
      // the store leaves the next issue showing the previous body.
      expect(screen).toMatch(/description\.setText\(""\)/);
      expect(screen).toMatch(/promptInput\.setText\(""\)/);
    });

    it("the batch reset keeps the parent", () => {
      // MUL-7648. Anchored INSIDE `resetForNextIssueLocally` because the
      // chip's own dismiss handler legitimately calls `setParentCleared(true)`
      // — a whole-file token match would pass even if the batch cleared it.
      const body = screen.match(
        /const resetForNextIssueLocally = useCallback\(\(\) => \{([\s\S]*?)\}, \[/,
      );
      expect(body).not.toBeNull();
      expect(body![1]).not.toMatch(/setParentCleared\(true\)/);
    });

    it("the batch reset's pieces all live in one function", () => {
      // The four reset obligations (draft store, both mention editors, stage
      // pick, parent) must travel together — splitting them across call sites
      // is how one submit path ends up doing three of the four.
      const body = screen.match(
        /const resetForNextIssueLocally = useCallback\(\(\) => \{([\s\S]*?)\}, \[/,
      )![1];
      expect(body).toMatch(/resetForNextIssue\(\)/);
      expect(body).toMatch(/description\.setText\(""\)/);
      expect(body).toMatch(/promptInput\.setText\(""\)/);
      expect(body).toMatch(/setUploadedAttachmentIds\(\[\]\)/);
    });
  });

  describe("#4 an agent's skill rows open a detail view", () => {
    const section = src("components/agent/agent-skills-section.tsx");
    const sheet = src("components/agent/agent-skill-detail-sheet.tsx");

    it("both kinds of row are pressable", () => {
      expect(section).toMatch(/setSelected\(workspaceSkillSelection\(skill\)\)/);
      expect(section).toMatch(/setSelected\(runtimeSkillSelection\(skill\)\)/);
    });

    it("the workspace read is scoped to a workspace selection only", () => {
      // A runtime skill's discovery key is not a workspace skill id; letting
      // it reach the endpoint would 404 and render as "deleted".
      expect(section).toMatch(
        /const selectedWorkspaceId =\s*selected\?\.kind === "workspace" \? selected\.id : "";/,
      );
      expect(section).toMatch(/enabled: !!wsId && selectedWorkspaceId !== ""/);
    });

    it("the toggle and remove affordances stay OUTSIDE the press target", () => {
      // Web keeps `setSelected` and the Switch/trash as siblings. Nesting
      // them inside one Pressable would swallow the Switch's taps.
      const labelPress = section.indexOf("workspaceSkillSelection(skill)");
      const removePress = section.indexOf("confirmRemove(skill.id, skill.name)");
      expect(labelPress).toBeGreaterThan(-1);
      expect(removePress).toBeGreaterThan(labelPress);
      // ...and the Pressable closes before the Switch starts.
      const between = section.slice(labelPress, removePress);
      expect(between).toMatch(/<\/Pressable>/);
    });

    it("the sheet distinguishes loading, failure and empty content", () => {
      expect(sheet).toMatch(/view\.kind === "workspace-loading"/);
      expect(sheet).toMatch(/view\.kind === "workspace-error"/);
      // The failure branch offers a retry, not just a message — otherwise the
      // only way out of a failed read is to close and reopen the sheet.
      expect(sheet).toMatch(/onPress=\{onRetry\}/);
    });
  });
});
