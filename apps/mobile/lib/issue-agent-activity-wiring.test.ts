/**
 * Wiring guard for the "an agent is on this issue" badge.
 *
 * Mobile's vitest lane is Node-only (see vitest.config.ts) — no RN renderer —
 * so a correct `summarizeIssueActivity` that no row calls fixes nothing. Web
 * renders `IssueAgentActivityIndicator` in three dense surfaces (issue list
 * rows, board cards, inbox rows); this guard pins that mobile's three do the
 * same, that the inbox row keeps web's `issue_id` guard, and that the badge
 * rides the one workspace-wide snapshot instead of adding a per-row request.
 *
 * Matches call syntax after stripping comments, so a comment quoting the call
 * cannot satisfy an assertion.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// This file lives in `lib/`, so one level up is the mobile app root.
const APP_ROOT = path.resolve(__dirname, "..");

const INDICATOR = "components/issue/issue-agent-activity-indicator.tsx";
const LIST_ROW = "components/issue/issue-row.tsx";
const BOARD_CARD = "components/issue/board-card.tsx";
const INBOX_ROW = "components/inbox/inbox-row.tsx";
const RUNNING_ISSUES = "lib/running-issues.ts";

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("issue agent activity badge — the three dense surfaces", () => {
  it("renders the badge in the issue list row, keyed on the issue id", () => {
    expect(code(LIST_ROW)).toContain(
      "<IssueAgentActivityIndicator issueId={issue.id} />",
    );
  });

  it("renders the badge on the board card, keyed on the issue id", () => {
    expect(code(BOARD_CARD)).toContain("<IssueAgentActivityIndicator");
    expect(code(BOARD_CARD)).toMatch(
      /<IssueAgentActivityIndicator\s+issueId=\{issue\.id\}/,
    );
  });

  it("renders the badge in the inbox row, keyed on the row's issue id", () => {
    expect(code(INBOX_ROW)).toMatch(
      /<IssueAgentActivityIndicator\s+issueId=\{item\.issue_id\}/,
    );
  });

  it("keeps the inbox row's guard against issue-less notifications", () => {
    // `issue_id` is absent on some notification rows. Without the guard the
    // badge would be asked about "", which selects every chat- and
    // autopilot-spawned task in the workspace — web guards the same way
    // (inbox-list-item.tsx: `{item.issue_id && ...}`).
    expect(code(INBOX_ROW)).toMatch(/\{item\.issue_id \? \(/);
  });
});

describe("issue agent activity badge — where the data comes from", () => {
  const src = code(INDICATOR);

  it("reads the one workspace-wide task snapshot", () => {
    expect(src).toContain('from "@/data/queries/agent-task-snapshot"');
    expect(src).toContain("agentTaskSnapshotOptions(wsId)");
  });

  it("adds no per-row task request", () => {
    // The snapshot is a single cached query shared by every row and by the
    // "agents working now" filter. A per-issue fetch here would put one
    // request per visible row on the wire.
    expect(src).not.toContain("issueActiveTasksOptions");
    expect(src).not.toContain("listActiveTasksForIssue");
  });

  it("narrows the snapshot through the shared core selector", () => {
    expect(src).toContain(
      'from "@multica/core/issues/surface/issue-activity"',
    );
    expect(src).toMatch(
      /summarizeIssueActivity\(selectIssueTasks\(snapshot, issueId\)\)/,
    );
  });

  it("subscribes with a select so unrelated task moves skip the row", () => {
    expect(src).toMatch(/useQuery\(\{ \.\.\.agentTaskSnapshotOptions\(wsId\), select \}\)/);
  });

  it("stays a cue, not a second tap target inside the row", () => {
    // The row is already a Pressable; a nested pressable would swallow taps.
    expect(src).not.toContain("Pressable");
    expect(src).not.toContain("onPress");
  });
});

describe("running-issue projection has one definition", () => {
  it("re-exports the core projection instead of restating it", () => {
    expect(code(RUNNING_ISSUES)).toContain(
      'export { deriveRunningIssueIds } from "@multica/core/issues/surface/issue-activity"',
    );
  });

  it("carries no local copy of the running predicate", () => {
    // A local re-implementation would be free to drift from web's.
    expect(code(RUNNING_ISSUES)).not.toMatch(/task\.status !== "running"/);
  });
});
