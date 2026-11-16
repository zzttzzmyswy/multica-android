/**
 * Wiring ratchet for iteration 293 (MYS-2889 follow-up) — the handoff EDITOR
 * has to reach the surface, not only the resolver.
 *
 * The pure suites prove every decision: which mode a handler reopens in, what
 * gets saved, whether the scope question is asked, whether Save is blocked.
 * They prove nothing about whether the editor is reachable, whether its Save
 * actually calls the mutation, or whether the read-only sentence is shown.
 * That gap is the shape of the defect this round removes: `setWorkflowHandoff`
 * had ZERO call sites in `apps/mobile`, so the whole write existed on paper and
 * nowhere on the phone.
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

describe("the handoff editor reaches the surface", () => {
  const editor = () => code("components/issue/workflow-handoff-editor.tsx");

  it("actually calls the save mutation", () => {
    // The defect being removed, stated as an assertion: before this round
    // nothing in `apps/mobile` called `setWorkflowHandoff` at all.
    const src = editor();
    expect(src).toContain("useSetWorkflowHandoff");
    // `mutateAsync`, not `mutate`: the sheet closes only once the server
    // accepted, so a refused save cannot look like a saved one.
    expect(src).toContain("save.mutateAsync(");
    expect(src).toContain("workflowId:");
    expect(src).toContain("statusKey");
  });

  it("sends only what savedHandoff keeps", () => {
    // A member handoff must not ship instructions the server would store, and
    // the next/back keys must be cleared with them. The editor therefore builds
    // its payload from `savedHandoff(draft)`, never from the raw draft.
    expect(editor()).toContain("savedHandoff(draft)");
  });

  it("carries the copy scope only when the user chose it", () => {
    // `copyForProjectId` is what turns a save into "copy the workflow for this
    // project". Sending it unconditionally would copy on every save; never
    // sending it would make the 「只有这个项目」 answer do nothing.
    const src = editor();
    expect(src).toContain("copyForProjectId");
    expect(src).toMatch(/askScope\s*&&\s*scope\s*===\s*"project"/);
  });

  it("gates editing on the permission hook, and says who may edit", () => {
    // The server refuses a non-owner non-admin with 403. Offering an editable
    // form is a promise the write cannot keep; hiding the FACT is a different
    // error, so the sheet opens read-only and names who can change it.
    const src = editor();
    expect(src).toContain("useWorkflowEditPermissions");
    expect(src).toContain("canEdit");
    expect(src).toContain("workflow.handoff.readOnly");
    expect(src).toContain("roleResolved");
  });

  it("blocks Save while a handler kind has no target, or nothing changed", () => {
    const src = editor();
    expect(src).toContain("handoffNeedsTarget");
    expect(src).toContain("isHandoffDirty");
  });

  it("asks the scope question through the shared predicate, not inline", () => {
    // Two copies of a five-part conjunction is two places to drift, and drifting
    // here means offering a project-scoped copy to someone who cannot switch.
    const src = editor();
    expect(src).toContain("handoffAsksSaveScope(");
    expect(src).toContain("handoffSharingProjects(");
  });

  it("keeps a FAILED brief read distinct from an empty brief", () => {
    // "Couldn't render it" and "this handler is told nothing" are different
    // claims. Collapsing them is the read-failure-as-absence defect this repo
    // has fixed four times.
    const src = editor();
    expect(src).toContain("query.isError");
    expect(src).toContain("workflow.handoff.briefFailed");
    expect(src).toContain("workflow.handoff.briefEmpty");
  });

  it("renders the three handoff modes as a radio group", () => {
    // The a11y contract: a mode is a choice among three, and a screen reader
    // has to be told that rather than hearing three unrelated buttons.
    const src = editor();
    expect(src).toContain('accessibilityRole="radiogroup"');
    expect(src).toContain('accessibilityRole="radio"');
    expect(src).toContain('"none"');
    expect(src).toContain('"agent"');
    expect(src).toContain('"member"');
  });
});

describe("the editor is reachable from the workflow card", () => {
  const card = () => code("components/issue/workflow-card.tsx");

  it("mounts the editor from the card's sheet", () => {
    // The entry point: web opens the handoff form from the board column badge;
    // a phone's pipeline view is this card, so its rows are the equivalent.
    const src = card();
    expect(src).toContain("<WorkflowHandoffEditor");
    expect(src).toContain("workflow={card.workflow}");
    expect(src).toContain("project={card.project}");
  });

  it("opens it for the row that was pressed", () => {
    const src = card();
    expect(src).toContain("onEdit={() => setEditing(step.statusKey)}");
    expect(src).toContain("statusKey={editing ?? \"\"}");
    expect(src).toContain("visible={editing !== null}");
  });

  it("does not offer the editor on a column that cannot hand off", () => {
    // backlog / done / cancelled never hand off, so a pressable row there would
    // open a form whose only legal answer is the one it already shows.
    expect(card()).toContain("statusAcceptsHandoff(step.statusKey)");
  });

  it("tells a screen reader the row is actionable, not only what it says", () => {
    // There is no chevron on these rows; without the verb in the label an
    // announcement is indistinguishable from the read-only version.
    const src = card();
    expect(src).toContain("accessibilityRole=\"button\"");
    expect(src).toContain("workflow.handoff.editAria");
    expect(src).toContain("workflow.handoff.noHandoffAria");
  });
});

describe("the write's cache effect is decided in one place", () => {
  const mutation = () => code("data/mutations/workflow-handoff.ts");

  it("patches on a plain save and invalidates on a copy", () => {
    const src = mutation();
    expect(src).toContain("handoffCacheEffect(");
    expect(src).toContain("invalidateCopy");
    expect(src).toContain("patchWorkflowInList");
  });

  it("reports its own failure through the shared channel", () => {
    // The sheet can be dismissed while the request is in flight; a hook-level
    // onError would go silent with its observer, and a refused save would look
    // like a saved one.
    expect(mutation()).toContain("WRITE_FAILURE_TITLE_KEY");
    expect(mutation()).toContain("workflow.handoff.saveFailed");
  });

  it("does not treat an empty id as a row to patch", () => {
    // A drifted body parses to `EMPTY_ISSUE_WORKFLOW` (id ""). Patching with it
    // would overwrite the cached row of the workflow the user did NOT edit.
    expect(mutation()).toContain('if (!input.saved?.id) return null;');
  });
});

describe("the API surface exists", () => {
  const api = () => code("data/api.ts");

  it("writes a handoff to the status-keyed endpoint, percent-encoding the key", () => {
    const src = api();
    expect(src).toContain("handoffs/${encodeURIComponent(statusKey)}");
    expect(src).toContain('method: "PUT"');
  });

  it("previews an unsaved brief", () => {
    expect(api()).toContain("/brief");
    expect(api()).toContain("previewWorkflowBrief");
  });

  it("degrades a drifted write body rather than throwing into the screen", () => {
    // Same contract as every other workflow read here: a body this build cannot
    // parse becomes the EMPTY row, which the mutation recognises as "nothing to
    // patch" and turns into an invalidate.
    expect(api()).toContain("EMPTY_ISSUE_WORKFLOW");
  });
});
