/**
 * Wiring ratchet for iteration 281 (MYS-2539) — the agent-running condition
 * has to reach the SCREEN, not just the codec.
 *
 * The pure suite proves `viewQueryFromSnapshot` writes web's key and
 * `resetFiltersTo` reads it back. It proves nothing about whether the three
 * issue surfaces pass the field in, or whether the chip bar renders it. That
 * gap is the exact shape of the defect this round fixes: mobile carried a
 * perfect `workingOnly` predicate for years while the VIEW layer never saw it.
 *
 * Comments are stripped before matching, so a comment describing a branch
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

const SURFACES = [
  "app/(app)/[workspace]/more/issues.tsx",
  "app/(app)/[workspace]/(tabs)/my-issues.tsx",
  "components/project/project-issue-surface.tsx",
];

describe("every issue surface carries the condition into its view snapshot", () => {
  for (const rel of SURFACES) {
    it(`${rel} spreads filterState into snapshotSource`, () => {
      // `filterState` is the object that carries `workingOnly`; the saved-view
      // payload and the "modified" comparison both read this spread. A surface
      // that rebuilt the source field-by-field would strand the condition
      // outside the view contract again.
      const src = code(rel);
      const start = src.indexOf("const snapshotSource = useMemo(");
      expect(start, "snapshotSource is gone or renamed").toBeGreaterThan(-1);
      const block = src.slice(start, src.indexOf(");", start));
      expect(block).toContain("...filterState");
    });

    it(`${rel} wires onClearAgentRunning to the store's toggle`, () => {
      // Without this prop the chip renders but its × does nothing.
      const src = code(rel);
      expect(src).toContain("onClearAgentRunning={");
      expect(src).toMatch(/getState\(\)\.toggleWorkingOnly\(\)/);
    });
  }
});

describe("the chip bar renders the condition", () => {
  const chrome = code("components/issue/issue-surface-chrome.tsx");

  it("gates the chip on the delta, not on the raw field", () => {
    // `delta.agentRunning` already subtracts the open view's own condition, so
    // a view that fixes it does not paint a chip the user never added. Reading
    // `filterState.workingOnly` directly here would do exactly that.
    expect(chrome).toContain("if (delta.agentRunning)");
    expect(chrome).not.toMatch(
      /chips\.push\(\{[\s\S]{0,120}key: "agent-running"[\s\S]{0,120}filterState\.workingOnly/,
    );
  });

  it("clears through the dimension reset so an open view is honoured", () => {
    // `remove("agentRunning", …)` returns the dimension to the view's value
    // when a view is open; calling `onClearAgentRunning` unconditionally would
    // silently edit the view.
    expect(chrome).toContain('remove("agentRunning", onClearAgentRunning)');
  });
});

describe("the filter sheet shows the condition as view-fixed", () => {
  const sheet = code("app/(app)/[workspace]/issues-filter.tsx");

  it("pins the row only when the view fixes it ON", () => {
    // Only the ON direction may lock the row: a view that fixed it OFF does
    // not stop the user turning it on (that is a real addition, and the
    // "modified" dot is what reports it).
    expect(sheet).toContain("fixed={baseline?.agentRunningFilter === true}");
  });

  it("does not pass a toggle into the reset routine", () => {
    // `applyFilterReset` no longer takes a toggle — the condition rides in the
    // snapshot. A call site still passing one would be the old contract
    // half-restored, which is how the view's own `true` gets flipped off.
    expect(sheet).not.toContain("toggleWorkingOnly: act().toggleWorkingOnly");
  });
});
