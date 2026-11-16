/**
 * Wiring ratchet for iteration 294 — the workflow MANAGER has to reach the
 * surface, not only the resolver.
 *
 * The pure suite (`lib/workflow-editor.test.ts`) proves every decision: board
 * order, what a save sends, when a dry run is required, when deleting is
 * refused, who may create versus edit. It proves nothing about whether any of
 * it is reachable from the app.
 *
 * That gap is exactly the defect this round removes. Before it,
 * `createIssueWorkflow` / `updateIssueWorkflow` / `deleteIssueWorkflow` had
 * ZERO call sites in `apps/mobile`, and there was no workflows screen at all —
 * the whole 「管」 half of a workflow existed on the desktop only. A test that
 * only exercised `lib/` would have gone green against that state.
 *
 * Comments are stripped before matching, so a comment DESCRIBING a call cannot
 * satisfy an assertion about it.
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

const LIST = "app/(app)/[workspace]/more/settings/workflows/index.tsx";
const EDITOR = "app/(app)/[workspace]/more/settings/workflows/[id].tsx";
const MUTATIONS = "data/mutations/workflow-editor.ts";
const API = "data/api.ts";
const SETTINGS = "app/(app)/[workspace]/more/settings.tsx";
const LAYOUT = "app/(app)/[workspace]/_layout.tsx";

describe("the three write endpoints exist on the API", () => {
  const api = () => code(API);

  it("creates, updates and deletes with the server's own shapes", () => {
    const src = api();
    expect(src).toContain("async createIssueWorkflow(");
    expect(src).toContain('method: "POST"');
    expect(src).toContain("async updateIssueWorkflow(");
    expect(src).toContain("async deleteIssueWorkflow(");
    expect(src).toContain('method: "DELETE"');
  });

  it("sends dry_run explicitly on both edit paths", () => {
    // The same endpoint answers a dry run. Spelling the flag out at both call
    // sites is what keeps them from looking interchangeable to a later reader.
    const src = api();
    expect(src).toContain("async dryRunIssueWorkflowUpdate(");
    expect(src).toContain("dry_run: true");
    expect(src).toContain("dry_run: false");
  });

  it("returns the created row rather than discarding it", () => {
    // The editor navigates to the created workflow. A void return would make
    // that impossible without a second read.
    expect(api()).toMatch(/async createIssueWorkflow\(data: IssueWorkflowWriteRequest\): Promise<IssueWorkflow>/);
  });
});

describe("the editor screen", () => {
  const editor = () => code(EDITOR);

  it("saves through the shared write builder, not an inline body", () => {
    // Two places composing `steps` is two places to drift from the server's
    // arrangement rules.
    const src = editor();
    expect(src).toContain("buildWriteRequest(");
    expect(src).toContain("useCreateIssueWorkflow");
    expect(src).toContain("useUpdateIssueWorkflow");
    // `mutateAsync`: the screen closes only once the server accepted, so a
    // refused save cannot look like a saved one.
    expect(src).toContain("create.mutateAsync(");
    expect(src).toContain("update.mutateAsync(");
  });

  it("asks for the mapping plan BEFORE the write that drops a status", () => {
    // The defect: a straight PATCH meets 409 with a plan the user never saw.
    const src = editor();
    expect(src).toContain("saveNeedsDryRun(");
    expect(src).toContain("dryRunIssueWorkflowUpdate(");
    expect(src).toContain("<WorkflowMappingDialog");
  });

  it("blocks the save for a status only an admin can create", () => {
    const src = editor();
    expect(src).toContain("missingStatusNames(");
    expect(src).toContain("canCreateStatus");
    expect(src).toContain("workflow.editor.statusNeedsAdmin");
  });

  it("orders only the middle columns, and never the pinned ends", () => {
    // `moveColumn` refuses to touch a pinned key; the row renders its arrows
    // only when the column is not pinned.
    const src = editor();
    expect(src).toContain("moveColumn(");
    expect(src).toContain("isPinnedStatus(");
    expect(src).toContain("toggleOptionalColumn(");
  });

  it("reuses the shared handoff fields instead of a second form", () => {
    // `apps/mobile/CLAUDE.md` Principle 1: extend the existing pattern. A
    // second copy of 「交给谁 / 说明 / 完成时移到」 is the fork to avoid.
    const src = editor();
    expect(src).toContain("<HandoffFields");
    expect(src).not.toContain("accessibilityRole=\"radiogroup\"");
  });

  it("will not navigate to a workflow the create response did not name", () => {
    // A drifted body parses to the EMPTY row (id ""). Landing on
    // `/workflows/` would render not-found for a workflow that WAS created.
    expect(editor()).toContain("if (created.id && wsSlug)");
  });

  it("refuses delete for Default and for an in-use workflow before sending", () => {
    const src = editor();
    expect(src).toContain("deleteBlocked(");
    expect(src).toContain("workflow.settings.deleteDefaultBlocked");
    expect(src).toContain("workflow.settings.deleteInUse");
  });

  it("does not offer an edit affordance to someone who may not edit", () => {
    const src = editor();
    expect(src).toContain("useWorkflowManagePermissions");
    expect(src).toContain("workflow.editor.readOnly");
  });
});

describe("the list screen", () => {
  const list = () => code(LIST);

  it("is reachable from Settings", () => {
    // The entry point. Web renders this as a settings tab; mobile's settings is
    // a list of push screens, so the divergence is one row — recorded here so
    // removing that row fails a test rather than only the feature.
    const src = code(SETTINGS);
    expect(src).toContain("goWorkflows");
    expect(src).toContain("settings.workflowsTitle");
    expect(src).toContain("more/settings/workflows");
  });

  it("is registered as routes, list and editor separately", () => {
    const src = code(LAYOUT);
    expect(src).toContain('name="more/settings/workflows/index"');
    expect(src).toContain('name="more/settings/workflows/[id]"');
  });

  it("keeps a failed read distinct from an empty workspace", () => {
    // Painting 「还没有工作流」 over a failed read invites someone to build a
    // workflow the workspace already has. The four-way branch is a pure
    // decision (`workflowListState`, covered behaviourally in
    // `lib/workflow-editor.test.ts`); this asserts the screen USES it rather
    // than re-deriving the branch inline, which is how the ordering inverts.
    const src = list();
    expect(src).toContain("workflowListState(");
    expect(src).toContain('view === "failed"');
    expect(src).toContain('view === "ready"');
    expect(src).toContain("workflow.settings.loadFailed");
    expect(src).toContain("workflow.settings.empty");
  });

  it("offers create to any member, and delete only where it would succeed", () => {
    const src = list();
    expect(src).toContain("permissions.canCreate");
    expect(src).toContain("deleteBlocked({ workflow }).blocked");
    expect(src).toContain("canEdit={permissions.canEdit(");
  });
});

describe("the write hooks' cache contract", () => {
  const mutations = () => code(MUTATIONS);

  it("invalidates the issue caches, because an edit remaps issues", () => {
    // The one that is easy to miss: dropping a column MOVES issues, so the
    // board is as stale as the workflow row.
    const src = mutations();
    expect(src).toContain("workflowKeys.all(wsId)");
    expect(src).toContain("issueKeys.all(wsId)");
    expect(src).toContain("onSettled");
  });

  it("adds the project list on delete only", () => {
    // A delete can change a project's `workflow_id`; a rename cannot.
    const src = mutations();
    expect(src).toContain("workflowDeleteInvalidationKeys");
    expect(src).toContain("projectKeys.list(wsId)");
  });

  it("reports failures through the shared channel, with its own titles", () => {
    const src = mutations();
    expect(src).toContain("WRITE_FAILURE_TITLE_KEY");
    expect(src).toContain("workflow.editor.saveFailed");
    expect(src).toContain("workflow.settings.deleteFailed");
    // A 403 is an expected answer on delete — ownership can change between the
    // menu opening and the confirm.
    expect(src).toContain("WRITE_FAILURE_PERMISSION_KEY");
  });
});
