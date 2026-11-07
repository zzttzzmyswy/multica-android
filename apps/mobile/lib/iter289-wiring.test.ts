/**
 * Wiring ratchet for iteration 289 (MYS-2690) — the project workflow binding
 * has to reach the SURFACES, not only the resolver.
 *
 * The pure suites prove `canManageProjectWorkflow` decides the right member,
 * that `projectWorkflowIdFor` sends `null` for Default, and that the plan
 * helpers word the count. They prove nothing about whether the property row
 * actually renders, whether the picker route actually dry-runs, or whether the
 * write actually sends the mapping. That gap is the exact shape of the defect
 * this round removes: mobile had every fact needed to show and change a
 * project's workflow and showed none of it.
 *
 * Comments are stripped before matching, so a comment DESCRIBING a call site
 * cannot satisfy an assertion about it.
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

describe("the project detail page shows the workflow property", () => {
  const section = () => code("components/project/project-properties-section.tsx");

  it("renders a workflow row at all", () => {
    // The defect in one line: before this round there was no such row, so a
    // phone user could not learn which pipeline a project runs.
    expect(section()).toContain("<WorkflowRow");
    expect(section()).toContain("workflow.project.label");
  });

  it("resolves the name through resolveProjectWorkflow, not from workflow_id", () => {
    // A project's `workflow_id` can be null (Default) or dangle (the workflow
    // was deleted). Rendering the raw id would print a UUID, and printing
    // "none" for null would claim the project has no workflow when it runs
    // Default.
    const src = section();
    expect(src).toContain("resolveProjectWorkflow(");
    expect(src).not.toMatch(/project\.workflow_id\s*\?\?/);
  });

  it("distinguishes a failed read from 'no workflows'", () => {
    // The hook exists to keep those apart (`data/queries/workflows.ts`). A row
    // that branches only on the array would paint 「Default」 for a failed read.
    const src = section();
    expect(src).toContain("state === \"failed\"");
    expect(src).toContain("workflow.project.unverified");
  });

  it("gates the press affordance on canManageProject", () => {
    // The server refuses a non-admin non-lead with 403. Offering the tap is a
    // promise the write cannot keep; hiding the FACT is a different error
    // (web renders the name to everyone), so the row must stay and only the
    // press go.
    const src = section();
    expect(src).toContain("canManageProject");
    expect(src).toContain("useProjectWorkflowPermissions");
  });

  it("is wired from the project detail screen", () => {
    const detail = code("app/(app)/[workspace]/project/[id].tsx");
    expect(detail).toContain("onPressWorkflow=");
    expect(detail).toContain("project/[id]/picker/workflow");
  });
});

describe("a failed switch is never silent", () => {
  const mutation = () => code("data/mutations/project-workflow.ts");
  const route = () => code("app/(app)/[workspace]/project/[id]/picker/workflow.tsx");

  it("takes the write off the shared channel", () => {
    // The 409 carries a PLAN the shared alert cannot turn into a dialog, so
    // this hook must report for itself — and therefore declare that it does.
    expect(mutation()).toContain("WRITE_FAILURE_HANDLED_KEY");
  });

  it("reports every failure path the refusal branch does not take", () => {
    // Opting out of the shared channel creates an obligation: silence on any
    // path is indistinguishable from a successful switch. The route must alert
    // on the non-refusal branch, not just dismiss.
    const src = route();
    const refusalBranch = src.indexOf("projectWorkflowWriteRefusal(");
    const alertAt = src.indexOf("Alert.alert(");
    expect(refusalBranch).toBeGreaterThan(-1);
    expect(alertAt).toBeGreaterThan(refusalBranch);
  });
});

describe("the picker route runs the switch in the safe order", () => {
  const route = () => code("app/(app)/[workspace]/project/[id]/picker/workflow.tsx");

  it("dry-runs before it writes", () => {
    // The whole point of the flow: the user must see WHICH statuses need a
    // destination before committing. A route that writes first turns the
    // server's 409 into the user's error message.
    const src = route();
    const dryRun = src.indexOf("dryRunProjectWorkflow(");
    const write = src.indexOf("setWorkflow.mutate(");
    expect(dryRun).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(-1);
    expect(dryRun).toBeLessThan(write);
  });

  it("sends the mapping through statusMappingPayload", () => {
    // Handing `mapping` straight through would send `{}` for a plan that needs
    // rows, and the server refuses that with a sentence naming raw keys.
    const src = route();
    expect(src).toContain("statusMappingPayload(");
  });

  it("short-circuits a choice that changes nothing", () => {
    // Re-picking the current workflow must not run a dry run, open a dialog
    // that moves nothing, and write the same value back.
    expect(route()).toContain("projectWorkflowChoiceChanges(");
  });

  it("recovers from a stale plan by re-opening the dialog with the server's", () => {
    // The 409 body carries a NEW plan. Without this branch the user reads an
    // agent-facing sentence and has no way to answer it.
    const src = route();
    expect(src).toContain("projectWorkflowWriteRefusal(");
    expect(src).toContain("fromRefusal");
  });

  it("keeps the sheet open when the DRY RUN failed", () => {
    // Nothing was written, so dismissing would be indistinguishable from a
    // successful switch. `router.back()` must not appear on that path.
    const src = route();
    const dryRunCatch = src.slice(src.indexOf("} catch {"), src.indexOf("} finally {"));
    expect(dryRunCatch.length).toBeGreaterThan(0);
    expect(dryRunCatch).not.toContain("router.back()");
    expect(src).toContain("workflow.project.checkFailed");
  });

  it("is registered as a form sheet, like its sibling pickers", () => {
    const layout = code("app/(app)/[workspace]/_layout.tsx");
    const registration = layout.slice(
      layout.indexOf('name="project/[id]/picker/workflow"'),
    );
    expect(layout).toContain('name="project/[id]/picker/workflow"');
    expect(registration.slice(0, 120)).toContain("SHEET_OPTIONS");
  });
});

describe("the mapping dialog offers only destinations the server accepts", () => {
  const dialog = () => code("components/project/workflow-mapping-dialog.tsx");

  it("limits the destination list to the target workflow's statuses", () => {
    // `checkMapping` refuses a destination outside the target workflow, so a
    // wider list would offer writes the server rejects.
    expect(dialog()).toContain("targetKeys.map(");
  });

  it("cannot be confirmed with a blank destination", () => {
    // A blank row is refused by the server with a message naming a raw key.
    const src = dialog();
    expect(src).toContain("statusMappingComplete(");
    expect(src).toMatch(/disabled=\{[^}]*complete/);
  });

  it("pre-fills from the plan", () => {
    expect(dialog()).toContain("defaultStatusMapping(");
  });
});

describe("the switch write refreshes every cache it changes", () => {
  const mutation = () => code("data/mutations/project-workflow.ts");

  it("invalidates projects, workflows and issues", () => {
    const src = mutation();
    expect(src).toContain("projectKeys");
    expect(src).toContain("workflowKeys");
    expect(src).toContain("issueKeys");
  });

  it("invalidates on settle, not only on success", () => {
    // A refused switch is how the client learns its plan was stale; the next
    // read is what corrects it. `onSuccess` alone would leave the stale copy.
    expect(mutation()).toContain("onSettled");
  });

  it("reports its failures through the shared channel", () => {
    expect(mutation()).toContain("WRITE_FAILURE_TITLE_KEY");
  });
});

describe("the API layer exposes the endpoint", () => {
  const apiCode = () => code("data/api.ts");

  it("has both the preview and the write on the project workflow path", () => {
    const src = apiCode();
    expect(src).toContain("async dryRunProjectWorkflow(");
    expect(src).toContain("async setProjectWorkflow(");
    expect(src).toContain("/api/projects/${projectId}/workflow");
  });

  it("parses the dry run defensively", () => {
    // A drifted body must degrade to "nothing to map", not throw into a sheet
    // — and the dangerous direction (a 0 count beside real rows) is corrected
    // in `mappingAffectedIssues`.
    const src = apiCode();
    const methodStart = src.indexOf("async dryRunProjectWorkflow(");
    const method = src.slice(methodStart, methodStart + 900);
    expect(method).toContain("parseWithFallback(");
    expect(method).toContain("IssueWorkflowDryRunResponseSchema");
  });

  it("does not swallow the write's error into a fallback", () => {
    // The 409's plan is the recovery path; a fallback would erase it.
    const src = apiCode();
    const methodStart = src.indexOf("async setProjectWorkflow(");
    const method = src.slice(methodStart, methodStart + 500);
    expect(method).not.toContain("parseWithFallback");
  });
});
