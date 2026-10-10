import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Wiring ratchet for the single-issue assign run-confirm (iteration 229).
 *
 * `lib/run-confirm.test.ts` proves the decisions answer correctly, but none of
 * that reaches a user unless the picker route actually calls them. That is the
 * exact hole this iteration closes: mobile shipped the confirm dialog for its
 * BATCH toolbar and never for the single-issue path, so the same irreversible
 * action started an agent run on tap. The unit tests for that dialog passed the
 * whole time — they simply were not wired to the surface that needed them.
 *
 * Every new guarantee is asserted twice: that the good call is present, AND
 * that the old direct write is gone. An assertion on presence alone would pass
 * on a file that kept the bypass below the new branch, which is precisely the
 * shape a careless edit produces.
 *
 * Mobile's vitest lane is Node-only (see `vitest.config.ts`), so this is
 * asserted against source rather than against rendered markup — the convention
 * this repo already uses for wiring (`deliverables-wiring.test.ts`,
 * `picker-name-search-wiring.test.ts`).
 *
 * Comments are stripped before matching so a comment that merely describes the
 * wiring cannot satisfy an assertion.
 */
const APP_ROOT = path.resolve(__dirname, "..");

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const PICKER = "app/(app)/[workspace]/issue/[id]/picker/assignee.tsx";
const BATCH_BAR = "components/issue/batch-action-bar.tsx";
const DIALOG = "components/issue/assign-confirm-dialog.tsx";
const CHILDREN = "components/issue/issue-children-section.tsx";
const ATTR_ROW = "components/issue/attribute-row.tsx";
const NEW_ISSUE = "app/(app)/[workspace]/new-issue.tsx";
const HINT = "components/issue/create-run-hint.tsx";

describe("single-issue assign routes through the run-confirm dialog", () => {
  const picker = code(PICKER);

  it("consults the shared predicate instead of writing straight through", () => {
    expect(picker).toContain("singleAssignNeedsRunConfirm(");
  });

  it("opens the dialog for the agent/squad case", () => {
    expect(picker).toContain("<AssignConfirmDialog");
    expect(picker).toMatch(/setAssignTarget\(/);
  });

  it("no longer writes the assignee unconditionally in onChange", () => {
    // The pre-iteration shape was one branch that mutated on every pick. Every
    // write must now sit behind one of the three guards (clear / member /
    // no-confirm-needed), so a bare unconditional mutate would mean the bypass
    // survived underneath the new branch. The route's only mutate calls go
    // through `applyAndClose`, which is called three times from `onChange`'s
    // guarded branches and twice more from the dialog's footers.
    const onChange = picker.slice(picker.indexOf("onChange={"));
    const body = onChange.slice(0, onChange.indexOf("PickerBodyShell") + 1);
    // The direct `updateIssue.mutate({...})` inside onChange is gone.
    expect(body).not.toMatch(/updateIssue\.mutate\(\s*\{/);
    // …and every write it does make is the guarded helper.
    expect(body).toContain("applyAndClose(");
  });

  it("sends the two control fields through the shared payload builder", () => {
    // A hand-built payload here is how the batch and single paths would come
    // to disagree about suppress_run vs handoff_note.
    expect(picker).toContain("assignConfirmPayload(");
    expect(picker).not.toMatch(/suppress_run\s*:/);
    expect(picker).not.toMatch(/handoff_note\s*:/);
  });

  it("passes count=1, so the dialog uses the singular sentence", () => {
    expect(picker).toMatch(/count=\{1\}/);
  });
});

describe("the dialog is shared, not duplicated", () => {
  it("is imported by both the picker route and the batch toolbar", () => {
    expect(code(BATCH_BAR)).toContain("AssignConfirmDialog");
    expect(code(BATCH_BAR)).toMatch(/from\s+"@\/components\/issue\/assign-confirm-dialog"/);
    expect(code(PICKER)).toMatch(/from\s+"@\/components\/issue\/assign-confirm-dialog"/);
  });

  it("has exactly one definition in the app", () => {
    // `function AssignConfirmDialog` must appear in the shared component only,
    // and nowhere as a local declaration — a second copy is the fork this
    // extraction exists to prevent.
    for (const file of [BATCH_BAR, PICKER, CHILDREN, ATTR_ROW]) {
      expect(code(file), `${file} declares its own dialog`).not.toMatch(
        /function AssignConfirmDialog/,
      );
    }
    expect(code(DIALOG)).toMatch(/export function AssignConfirmDialog/);
  });

  it("fires no preview request on open", () => {
    // MUL-5010: the modal means "you are confirming an assignment", not "you
    // are confirming N runs". The old shape blocked the whole dialog behind a
    // spinner while it asked the server.
    expect(code(DIALOG)).not.toContain("previewIssueTrigger");
    expect(code(DIALOG)).not.toContain("useIssueTriggerPreview");
  });

  it("keeps the note box usable on the first frame — never disabled by a pending request", () => {
    const dialog = code(DIALOG);
    expect(dialog).toMatch(/maxLength=\{MAX_HANDOFF_NOTE\}/);
    // Since iteration 230 the box may also be disabled by the handoff gate (the
    // target runtime is positively too old to read the note). What must NOT
    // come back is the pre-MUL-5010 shape: the box grayed out because a request
    // had not answered yet. So the disable expression is pinned by name rather
    // than merely forbidden from containing "ready"/"preview".
    expect(dialog).toMatch(/editable=\{!busy && !noteDisabled\}/);
    expect(dialog).not.toMatch(/disabled=\{!?\s*(ready|resolved|preview)/);
    expect(dialog).not.toMatch(/editable=\{[^}]*preview/);
  });
});

/**
 * The handoff soft gate (iteration 230) — web `RunConfirmModal`'s
 * `noteDisabled` (`packages/views/modals/run-confirm.tsx:100-131`).
 *
 * `lib/run-confirm.test.ts` proves the verdict logic; none of it reaches a user
 * unless BOTH dialog hosts compute it and pass it down, and unless the write
 * path refuses the note as well as graying the box. Those are the three joints
 * asserted here, each paired with its negative so a partial edit cannot pass.
 */
describe("the handoff note gate is wired at both hosts and on the write path", () => {
  it("both hosts compute the verdict from the warm caches and pass it down", () => {
    for (const file of [PICKER, BATCH_BAR]) {
      expect(code(file), `${file} lacks the verdict call`).toContain(
        "handoffNoteDisabled(",
      );
      expect(code(file), `${file} lacks handoffVerdict`).toContain(
        "handoffVerdict(",
      );
      expect(code(file), `${file} does not pass noteDisabled`).toMatch(
        /noteDisabled=\{noteDisabled\}/,
      );
    }
  });

  it("resolves from cached lists, never from a new round-trip", () => {
    // The dialog must fire no request on open (MUL-5010). The verdict therefore
    // reads agent / runtime / squad lists via useQuery, which hit the shared
    // cache, and must NOT call the trigger-preview endpoint.
    for (const file of [PICKER, BATCH_BAR]) {
      const src = code(file);
      expect(src).toContain("agentListOptions(");
      expect(src).toContain("runtimeListOptions(");
      expect(src).toContain("squadListOptions(");
      expect(src, `${file} asks the server for the verdict`).not.toContain(
        "previewIssueTrigger",
      );
    }
  });

  it("the dialog renders the warning line only for a confident 'too old'", () => {
    const dialog = code(DIALOG);
    expect(dialog).toContain('t("runConfirm.noteUnsupported")');
    // The warning sits behind the gate, so a usable box shows no line about a
    // runtime it never determined to be old.
    expect(dialog).toMatch(/\{noteDisabled \? \(/);
    expect(dialog).toMatch(/\) : null\}/);
  });

  it("both write paths drop the note when it cannot be read", () => {
    // Graying the input is not enough: the text the user already typed is still
    // in state, so each payload build must be told about the gate.
    expect(code(PICKER)).toMatch(
      /assignConfirmPayload\(assignTarget, false, note, noteDisabled\)/,
    );
    expect(code(PICKER)).toMatch(
      /assignConfirmPayload\(assignTarget, true, note, noteDisabled\)/,
    );
    expect(code(BATCH_BAR)).toMatch(
      /assignConfirmPayload\(assignTarget, suppressRun, note, noteDisabled\)/,
    );
  });
});

describe("both assign entry points reach the same route", () => {
  it("the detail row's assignee chip and the sub-issue avatar share the picker", () => {
    // The sub-issue avatar edits a CHILD issue in place; it must land on the
    // same route (and therefore the same confirmation) as the detail chip.
    expect(code(CHILDREN)).toMatch(/openIssuePicker\(\s*"assignee"/);
    expect(code(ATTR_ROW)).toMatch(/openPicker\(\s*"assignee"\)/);
    // Both resolve to the one pathname the confirmation lives under.
    const routes = readFileSync(
      path.join(APP_ROOT, "lib/issue-picker-route.ts"),
      "utf8",
    );
    expect(routes).toMatch(
      /assignee:\s*"\/\[workspace\]\/issue\/\[id\]\/picker\/assignee"/,
    );
  });
});

describe("write-time control fields never reach the optimistic cache", () => {
  it("useUpdateIssue strips suppress_run and handoff_note", () => {
    const mutations = code("data/mutations/issues.ts");
    // Both must be destructured out of the patch before it is spread onto the
    // cached Issue — otherwise every optimistic row carries phantom fields.
    expect(mutations).toMatch(/suppress_run:\s*_suppressRun/);
    expect(mutations).toMatch(/handoff_note:\s*_handoffNote/);
  });
});

describe("the create form gained its pre-trigger caption", () => {
  it("mounts the hint on the manual form", () => {
    expect(code(NEW_ISSUE)).toContain("<CreateRunHint");
  });

  it("drives the caption from the backend predicate, never a local guess", () => {
    const hint = code(HINT);
    expect(hint).toContain("useIssueTriggerPreview(");
    expect(hint).toContain("createRunHintKind(");
    expect(hint).toContain("createRunHintKey(");
  });

  it("renders nothing until the predicate answers", () => {
    // The three-way state exists so the caption cannot flash "won't start" and
    // then correct itself. The rendered guard must test the resolved key, which
    // is null for the hidden kind.
    expect(code(HINT)).toMatch(/if\s*\(!key\s*\|\|\s*!assigneeId\)\s*return null/);
  });
});

describe("the api method exists and is serialized like web's", () => {
  it("previewIssueTrigger POSTs to the preview-trigger path", () => {
    const api = code("data/api.ts");
    expect(api).toContain('"/api/issues/preview-trigger"');
    expect(api).toMatch(/async previewIssueTrigger\(/);
    expect(api).toContain("IssueTriggerPreviewSchema");
  });
});
