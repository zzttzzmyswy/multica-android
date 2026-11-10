/**
 * Regression ratchet for MYS-2743: a drop that writes nothing must release the
 * board's settle lock, and a status write the gate cannot verify must not be a
 * silent no-op.
 *
 * ## Why these are text assertions, and what that can and cannot prove
 *
 * The board's gesture loop and the gate's React state have no renderer in this
 * vitest lane (see `vitest.config.ts`). What CAN be pinned here is the wiring
 * shape that the two defects came from — and text assertions are honest about
 * that limit, as long as each one names the symptom it stands in for.
 *
 * The behavioural half is covered elsewhere and must stay there:
 *   - `lib/handoff-pending.test.ts` drives the slot itself: abandon fires once,
 *     replacement abandons the incumbent, a confirmed write does NOT abandon.
 *   - `lib/handoff-gate.test.ts` covers which outcomes the predicate returns.
 *   - `lib/board-lane-lock.test.ts` drives the render-order decision that the
 *     stranded lock corrupted.
 *
 * So each assertion below is paired with the behaviour test that makes it
 * meaningful. An assertion that only checked "the string exists" would be the
 * exact paper trail that let the original defect through — the previous
 * iteration's `board-drag-wiring.test.ts:145` asserted the presence of
 * `const onSettled = () => setSettledLaneIds(null)` and still shipped a lock
 * that could never be released.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");

function source(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8");
}

function code(rel: string): string {
  return source(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const BOARD = "components/issue/board-view.tsx";
const GATE = "data/use-handoff-gate.ts";

describe("the board's settle lock has a release path for a write that never runs", () => {
  it("the card handle's commit takes an abandon hook alongside onSettled", () => {
    // Symptom without this: `commitDrop` engaged `settledLaneIds` and had only
    // the mutation's `onSettled` to release it, so a cancelled handoff sheet (or
    // a refusal at cold start) froze the board's lane order for the rest of the
    // screen's life — new issues never appeared, other members' moves never
    // showed.
    const src = code(BOARD);
    const iface = src.slice(src.indexOf("type CardHandle = {"));
    const commitType = iface.slice(0, iface.indexOf("openStatusSheet"));
    expect(commitType).toContain("onSettled");
    expect(commitType).toContain("onAbandon");
  });

  it("the drop passes both hooks into commit", () => {
    // The release must be attached where the lock is ENGAGED — in `commitDrop` —
    // not reconstructed somewhere the card cannot reach it.
    const src = code(BOARD);
    const drop = src.slice(src.indexOf("const onSettled = () => setSettledLaneIds(null)"));
    const call = drop.slice(0, drop.indexOf("};"));
    expect(call).toContain("const onAbandon = () => setSettledLaneIds(null)");
    // …and both are handed over, in the call itself.
    const invocation = call.slice(call.indexOf("handle.commit("));
    expect(invocation).toContain("onSettled,");
    expect(invocation).toContain("onAbandon,");
  });

  it("the card forwards the abandon hook to the gate it holds the write in", () => {
    // The hook has to reach the gate: a write held behind the handoff sheet is
    // the only path on which `onSettled` never fires.
    const src = code(BOARD);
    const start = src.indexOf("registerCard(issue.id,");
    const registration = src.slice(
      start,
      src.indexOf("openStatusSheet: () => sheetRef", start),
    );
    expect(registration).toContain("onAbandon");
    // It travels as the gate's third argument, not as a variable in scope.
    expect(registration).toMatch(/onAbandon\s*\}/);
  });

  it("the gate fires the abandon hook when the write is refused or cancelled", () => {
    // Symptom without this: the hook existed but nothing called it, so the lock
    // was released on exactly the paths that already released it.
    //
    // Asserted on `settlePending(..., "cancelled" | "unmounted")` rather than on
    // a helper name: the DECISION is what has to be right, and it is defined and
    // tested once in `lib/handoff-pending.ts` (`settlePending` returns
    // `run: null, abandoned: true` for both). A text assertion on a helper would
    // pass again the moment someone inlined the call.
    const gate = code(GATE);
    // Cancel. Bounded on the callback's OWN closing `}, []);` — a fixed-width
    // window ran on into the unmount effect below and passed even with the call
    // deleted, which is the "assertion that proves nothing" this file exists to
    // avoid.
    const cancelAt = gate.indexOf("const cancel = useCallback(");
    expect(cancelAt).toBeGreaterThan(-1);
    const cancel = gate.slice(cancelAt, gate.indexOf("}, []);", cancelAt));
    expect(cancel).toContain('settlePending(slot, "cancelled")');
    // …unmount (the card can go away mid-confirmation; the lock lives in the
    // BOARD, which outlives it). Anchored on the cleanup-return shape rather
    // than on the explanatory comment, which `code()` strips.
    const unmountAt = gate.indexOf("() => () =>");
    expect(unmountAt).toBeGreaterThan(-1);
    expect(gate.slice(unmountAt, unmountAt + 140)).toContain('settlePending(slot, "unmounted")');
  });

  it("a CONFIRMED write does not fire the abandon hook", () => {
    // The other half of the contract, and the reason `confirm` does not call
    // `abandonPending`: unlocking a write that is still in flight makes the card
    // jump back for a frame — the exact race the lock exists to prevent.
    const gate = code(GATE);
    const confirm = gate.slice(gate.indexOf("const confirm = useCallback<"));
    const body = confirm.slice(0, confirm.indexOf("[pending, preview]"));
    expect(body).not.toContain("abandonPending");
    // It still empties the slot, or a later unmount would abandon a write that
    // already ran.
    expect(body).toContain("held.current = null");
  });
});

describe("an unverifiable status write is not a silent no-op", () => {
  it("a `refuse` outcome holds the write instead of returning empty-handed", () => {
    // Symptom without this: the user long-pressed a board card, chose a column,
    // the sheet closed, and *nothing happened and nothing was said* — the code
    // claimed a surface rendered the "unverified" line, and none did. The move
    // is now deferred to the preview, which can still answer for this issue.
    const gate = code(GATE);
    const body = gate.slice(gate.indexOf("const gate = useCallback<HandoffGate[\"gate\"]>("));
    const fn = body.slice(0, body.indexOf("[issue, workflows, workflowState, projects]"));
    // The only outcome that writes immediately is the positively-established one.
    expect(fn).toContain("planForOutcome(outcome)");
    // Everything else is held and asks.
    expect(fn).toContain("holdPending(");
    expect(fn).toContain("setPending(target)");
    // And the old early return for `refuse` — the defect itself — is gone.
    expect(fn).not.toMatch(/outcome === "refuse"[\s\S]{0,120}return outcome;/);
  });

  it("both gates agree that `refuse` asks rather than discards", () => {
    // `planForOutcome` is where the decision lives; this pins the mapping the
    // hook depends on so a future edit to either file cannot quietly disagree.
    const pending = code("lib/handoff-pending.ts");
    const fn = pending.slice(pending.indexOf("export function planForOutcome"));
    const body = fn.slice(0, fn.indexOf("}"));
    expect(body).toContain('outcome === "apply" ? "write" : "ask"');
  });
});

describe("every surface that holds a write can release it", () => {
  const SURFACES = [
    "app/(app)/[workspace]/issue/[id]/picker/status.tsx",
    "app/(app)/[workspace]/issue/[id]/picker/project.tsx",
    BOARD,
    "components/issue/swimlane-view.tsx",
  ];

  it("the picker routes hold nothing, so their abandon hook is genuinely optional", () => {
    // Stated as an assertion rather than a comment: neither picker route does
    // work around the gate besides `router.back()` in `onWritten`, and neither
    // closes eagerly — so a withheld write leaves a live screen, not a dead one.
    for (const file of SURFACES.slice(0, 2)) {
      const src = code(file);
      expect(src).toContain("onWritten");
      expect(src).not.toContain("onAbandon");
    }
  });

  it("the board is the surface that MUST pass one", () => {
    // Regression guard against the obvious wrong fix: making the hook optional
    // and then not passing it where a lock is held.
    expect(code(BOARD)).toContain("onAbandon");
  });
});
