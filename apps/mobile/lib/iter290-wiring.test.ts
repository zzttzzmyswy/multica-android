/**
 * Wiring ratchet for iteration 290 (MYS-2743) — the handoff confirmation has to
 * reach EVERY surface that can reassign an issue, not just the one that was
 * easiest to wire.
 *
 * The pure suites prove `qualifiesForHandoffGate` and `handoffGateKind` decide
 * correctly. They prove nothing about whether the four surfaces that can move
 * an issue actually call them. That gap is the exact shape of the defect this
 * round removes: the desktop had one dialog for all of them, the phone had none
 * — and a half-wired phone is worse than an unwired one, because the surfaces
 * that DO ask make the ones that don't look trustworthy.
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

/**
 * Every surface that can put an issue on a different status, and how.
 *
 * Four of them, from four different gestures: a tapped picker row, a board
 * card's action sheet, a swimlane card's long-press menu, and a dragged card.
 */
const STATUS_WRITE_SURFACES = [
  { file: "app/(app)/[workspace]/issue/[id]/picker/status.tsx", gesture: "picker row" },
  { file: "components/issue/board-view.tsx", gesture: "board card sheet + drop" },
  { file: "components/issue/swimlane-view.tsx", gesture: "swimlane long-press" },
];

describe("every status-write surface asks before a handoff", () => {
  for (const { file, gesture } of STATUS_WRITE_SURFACES) {
    it(`${file} (${gesture}) gates its write`, () => {
      const src = code(file);
      expect(src).toContain("useHandoffGate");
      expect(src).toContain("handoff.gate(");
      // …and renders the sheet that asks, or the gate would hold a write the
      // user can never release (the move would silently never happen).
      expect(src).toContain("HandoffConfirmDialog");
    });

    it(`${file} spreads the control field into the request`, () => {
      // `...control` is what carries `stop_previous_assignee_runs` from the
      // confirmation to the write. Without it the checkbox would be decorative
      // and the previous agent would keep running — the defect, intact.
      expect(code(file)).toMatch(/\.\.\.control\b/);
    });
  }

  it("the board's DRAG path is gated too, not only its sheet", () => {
    // A dropped card reassigns exactly like a tapped row. The board's drop
    // enters through `registerCard`'s `commit`, so that is where the gate has
    // to be — gating only `showStatusSheet` would leave every drag ungated,
    // and a drag is the most likely way to hit a handoff column by accident.
    const board = code("components/issue/board-view.tsx");
    const start = board.indexOf("registerCard(issue.id,");
    // Anchored on the registration's own closing brace, not on the first
    // `openStatusSheet:` in the file (the CardHandle TYPE declares one too,
    // and slicing to it would yield an empty window that fails a real check).
    const commit = board.slice(start, board.indexOf("openStatusSheet: () => sheetRef", start));
    expect(start).toBeGreaterThan(-1);
    expect(commit).toContain("handoffRef.current.gate(");
    expect(commit).toMatch(/\.\.\.control\b/);
  });
});

describe("the project move asks too", () => {
  const file = "app/(app)/[workspace]/issue/[id]/picker/project.tsx";

  it("gates a move into a project", () => {
    const src = code(file);
    expect(src).toContain("useHandoffGate");
    expect(src).toContain("handoff.gate(");
    expect(src).toContain("HandoffConfirmDialog");
    expect(src).toContain('kind: "project"');
  });

  it("sends enter_workflow_step so the confirmed handoff actually happens", () => {
    // Without this the move is administrative: the dialog would have described
    // a reassignment the write never performs. Upstream sends it with every
    // project move that enters a workflow column.
    expect(code(file)).toContain("enter_workflow_step: true");
  });

  it("leaves a move OUT of a project ungated", () => {
    // There is no destination workflow, so there is nothing to hand off — and
    // showing a confirmation for it would be a dialog about nothing. Asserted
    // on the call itself rather than on a slice: the branch is the one place
    // `project_id: null` reaches a write.
    const src = code(file);
    const cleared = src.slice(src.indexOf("if (!projectId) {"));
    expect(cleared).toContain("updateIssue.mutate({ project_id: null })");
    // …and it returns rather than falling through into the gated path.
    expect(cleared.slice(0, cleared.indexOf("handoff.gate("))).toContain("return;");
  });
});

describe("the dialog only opens on a chosen target", () => {
  // Regression for a defect the real device caught and no unit test did: every
  // call site passed the issue UNCONDITIONALLY, so the sheet mounted open on
  // first render with `{ kind: "status", status: "" }` — a title reading
  // 「将 MYS-2746 移到""？」 sitting over every status picker, on a screen where
  // the user had tapped nothing. Upstream's contract is
  // `issue={pending ? issue : null}`.
  const CALL_SITES = [
    "app/(app)/[workspace]/issue/[id]/picker/status.tsx",
    "app/(app)/[workspace]/issue/[id]/picker/project.tsx",
    "components/issue/board-view.tsx",
    "components/issue/swimlane-view.tsx",
  ];

  for (const file of CALL_SITES) {
    it(`${file} gates the dialog's \`issue\` on the pending target`, () => {
      const src = code(file);
      // Anchored on the HandoffConfirmDialog element so an `issue=` elsewhere
      // in the file cannot satisfy it.
      const at = src.indexOf("<HandoffConfirmDialog");
      expect(at).toBeGreaterThan(-1);
      const element = src.slice(at, src.indexOf("/>", at));
      expect(element).toMatch(/issue=\{[^}]*handoff\.pending/);
      // …and the ungated forms are gone.
      expect(element).not.toContain("issue={{ id: issue.id");
      expect(element).not.toMatch(/issue=\{issue \? \{ id: issue\.id/);
    });
  }
});

describe("a gated write is not cancelled by the sheet closing", () => {
  // Second defect the real device caught. Both picker surfaces are formSheet
  // ROUTES, and they used to call `router.back()` inside `onChange` — BEFORE
  // gating. That unmounted the route that hosts the gate's state and the
  // dialog, so the held write was discarded with the component: the sheet
  // closed, the dialog never appeared, and the status silently stayed put.
  // The fix moves the close into the gate's `onWritten` callback, which only
  // fires once a write has actually been issued.
  const PICKER_ROUTES = [
    "app/(app)/[workspace]/issue/[id]/picker/status.tsx",
    "app/(app)/[workspace]/issue/[id]/picker/project.tsx",
  ];

  for (const file of PICKER_ROUTES) {
    it(`${file} closes the sheet from onWritten, not before gating`, () => {
      const src = code(file);
      expect(src).toContain("onWritten");
      // The hook must be given the close callback…
      expect(src).toMatch(/useHandoffGate\(\s*issue\s*,\s*\{[^}]*onWritten/);
      // …and `router.back()` must not appear BEFORE the gate call inside
      // `onChange`, which is the exact shape of the bug.
      const onChangeAt = src.indexOf("onChange={");
      const gateAt = src.indexOf("handoff.gate(", onChangeAt);
      expect(onChangeAt).toBeGreaterThan(-1);
      expect(gateAt).toBeGreaterThan(onChangeAt);
      const beforeGate = src.slice(onChangeAt, gateAt);
      // A same-value early-return may close (nothing will be written for it),
      // so only an unconditional close ahead of the gate is the defect.
      const closes = beforeGate.includes("router.back()");
      if (closes) {
        // Every close in that window must sit inside a branch that RETURNS.
        expect(beforeGate).toMatch(/router\.back\(\);\s*(return;|\})/);
      }
    });
  }

  it("the gate calls onWritten on all three write paths", () => {
    // apply / confirmed / auto-applied-no-handoff. Missing any one leaves that
    // path's sheet stuck open over a write that did happen.
    const gate = code("data/use-handoff-gate.ts");
    const calls = gate.match(/onWrittenRef\.current\?\.\(\)/g) ?? [];
    expect(calls.length).toBe(3);
  });
});

describe("the control fields never reach the optimistic cache", () => {
  it("useUpdateIssue strips stop_previous_assignee_runs and enter_workflow_step", () => {
    const src = code("data/mutations/issues.ts");
    // They are write-time instructions, not `Issue` columns. Left in, every
    // optimistic row would carry fields no renderer reads and no response
    // confirms, and a stale `stop_previous_assignee_runs: true` would describe
    // a run that has already been stopped.
    expect(src).toContain("stop_previous_assignee_runs: _stopPreviousAssigneeRuns");
    expect(src).toContain("enter_workflow_step: _enterWorkflowStep");
  });

  it("a drag forwards the stop choice to the move endpoint", () => {
    // `moveIssue` is a different endpoint with its own allowlist; the field has
    // to be named explicitly or a handoff-by-drag leaves the old agent running.
    const src = code("data/mutations/issues.ts");
    const move = src.slice(src.indexOf("api.moveIssue("));
    expect(move.slice(0, 400)).toContain("stop_previous_assignee_runs");
  });
});
