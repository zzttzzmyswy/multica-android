/**
 * Wiring ratchet for iteration 291 (MYS-2874) — the handoff hint has to reach
 * every status picker row AND share its predicate with the gate.
 *
 * The pure suite (`lib/handoff-hint.test.ts`) proves the decision. It proves
 * nothing about whether a row draws it, and nothing about whether the row is
 * the one the user is about to tap. Comments are stripped before matching, so a
 * comment DESCRIBING a call site cannot satisfy an assertion about it.
 *
 * The assertions are deliberately about the SHAPE of the wiring rather than
 * about the rendered output: this lane has no RN renderer (see
 * `vitest.config.ts`), so a test that claimed to see the avatar would be a lie.
 * What it can do — and what actually broke in previous rounds — is catch a row
 * that forgot the hint, a hint computed from `handler.type` instead of the
 * shared predicate, and a row whose spoken label omits the sentence.
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

const PICKER_BODY = "components/issue/pickers/status-picker-body.tsx";
const HINT_ROW = "components/issue/handoff-hint.tsx";
const PURE = "lib/handoff-hint.ts";

describe("the status picker draws a handoff hint (MYS-2874)", () => {
  it("the picker body asks the pure module per row", () => {
    const src = code(PICKER_BODY);
    expect(src).toContain("statusHandoffHint(");
    // The per-row component is what lets the row own a hook; a hint computed
    // inside the groups `.map()` would call a hook a variable number of times.
    expect(src).toContain("function StatusPickerRow(");
    expect(src).toContain("useHandoffHintDisplay(");
    // …and it has to be RENDERED, or the resolution above is dead code.
    expect(src).toContain("<HandoffHintRow");
  });

  it("passes the project row through, so project_lead can be named", () => {
    // A `project_lead` step resolves through the PROJECT's lead fields; the id
    // alone cannot name a person. Dropping this prop degrades the hint to the
    // role noun — honest, but a regression against upstream, which names it.
    expect(code(PICKER_BODY)).toContain("projectLead={projectLead}");
    expect(code(PICKER_BODY)).toMatch(/project:\s*projectLead/);
  });

  it("hands the row the CURRENT status so its own row stays silent", () => {
    // The guard lives in the pure module, but it can only fire if the row
    // passes the current status down. Upstream's `option.key !== status`.
    expect(code(PICKER_BODY)).toMatch(/currentStatus[,}\s]/);
    expect(code(PURE)).toMatch(/statusKey === currentStatus/);
  });

  it("puts the sentence in the row's spoken label, not only on screen", () => {
    // A screen reader cannot see a glyph or an avatar. A hint that is only
    // visual announces 「进行中」 for a row that silently reassigns the issue —
    // the exact gap this iteration closes, moved from the eye to the ear.
    const src = code(PICKER_BODY);
    expect(src).toContain("accessibilityLabel=");
    expect(src).toContain("display.sentence");
  });
});

describe("the hint and the gate cannot diverge", () => {
  it("the pure module goes through stepHandsOff, never through handler.type", () => {
    // `stepHandsOff` is what `qualifiesForHandoffGate` reads to decide whether
    // to ask. A hint derived from `handler.type` directly could promise a
    // handoff the gate would write straight through — worse than no hint, since
    // the reader was told what would happen.
    const src = code(PURE);
    expect(src).toContain("stepHandsOff(");
    // The gate imports the same predicate from the same module.
    const gate = code("lib/handoff-gate.ts");
    expect(gate).toContain("stepHandsOff");
    expect(gate).toContain('from "@/lib/workflow"');
    expect(src).toContain('from "@/lib/workflow"');
  });

  it("the pure module reads defaultScope before workflow", () => {
    // Outside any project the Default workflow lists the columns but the
    // server applies no handoffs (`issueworkflow.OutsideProject`). Only
    // `defaultScope` distinguishes that case from a project on Default, and
    // both come through as a non-null `workflow`.
    const src = code(PURE);
    expect(src).toMatch(/if\s*\(scope\.defaultScope\)\s*return null/);
  });

  it("the hint hook exposes defaultScope so the picker can pass it", () => {
    const src = code("lib/status-options.ts");
    expect(src).toContain("defaultScope:");
    expect(src).toContain("defaultScope: scope.defaultScope");
  });
});

describe("the ActionSheet status surfaces carry the same hint as text", () => {
  // The board card's status sheet and the swimlane's long-press menu are where
  // most status changes actually happen, and neither can hold an avatar. If
  // they were left out, the hint would exist only on the one surface a member
  // reaches least — and the board's silent reassign would survive this round.
  const SHEET_SURFACES = [
    { file: "components/issue/board-view.tsx", gesture: "board card status sheet" },
    { file: "components/issue/swimlane-view.tsx", gesture: "swimlane long-press menu" },
  ];

  for (const { file, gesture } of SHEET_SURFACES) {
    it(`${file} (${gesture}) asks the shared resolver`, () => {
      const src = code(file);
      expect(src).toContain("useStatusHandoffLabel(");
      // …and the answer has to reach the OPTION LABELS, or the resolver is
      // dead code and the sheet still reads 「进行中」 with no warning.
      expect(src).toMatch(/handoffLabel\(\w+\.key\)/);
      expect(src).toContain("hint.sentence");
    });

    it(`${file} passes the scope and the project through`, () => {
      const src = code(file);
      // `defaultScope` is what suppresses the hint outside any project; without
      // it the sheet would promise handoffs the server does not apply.
      expect(src).toMatch(/scope:\s*\{\s*workflow,\s*defaultScope\s*\}/);
      expect(src).toContain("projectLead");
    });
  }

  it("the resolver is a callback, not a hook per status", () => {
    // The calling surfaces iterate statuses. A hook in the loop would break the
    // rules of hooks exactly as a hook inside the picker's `.map()` would.
    const src = code(HINT_ROW);
    expect(src).toContain("export function useStatusHandoffLabel(");
    expect(src).toContain("useCallback(");
  });
});

describe("nothing is drawn when there is nothing to say", () => {
  it("the hint row returns null rather than an empty slot", () => {
    // An empty View on every non-handoff row would break the alignment the
    // checkmark relies on, and reads as a rendering bug.
    const src = code(HINT_ROW);
    expect(src).toMatch(/if\s*\(!display\)\s*return null/);
  });

  it("the hint row is hidden from the accessibility tree", () => {
    // The sentence belongs to the ROW's label. Leaving the glyph group
    // announced as well makes a screen reader read the same row twice.
    const src = code(HINT_ROW);
    expect(src).toContain('importantForAccessibility="no-hide-descendants"');
  });
});
