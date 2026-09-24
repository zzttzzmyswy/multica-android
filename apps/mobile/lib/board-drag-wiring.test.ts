/**
 * Wiring guard for the board's drag ↔ scroller exclusion and its drag/settle
 * locks (iteration 176, G6).
 *
 * Three things here fail without a stack trace and without looking broken in a
 * screenshot:
 *
 *   1. A scroller that stays live under a lifted card. The finger does not
 *      move, but the lane slides, so the drop lands on a slot nobody aimed at —
 *      and on the board's own horizontal scroller the same slip silently
 *      cancels the edge auto-pan's whole reason for existing.
 *   2. The board taking the pointer gesture before a card is lifted. Capture
 *      is what beats the board's ScrollView to the move, but capturing on
 *      touch-down would make the board unscrollable wherever a card happens to
 *      sit.
 *   3. The settle lock releasing too early. If the drop order is not frozen
 *      before the move mutation can invalidate anything, the settle refetch
 *      wins the race and the card visibly jumps home for a frame.
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

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const BOARD_VIEW = code("components/issue/board-view.tsx");
const ISSUE_MUTATIONS = code("data/mutations/issues.ts");

describe("board drag vs the scrollers", () => {
  it("freezes the board's horizontal scroller while a card is lifted", () => {
    expect(BOARD_VIEW).toContain("scrollEnabled={drag === null}");
  });

  it("freezes every lane's vertical scroller while a card is lifted", () => {
    expect(BOARD_VIEW).toContain("scrollEnabled={!dragging}");
  });

  it("only captures the gesture while a card is lifted", () => {
    // A responder that captured unconditionally would swallow the touch that
    // starts a lane or board scroll.
    expect(BOARD_VIEW).toMatch(
      /onMoveShouldSetResponderCapture:[\s\S]{0,200}?dragRef\.current !== null/,
    );
  });

  it("refuses to hand the gesture back while a card is lifted", () => {
    // The ScrollView's own JS pan responder asks on every move it sees. Left
    // to the default (agree), it talks the board out of a drag that is already
    // in flight and the card snaps home mid-gesture.
    expect(BOARD_VIEW).toMatch(
      /onResponderTerminationRequest:[\s\S]{0,400}?return dragRef\.current === null;/,
    );
  });

  it("captures rather than bubbling, so the board's ScrollView cannot win", () => {
    expect(BOARD_VIEW).not.toMatch(/onMoveShouldSetResponder:/);
  });

  it("marks the gesture as board-owned when it takes the responder", () => {
    // The card reads this on release to choose between the drop and the
    // status sheet; left unset, a real drag would also pop the sheet.
    expect(BOARD_VIEW).toMatch(
      /onResponderGrant:[\s\S]*?boardCapturedRef\.current = true/,
    );
  });

  it("clears that mark at the start of every lift", () => {
    expect(BOARD_VIEW).toMatch(
      /const onCardLift[\s\S]*?boardCapturedRef\.current = false/,
    );
  });

  it("keeps the lifted card's own Pressable mounted", () => {
    // The card's Pressable is what owns the gesture until the board captures
    // it, and a responder only ever transfers on a MOVE. Swapping the card for
    // a placeholder at lift — which is what this did first — unmounted that
    // Pressable, so a lift the user released without moving had no path back
    // and left the board holding a card on screen forever.
    expect(BOARD_VIEW).toContain("dimmed={lifted}");
    expect(BOARD_VIEW).not.toMatch(/if \(lifted\) \{\s*return/);
  });

  it("ends a gesture the board never took, from the card's own release", () => {
    expect(BOARD_VIEW).toMatch(
      /onPressOut=\{\(\) => \{[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?onLiftEnd\?\.\(\)/,
    );
  });

  it("marks the drop slot as its own row rather than moving the card", () => {
    expect(BOARD_VIEW).toContain("DROP_PLACEHOLDER");
    expect(BOARD_VIEW).toMatch(
      /\[targetLaneKey\]: \[\.\.\.lane\.slice\(0, at\), DROP_PLACEHOLDER/,
    );
  });

  it("collapses the lifted card's own row instead of unmounting it", () => {
    // The placeholder row alone leaves the lane a row taller than it will be
    // after the drop, so the whole lane jumped at lift. Collapsing the origin
    // row keeps the height constant — and it has to be a zero-height wrapper
    // rather than a swap, because the card's Pressable is the only path back
    // for a lift the board never captured.
    expect(BOARD_VIEW).toMatch(
      /const collapsed = item === collapsedId;[\s\S]{0,200}?height: 0, overflow: "hidden"/,
    );
    // The wrapper is styled, never swapped: rendering a bare View in the
    // card's place unmounted it, which unregistered the move handle the drop
    // needs and made every drop commit nothing.
    expect(BOARD_VIEW).toMatch(
      /const collapsed = item === collapsedId;[\s\S]{0,900}?<IssueCardWithMenu/,
    );
  });

  it("snaps back and writes nothing when the gesture is taken away", () => {
    const terminate = BOARD_VIEW.slice(
      BOARD_VIEW.indexOf("onResponderTerminate:"),
    ).slice(0, 200);
    expect(terminate).toContain("endDrag()");
    expect(terminate).not.toContain("commitDrop");
  });
});

describe("board drag locks", () => {
  it("engages the settle lock before the move mutation can run", () => {
    // Order is the whole point: the mutation's settle invalidates the list
    // queries, and a lock engaged after that would be re-deriving from a cache
    // that already moved the card.
    const frozen = BOARD_VIEW.indexOf("setSettledLaneIds(targetIds)");
    const committed = BOARD_VIEW.indexOf("handle.commit(");
    expect(frozen).toBeGreaterThan(-1);
    expect(committed).toBeGreaterThan(-1);
    expect(frozen).toBeLessThan(committed);
  });

  it("releases the lock on the settle path, not only on success", () => {
    expect(BOARD_VIEW).toMatch(
      /const onSettled = \(\) => setSettledLaneIds\(null\)/,
    );
  });

  it("renders the frozen order ahead of the live cache", () => {
    // Order matters: the settle lock outlives the drag, so it has to be read
    // first or a refetch landing mid-flight would yank the card. The drag's own
    // snapshot is the next fallback — rendering the live cache mid-gesture
    // would slide every measured slot out from under the finger.
    const settled = BOARD_VIEW.indexOf("if (settledLaneIds) return settledLaneIds;");
    const dragging = BOARD_VIEW.indexOf(
      "const base = dragSnapshot?.laneIds ?? cacheLaneIds;",
    );
    expect(settled).toBeGreaterThan(-1);
    expect(dragging).toBeGreaterThan(-1);
    expect(settled).toBeLessThan(dragging);
  });

  it("keeps the drag API free of per-frame state", () => {
    // `drag` is a new object on every pointer move. A `dragApi` whose identity
    // moved with it would bust every lane's memo and re-render every card on
    // the board 60 times a second — the cost that let the native scroller win
    // the gesture race at lift.
    const start = BOARD_VIEW.indexOf("const dragApi = useMemo<BoardDragApi>(");
    expect(start).toBeGreaterThan(-1);
    const memo = BOARD_VIEW.slice(start, BOARD_VIEW.indexOf(");", start));
    expect(memo).not.toMatch(/^\s*drag,\s*$/m);
    expect(BOARD_VIEW).toMatch(/dragging=\{drag !== null\}/);
  });

  it("clears the settle lock when there is no card to run the move", () => {
    // A drop whose card unmounted mid-gesture would otherwise strand the board
    // in the frozen order for the rest of the session.
    expect(BOARD_VIEW).toMatch(/\} else \{\s*onSettled\(\);\s*\}/);
  });
});

describe("board drag writes", () => {
  it("sends the server neighbours, not a client-computed position", () => {
    expect(BOARD_VIEW).toMatch(/move_intent: moveAnchors\(lane, at\)/);
  });

  it("keeps the status sheet reachable without the pointer gesture", () => {
    // A screen reader cannot drag; the sheet is its way to move a card.
    expect(BOARD_VIEW).toContain("openStatusSheet");
    expect(BOARD_VIEW).toMatch(
      /onAccessibilityAction[\s\S]*?moveToStatus[\s\S]*?showStatusSheet\(\)/,
    );
  });

  it("routes a move_intent through the move endpoint", () => {
    expect(ISSUE_MUTATIONS).toMatch(
      /if \(!moveIntent\) return api\.updateIssue\(issueId, patch\)/,
    );
    expect(ISSUE_MUTATIONS).toContain("api.moveIssue(issueId, {");
  });

  it("drops the provisional position from the move request", () => {
    // `position` is the client's guess for the optimistic frame; sending it
    // would let two clients' guesses race on the server.
    expect(ISSUE_MUTATIONS).toMatch(
      /const \{ position: _provisionalPosition, \.\.\.target \} = patch/,
    );
  });

  it("never lets move_intent reach the cache", () => {
    // It is a routing instruction, not an Issue column: spreading it into the
    // optimistic row would put a phantom field on every patched issue.
    expect(ISSUE_MUTATIONS).toMatch(
      /const \{ move_intent: _moveIntent, \.\.\.patch \} = vars/,
    );
  });
});
