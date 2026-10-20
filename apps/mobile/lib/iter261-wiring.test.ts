/**
 * Wiring guards for iteration 261 (MYS-2255).
 *
 * The four gaps this round closes are all CALL-SITE relationships: a store that
 * exists but nobody resets, a prop threaded through three surfaces, a payload
 * field added in one file and read in another, a guard applied on the path a
 * user actually walks. Pure-function tests cannot see any of them — the stage
 * bug that motivated this round is exactly a store with a tested `reset()` that
 * production code never called.
 *
 * Each assertion is anchored to a STATEMENT or an exact expression, never to a
 * bare token. Iteration 260 learned this the hard way: a token match survives
 * the line being replaced by a constant whenever the surrounding comment
 * happens to contain the same words.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string =>
  readFileSync(resolve(here, "..", rel), "utf8");

describe("iteration 261 wiring", () => {
  describe("#1 the picked stage dies with the form", () => {
    const screen = src("app/(app)/[workspace]/new-issue.tsx");
    const store = src("data/stores/new-issue-stage-pick-store.ts");

    it("the create form scopes the pick to its own lifetime", () => {
      // The whole defect: `reset()` existed, was tested, and had no caller.
      // Anchored to the bare call so a comment mentioning the hook cannot
      // satisfy it.
      expect(screen).toMatch(/^\s*useNewIssueStagePick\(\);$/m);
    });

    it("the scoping hook actually resets on unmount", () => {
      // A hook that mounts without a cleanup would look identical at the call
      // site and fix nothing.
      expect(store).toMatch(
        /useEffect\(\(\) => \(\) => useNewIssueStagePickStore\.getState\(\)\.reset\(\), \[\]\)/,
      );
    });

    it("the form still reads the stage through the parent-tagged store", () => {
      // Regression guard for 260's fix: the reset must not be implemented by
      // dropping the parent tag (which would re-open the cross-parent leak).
      expect(screen).toMatch(
        /const stage = useNewIssueStagePickStore\(\(s\) => s\.stageFor\(parent\)\);/,
      );
    });

    it("the stage still only rides the payload with a parent", () => {
      expect(screen).toMatch(
        /parent\s*&&\s*stage\s*!=\s*null\s*\?\s*\{\s*stage\s*\}/,
      );
    });
  });

  describe("#2 a list row names its issue's project", () => {
    const row = src("components/issue/issue-row.tsx");
    const chrome = src("components/issue/issue-surface-chrome.tsx");

    it("IssueRow resolves the chip through the pure gate", () => {
      expect(row).toMatch(
        /const projectChip = issueRowProjectChip\(\{ issue, project, cardProperties \}\);/,
      );
    });

    it("IssueRow actually renders the chip", () => {
      expect(row).toMatch(/\{projectChip \? \(/);
      expect(row).toMatch(/<ProjectIcon icon=\{projectChip\.icon\} size="sm" \/>/);
    });

    it("IssueSelectionRow forwards both the project and the display toggles", () => {
      expect(chrome).toMatch(/^\s*project=\{project\}$/m);
      expect(chrome).toMatch(/^\s*cardProperties=\{cardProperties\}$/m);
    });

    // Each of the three list surfaces resolves from its OWN project read —
    // a surface that forgot the prop would silently render no chips at all,
    // which is indistinguishable from "this workspace has no projects".
    const SURFACES: { name: string; file: string }[] = [
      { name: "workspace issues", file: "app/(app)/[workspace]/more/issues.tsx" },
      { name: "my issues", file: "app/(app)/[workspace]/(tabs)/my-issues.tsx" },
      {
        name: "project issue surface",
        file: "components/project/project-issue-surface.tsx",
      },
    ];
    for (const surface of SURFACES) {
      it(`${surface.name}: reads the project catalog`, () => {
        expect(src(surface.file)).toMatch(
          /const \{ data: projects = \[\] \} = useQuery\(projectListOptions\(wsId\)\);/,
        );
      });
      it(`${surface.name}: passes the resolved project into the row`, () => {
        expect(src(surface.file)).toMatch(
          /project=\{findRowProject\(projects, item\.project_id\)\}/,
        );
      });
    }
  });

  describe("#3 a saved view carries the canvas-shape dimensions", () => {
    const bar = src("components/issue/issue-view-bar.tsx");
    const codec = src("data/stores/issue-view-codec.ts");
    const apply = src("lib/saved-view-apply.ts");

    it("the save payload includes all three", () => {
      expect(bar).toMatch(/^\s*swimlaneGrouping: slice\.swimlaneGrouping,$/m);
      expect(bar).toMatch(/^\s*tableColumns: slice\.tableColumns,$/m);
      expect(bar).toMatch(/^\s*tableColumnWidths: slice\.tableColumnWidths,$/m);
      expect(bar).toMatch(/^\s*tableGrouping: slice\.tableGrouping,$/m);
    });

    it("applying a view restores all three", () => {
      expect(apply).toMatch(/^\s*swimlaneGrouping: display\.swimlaneGrouping,$/m);
      expect(apply).toMatch(/^\s*tableColumns: display\.tableColumns,$/m);
      expect(apply).toMatch(/^\s*tableColumnWidths: display\.tableColumnWidths,$/m);
      expect(apply).toMatch(/^\s*tableGrouping: display\.tableGrouping,$/m);
    });

    it("the codec writes web's { key, width? }[] shape, not mobile's bare keys", () => {
      // Mobile keeps widths in a separate sparse bag; web keeps them inline.
      // Writing the bare array would drop every width on the first mobile save.
      expect(codec).toMatch(
        /tableColumns: state\.tableColumns\.map\(\(key\) => \{/,
      );
      expect(codec).toMatch(/return width == null \? \{ key \} : \{ key, width \};/);
    });

    it("the modified dot compares all three, or the change has no save route", () => {
      expect(codec).toMatch(/sameCanvasShape\(wantDisplay, slice, view\.display\)/);
    });

    it("the stale 'mobile has no such surface' claim is gone", () => {
      // That comment was quoted as the reason not to fix this. It has to go,
      // not merely be contradicted elsewhere in the file. (The correction
      // itself explains what the old claim said; this asserts the assertion
      // form — a sentence claiming the surfaces do not exist — is absent.)
      expect(codec).not.toMatch(/are still absent because mobile has no/);
    });

    // Every surface that saves a view has to feed the three fields into its
    // snapshot source, or the codec receives `undefined` and writes nothing.
    const SURFACES: { name: string; file: string }[] = [
      { name: "workspace issues", file: "app/(app)/[workspace]/more/issues.tsx" },
      { name: "my issues", file: "app/(app)/[workspace]/(tabs)/my-issues.tsx" },
      {
        name: "project issue surface",
        file: "components/project/project-issue-surface.tsx",
      },
    ];
    for (const surface of SURFACES) {
      it(`${surface.name}: feeds the canvas dimensions into its snapshot`, () => {
        const file = src(surface.file);
        // Inside the `snapshotSource` memo AND inside its dependency list, so
        // a change to any of them recomputes the "modified" verdict.
        const start = file.indexOf("const snapshotSource = useMemo(");
        expect(start).toBeGreaterThan(-1);
        const block = file.slice(start, file.indexOf(");", file.indexOf("],", start)));
        for (const field of [
          "swimlaneGrouping",
          "tableColumns",
          "tableColumnWidths",
          "tableGrouping",
        ]) {
          expect(block.match(new RegExp(field, "g"))?.length ?? 0).toBeGreaterThanOrEqual(2);
        }
      });
    }
  });

  describe("#4 squad roster offers role on add, and archived agents cannot lead", () => {
    const detail = src("app/(app)/[workspace]/more/squads/[id].tsx");
    const picker = src("components/squad/squad-member-picker.tsx");
    const guards = src("lib/squad-guards.ts");

    it("the add-member write carries the optional role", () => {
      expect(detail).toMatch(/\.\.\.squadMemberRoleField\(role\),/);
    });

    it("the write omits the field when blank instead of sending \"\"", () => {
      // Web sends `role: ""`, which reads back as "a role is set but empty"
      // on every later client.
      expect(guards).toMatch(
        /return trimmed\.length > 0 \? \{ role: trimmed \} : \{\};/,
      );
    });

    it("the member action sheet passes the archived flag to the guard", () => {
      expect(detail).toMatch(/targetArchived:/);
    });

    it("the guard reads the SERVER's archived status too, not just the directory", () => {
      // `agentListOptions` excludes archived agents, so the directory signal is
      // always false for the one member that matters — the roster's 「已归档」
      // pill reads the squad status endpoint, and a guard that ignored it
      // offered "make leader" on an archived agent. Found on-device.
      expect(guards).toMatch(
        /const archived = targetArchived === true \|\| targetStatus === "archived";/,
      );
      expect(detail).toMatch(
        /targetStatus: statusById\.get\(member\.member_id\)\?\.status,/,
      );
    });

    it("the guard blocks make-leader for an archived agent but keeps remove", () => {
      expect(guards).toMatch(
        /canSetLeader: target\.member_type === "agent" && !isLeader && !archived,/,
      );
      // `canRemove` must NOT gain an archived term — removing an archived row
      // is the fix, not a forbidden action.
      expect(guards).toMatch(/canRemove: !isLeader && !isSelf,/);
    });

    it("the picker filters through the shared rule, not its own copy", () => {
      expect(picker).toMatch(/availableSquadCandidates\(\{ agents, members, current: excluded \}\)/);
    });

    it("add mode takes a role step before writing", () => {
      expect(picker).toMatch(/setStaged\(\{ target, name \}\);/);
      expect(picker).toMatch(/onPick\(staged\.target, role\);/);
    });

    it("leader mode still confirms on the first tap (no role step)", () => {
      expect(picker).toMatch(/onPick\(target, ""\);/);
    });
  });
});
