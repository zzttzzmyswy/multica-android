import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Wiring guards for iteration 267 — the screen/header halves of the two
 * parity changes, which no pure function can prove.
 *
 * Same source-reading approach the other `*-wiring` suites in this directory
 * use: the mobile screens are Expo Router routes whose render would drag in
 * the whole native module graph, so the thing under test is the SHAPE of the
 * call sites, not a render.
 */
const src = (rel: string): string => readFileSync(join(__dirname, rel), "utf8");

const SCREEN = src("../app/(app)/[workspace]/new-issue.tsx");
const HEADER = src("../components/ui/app-header-actions.tsx");
const STORE = src("../data/stores/new-issue-draft-store.ts");
const KEEP_OPEN = src("../lib/new-issue-keep-open.ts");

/** Body of `resetForNextIssueLocally` in the screen. */
function batchResetBody(): string {
  const match = SCREEN.match(
    /const resetForNextIssueLocally = useCallback\(\(\) => \{([\s\S]*?)\}, \[/,
  );
  if (!match) throw new Error("resetForNextIssueLocally not found");
  return match[1];
}

describe("MUL-7648 — a batch keeps the parent and its stage", () => {
  it("the batch reset no longer clears the parent", () => {
    // Before this iteration the reset called `setParentCleared(true)`, which
    // dropped a sub-issue parent on every "create another". A batch of
    // sub-issues under one parent is the case the feature exists for.
    expect(batchResetBody()).not.toMatch(/setParentCleared\(true\)/);
  });

  it("the batch reset no longer clears the stage pick", () => {
    // Stage is relative to the parent; clearing one without the other would
    // leave a form pointed at a parent with no stage, which is the half-state
    // that made this easy to get wrong.
    expect(batchResetBody()).not.toMatch(/useNewIssueStagePickStore/);
  });

  it("the stage pick is still bounded to the form's lifetime", () => {
    // Keeping it across a batch must not leak it past the form. The pick
    // store's unmount reset plus its parent tagging is what bounds it.
    expect(SCREEN).toMatch(/useNewIssueStagePick\(\);/);
  });

  it("the batch reset still clears both mention-input bodies", () => {
    // The store only MIRRORS these; the editor owns the text. Dropping these
    // would make the second issue of a batch open with the first one's body.
    const body = batchResetBody();
    expect(body).toMatch(/description\.setText\(""\)/);
    expect(body).toMatch(/promptInput\.setText\(""\)/);
  });

  it("the batch reset still spends the uploaded attachment ids", () => {
    // Those ids belong to the issue just created.
    expect(batchResetBody()).toMatch(/setUploadedAttachmentIds\(\[\]\)/);
  });

  it("the screen ends the continuation when the form unmounts", () => {
    // An untouched continuation must not survive as a fresh dialog's status.
    // Unmount (not "on submit") because the form closes four ways.
    expect(SCREEN).toMatch(
      /useEffect\(\s*\(\) => \(\) => \{\s*useNewIssueDraftStore\.getState\(\)\.endBatchContinuation\(\);/,
    );
  });

  it("the store keeps BOTH inherited fields", () => {
    expect(STORE).toMatch(/const \{ assignee, status \} = get\(\);/);
    expect(STORE).toMatch(
      /\.\.\.EMPTY_NEW_ISSUE_DRAFT,\s*assignee,\s*status,/,
    );
  });

  it("the store installs the continuation baseline", () => {
    expect(STORE).toMatch(/batchContinuationBaseline: next/);
  });

  it("the continuation is written through with its own baseline", () => {
    // Ordering bug the first cut had: writing before installing the baseline
    // made `writeThrough` classify the fresh draft as edited and persist the
    // inherited status — the exact thing persistence is supposed to prevent.
    expect(STORE).toMatch(/writeThrough\(next, next\);/);
  });

  it("a plain reset drops the baseline", () => {
    const body = STORE.match(/reset: \(\) => \{([\s\S]*?)\n    \},/);
    expect(body).not.toBeNull();
    expect(body![1]).toMatch(/batchContinuationBaseline: null/);
  });

  it("a workspace switch drops the baseline", () => {
    // The snapshot describes a draft that no longer exists.
    expect(STORE).toMatch(
      /hydrated: false,\s*batchContinuationBaseline: null,/,
    );
  });
});

describe("MUL-7648 — the entry point's dot is batch-aware", () => {
  it("the header uses the recoverable-intent rule, not raw content", () => {
    // Raw content would light the dot for every untouched continuation,
    // because the inherited status and assignee are content by that rule.
    expect(HEADER).toMatch(/draftHasRecoverableIntent\(s\)/);
    expect(HEADER).not.toMatch(/draftHasContent\(s\)/);
  });

  it("the recoverable-intent rule normalizes the two inherited fields", () => {
    const body = STORE.match(
      /export function draftHasRecoverableIntent\(([\s\S]*?)\n\}/,
    );
    expect(body).not.toBeNull();
    expect(body![1]).toMatch(/status: EMPTY_NEW_ISSUE_DRAFT\.status/);
    expect(body![1]).toMatch(/assignee: EMPTY_NEW_ISSUE_DRAFT\.assignee/);
    // ...and still consults the baseline, or an edited continuation whose only
    // edit is one of those two fields would read as untouched.
    expect(body![1]).toMatch(/batchFormChanged\(state, baseline\)/);
  });
});

describe("MUL-7648 — the pure reset shape agrees with the store", () => {
  it("nextIssueDraftReset has no status field", () => {
    // The store inherits it from live state; a status field here would be a
    // second, silently-winning source for the same value.
    const shape = KEEP_OPEN.match(
      /export interface NextIssueDraftReset \{([\s\S]*?)\n\}/,
    );
    expect(shape).not.toBeNull();
    expect(shape![1]).not.toMatch(/^\s*status:/m);
  });

  it("nextIssueDraftReset has no parent or stage field", () => {
    const shape = KEEP_OPEN.match(
      /export interface NextIssueDraftReset \{([\s\S]*?)\n\}/,
    )![1];
    expect(shape).not.toMatch(/^\s*parentIssueId:/m);
    expect(shape).not.toMatch(/^\s*stage:/m);
  });

  it("nextIssueDraftReset still clears the project", () => {
    // Unchanged by MUL-7648: a project belongs to the issue being filed.
    expect(KEEP_OPEN).toMatch(/project: undefined,/);
  });
});

describe("upstream priority-high — mobile mirrors the hex, not a class", () => {
  const ISSUE_ICON = src("../components/ui/priority-icon.tsx");
  const PROJECT_ICON = src("../components/ui/project-priority-icon.tsx");

  it("both icons carry the orange", () => {
    expect(ISSUE_ICON).toMatch(/high: "#f97316"/);
    expect(PROJECT_ICON).toMatch(/high: "#f97316"/);
  });

  it("neither icon's High still shares Medium's value", () => {
    expect(ISSUE_ICON).not.toMatch(/high: "#eab308"/);
    expect(PROJECT_ICON).not.toMatch(/high: "#eab308"/);
  });
});
