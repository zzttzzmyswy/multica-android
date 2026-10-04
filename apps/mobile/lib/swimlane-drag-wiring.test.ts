/**
 * Wiring guard for the swimlane lane-drag responder's stability (MYS-1524).
 *
 * A `PanResponder` carries its own `gestureState`. Rebuilding it mid-gesture
 * hands the native responder a fresh one, so the next move event accumulates
 * from zero instead of from the finger's real travel — the drag preview snaps
 * back to the slot it started in and the release commits nothing, because
 * `from === to` again.
 *
 * `LaneDragHandle` builds its responder in a `useMemo` keyed on the three
 * callbacks the parent passes down. `onLaneDrop` used to close over
 * `setStoredOrder` (a fresh arrow out of `useSetLaneOrder` on every render)
 * and `storedOrder`, so its identity changed on every parent render — and the
 * parent re-renders on every crossing, because that is what moves the preview.
 * Measured on a Pixel 5: `dy` went -113 → -29 across one render, the target
 * flipped 1 → 2, and the drop reported `from: 2, to: 2`.
 *
 * Mobile's vitest lane is Node-only (see vitest.config.ts) — there is no RN
 * renderer here, so this reads the source. Comments are stripped first, so a
 * comment quoting a call cannot satisfy an assertion.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// This file lives in `lib/`, so one level up is the mobile app root.
const APP_ROOT = path.resolve(__dirname, "..");

const SWIMLANE_VIEW = "components/issue/swimlane-view.tsx";

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** The body of a `const <name> = useCallback(` … `}, [deps]);` block. */
function callbackBlock(src: string, name: string): string {
  const start = src.indexOf(`const ${name} = useCallback(`);
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf(");", src.indexOf("}, [", start));
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end + 2);
}

describe("swimlane lane drag responder stability", () => {
  const src = code(SWIMLANE_VIEW);

  it("keeps the drop handler's identity stable across renders", () => {
    // An empty dep list is the whole point: `onLaneDrop` feeds the handle's
    // `useMemo`, and a new identity there swaps the responder mid-drag.
    const block = callbackBlock(src, "onLaneDrop");
    expect(block).toMatch(/\}, \[\]\);\s*$/);
  });

  it("reads the persisted order and its setter through refs", () => {
    // Both change identity every render — the setter because
    // `useSetLaneOrder` returns a new closure, the order because committing
    // writes it. Reading either directly would re-introduce the unstable
    // `useCallback` dependency this guard exists to prevent.
    const block = callbackBlock(src, "onLaneDrop");
    expect(block).toContain("storedOrderRef.current");
    expect(block).toContain("setStoredOrderRef.current");
    expect(block).not.toMatch(/setStoredOrder\(/);
    expect(src).toMatch(/storedOrderRef = useRef\(storedOrder\)/);
    expect(src).toMatch(/setStoredOrderRef = useRef\(setStoredOrder\)/);
  });

  it("keeps the other two drag callbacks stable as well", () => {
    for (const name of ["onLaneDragStart", "onLaneDragTo"]) {
      expect(callbackBlock(src, name)).toMatch(/\}, \[\]\);\s*$/);
    }
  });

  it("builds the handle's responder from those three callbacks only", () => {
    // Anything else in the dep list is a value that changes per render, which
    // rebuilds the responder for the same reason.
    expect(src).toMatch(
      /PanResponder\.create\(\{[\s\S]*?\}\),\s*\[onDragStart, onDragTo, onDrop\],/,
    );
  });

  it("still commits through mergeLaneOrder so hidden lanes keep their slots", () => {
    const block = callbackBlock(src, "onLaneDrop");
    expect(block).toContain("mergeLaneOrder({");
    expect(block).toMatch(/from: from - pinned/);
    expect(block).toMatch(/to: to - pinned/);
  });

  it("still refuses to write when the drag never left its slot", () => {
    const block = callbackBlock(src, "onLaneDrop");
    expect(block).toMatch(/if \(from === to\) return;/);
  });
});
