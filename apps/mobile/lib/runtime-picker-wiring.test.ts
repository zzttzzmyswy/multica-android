/**
 * Wiring guard for the agent-create runtime picker.
 *
 * The defect this iteration fixes was not a wrong helper — it was an UNWIRED
 * capability. `buildRuntimeMachines`, `filterRuntimeMachines` and
 * `runtimeRowLabel` all already existed with unit tests, and the sheet called
 * none of them; separately, the form pre-trimmed the list through
 * `usableRuntimes()` before the sheet ever saw it, so locked and offline
 * runtimes had no rendering path at all.
 *
 * Mobile's vitest lane is Node-only (see vitest.config.ts) — there is no RN
 * renderer, so this asserts on the constructs that carry the behaviour:
 * which module the sheet renders through, and what list the form hands it.
 * Comments are stripped first so a comment quoting a call cannot satisfy an
 * assertion.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");

const SHEET = "components/agent/runtime-picker-sheet.tsx";
const FORM = "components/agent/manual-agent-form.tsx";

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("runtime picker sheet wiring", () => {
  const sheet = code(SHEET);

  it("renders the grouped machines, not a flat runtimes.map", () => {
    // The module that owns grouping + search; asserting on the call keeps the
    // behaviour pinned without an RN renderer.
    expect(sheet).toContain("pickerMachines(");
  });

  it("labels each row against its machine", () => {
    expect(sheet).toContain("runtimeRowLabel(");
  });

  it("surfaces the search box and the scope toggle", () => {
    expect(sheet).toContain("RUNTIME_SEARCH_THRESHOLD");
    expect(sheet).toContain("hasOtherRuntimes(");
    expect(sheet).toContain("handleScopeChange(");
  });

  it("renders a locked row instead of dropping it", () => {
    // The whole point of the fix: a row the viewer may not use still renders,
    // carrying its reason. `isRuntimeRowLocked` gates the badge, not the row.
    expect(sheet).toContain("isRuntimeRowLocked(");
    expect(sheet).toContain("agents.runtimePicker.lockedReason");
  });

  it("does not pre-trim the list it is handed", () => {
    // A future edit that re-introduces `usableRuntimes(...)` filtering inside
    // the sheet would silently restore the original defect.
    expect(sheet).not.toContain("usableRuntimes(");
  });

  it("distinguishes the three empty states", () => {
    expect(sheet).toContain("pickerEmptyState(");
    expect(sheet).toContain("agents.runtimePicker.scopeEmpty");
    expect(sheet).toContain("agents.runtimePicker.noResults");
  });
});

describe("agent form hands the picker the full runtime list", () => {
  const form = code(FORM);

  it("passes the unfiltered query result as the picker's runtimes", () => {
    expect(form).toMatch(/<RuntimePickerSheet[\s\S]*?runtimes=\{runtimes\}/);
  });

  it("no longer passes a pre-filtered picker list", () => {
    expect(form).not.toContain("pickerRuntimes");
  });

  it("gives the picker the viewer id it needs to compute lock and scope", () => {
    expect(form).toMatch(
      /<RuntimePickerSheet[\s\S]*?currentUserId=\{currentUserId\}/,
    );
  });

  it("keeps usableRuntimes for the default selection only", () => {
    // Still used to seed — that is the part that must NOT change.
    expect(form).toContain("usableRuntimes(runtimes, currentUserId)");
  });
});

/**
 * The other three consumers. Each hands the sheet a list it has ALREADY scoped
 * (`usableRuntimes(...)`, or an online-and-not-current filter), so they must
 * pass `defaultFilter="all"`: leaving the default "mine" would silently hide a
 * colleague's public runtime those surfaces have always offered. They must also
 * pass the viewer id, or locked rows would render as pickable.
 */
describe("already-scoped callers open on All", () => {
  const CALLERS = [
    "app/(app)/[workspace]/more/agents/new/ai.tsx",
    "components/agent/builder-config-panel.tsx",
    "components/runtimes/mika-setup-card.tsx",
  ];

  for (const rel of CALLERS) {
    it(`${rel} pins the scope and the viewer`, () => {
      const src = code(rel);
      expect(src).toMatch(
        /<RuntimePickerSheet[\s\S]*?defaultFilter="all"[\s\S]*?\/>/,
      );
      expect(src).toMatch(
        /<RuntimePickerSheet[\s\S]*?currentUserId=\{currentUserId\}/,
      );
    });
  }

  it("the sheet's own default stays mine, matching web", () => {
    expect(code(SHEET)).toMatch(/defaultFilter\s*=\s*"mine"/);
  });
});
