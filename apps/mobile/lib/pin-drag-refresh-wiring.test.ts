/**
 * Wiring guard for the pinned list's drag ↔ pull-to-refresh exclusion
 * (MYS-1456).
 *
 * On Android the list's `RefreshControl` (`SwipeRefreshLayout`) claims a
 * vertical drag at touch slop whenever `canChildScrollUp()` is false — i.e.
 * while the list sits at the top, which is how the Pinned tab opens. It then
 * sends the handle's responder an ACTION_CANCEL about 8dp in, well before the
 * finger crosses the first row's midpoint, so no drop target is ever computed
 * and the reorder silently commits nothing. Measured on a Pixel 5: the
 * gesture died at |dy| ≈ 8.4 (JS units) against the ~83 needed to cross row 0.
 *
 * The fix disables the control for the duration of the gesture. These
 * assertions pin the three parts that make that work — the flag is raised on
 * grant, lowered on BOTH the release and the terminate path (a flag left set
 * would kill pull-to-refresh for the rest of the session), and the control is
 * disabled rather than unmounted (unmounting rebuilds the ScrollView and drops
 * the in-flight responder).
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

const PINNED_SCREEN = "components/pin/pinned-screen.tsx";

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("pinned list drag vs pull-to-refresh", () => {
  const src = code(PINNED_SCREEN);

  it("disables the refresh control while a drag is in flight", () => {
    expect(src).toContain("enabled={!dragging}");
  });

  it("keeps the drag flag out of the screen's own state", () => {
    // The disable has to reach the native layout before the finger crosses
    // touch slop. Holding the flag in `PinnedScreen` re-renders the whole row
    // list first, and on a Pixel 5 that delay lets a fast drag be cancelled
    // anyway (measured: ~92ms to slop loses, ~167ms wins). The flag therefore
    // lives in a store that only the refresh control subscribes to.
    expect(src).toContain("usePinDragStore");
    expect(src).not.toMatch(/const \[dragging, setDragging\] = useState/);
    expect(src).toMatch(/usePinDragStore\(\(s\) => s\.dragging\)/);
  });

  it("keeps the refresh control element stable across a drag", () => {
    // A rebuilt element would re-render the ScrollView and its rows, which is
    // the cost the store exists to avoid.
    expect(src).toMatch(/refreshControl = useMemo\(/);
    expect(src).toContain("refreshControl={refreshControl}");
  });

  it("forwards the ScrollView's content through the wrapper", () => {
    // `ScrollView` clones the `refreshControl` element and injects its own
    // content as that element's children. A wrapper that does not render them
    // paints an empty list — which is what a first cut of this did.
    expect(src).toMatch(/children\?: React\.ReactNode/);
    expect(src).toMatch(/\{children\}/);
  });

  it("builds that element before the screen's early returns", () => {
    // The loading / error / empty branches return before the list is built. A
    // hook placed after them is not reached on the loading render and is on
    // the loaded one, so React throws "Rendered more hooks than during the
    // previous render" — which is exactly what a first cut of this did.
    const memo = src.indexOf("refreshControl = useMemo(");
    const firstReturn = src.indexOf("if (isLoading) {");
    expect(memo).toBeGreaterThan(-1);
    expect(firstReturn).toBeGreaterThan(-1);
    expect(memo).toBeLessThan(firstReturn);
  });

  it("keeps the control mounted rather than swapping it out mid-drag", () => {
    // `refreshControl` must be unconditional: the `enabled` prop is what does
    // the work, because unmounting the control rebuilds the ScrollView.
    expect(src).toContain("refreshControl={");
    expect(src).not.toMatch(/refreshControl=\{[^}]*\?[^}]*:\s*(null|undefined)/);
  });

  it("raises the flag when the handle takes the gesture", () => {
    expect(src).toMatch(/onPanResponderGrant:[\s\S]*?onDragStart\(\)/);
    expect(src).toContain("onDragStart={() => setDragging(true)}");
  });

  it("lowers the flag on the release and the terminate path alike", () => {
    // Both paths funnel through `onDrop`; the reset must sit ahead of the
    // `!dragOrder` early return so a cancelled gesture still re-enables it.
    expect(src).toMatch(/onPanResponderRelease:[\s\S]*?onDrop\(\)/);
    expect(src).toMatch(/onPanResponderTerminate:[\s\S]*?onDrop\(\)/);
    expect(src).toMatch(/onDrop=\{\(\) => \{[\s\S]*?setDragging\(false\)/);
  });

  it("still refuses to commit a drag that never produced an order", () => {
    // Unchanged semantics: a gesture cancelled before the first row is crossed
    // leaves `dragOrder` null and must not write anything.
    expect(src).toMatch(
      /onDrop=\{\(\) => \{[\s\S]*?setDragging\(false\);\s*if \(!dragOrder\) return;/,
    );
  });
});
