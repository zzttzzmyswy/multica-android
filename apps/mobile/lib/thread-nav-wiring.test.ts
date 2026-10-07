/**
 * Wiring guard: the issue detail page must actually reach the thread
 * navigator, and the navigator must actually reach the timeline.
 *
 * The parity gap this pins (MYS-1974): web renders a searchable thread panel
 * in the issue header, but mobile had no navigator at all — `ThreadNavPanel`,
 * `ThreadMinimap` and `openThreadNav` had zero references under `apps/mobile`,
 * so a long issue could be searched only by scrolling.
 *
 * The ratchet is on the *call sites*, not on the helper's existence. The
 * preceding iteration learned this the expensive way: it shipped a correct
 * pinyin predicate that stayed green for a whole release because nothing
 * asserted any picker was wired to something that could feed it. So this file
 * asserts the chain end to end:
 *
 *   1. the issue screen renders the sheet and owns the open/close state,
 *   2. the header offers the entry point,
 *   3. a picked thread becomes a *fresh* jump (id + nonce), so re-picking the
 *      same thread re-fires the scroll instead of short-circuiting,
 *   4. the screen forwards the jump into `TimelineList`,
 *   5. `TimelineList` consumes it via `scrollToIndex` — not the deep-link's
 *      `startRenderingFromBottom`, which lands at the bottom of the document
 *      rather than on the chosen thread,
 *   6. both nonce guards exist, so the jump effect can re-fire.
 *
 * Removing any single link turns this red.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");
const ISSUE_SCREEN = "app/(app)/[workspace]/issue/[id].tsx";
const TIMELINE = "components/issue/timeline-list.tsx";
const SHEET = "components/issue/thread-nav-sheet.tsx";

function code(rel: string): string {
  // Comments describe the design and would let this pass on prose alone.
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("thread navigator wiring", () => {
  it("renders the sheet from the issue screen, driven by its own open state", () => {
    const src = code(ISSUE_SCREEN);
    expect(src).toContain("ThreadNavSheet");
    expect(src).toMatch(/<ThreadNavSheet[\s\S]*?visible=\{threadNavOpen\}/);
    expect(src).toMatch(/onClose=\{\(\) => setThreadNavOpen\(false\)\}/);
  });

  it("offers the entry point in the issue header", () => {
    const src = code(ISSUE_SCREEN);
    expect(src).toMatch(/onPress=\{\(\) => setThreadNavOpen\(true\)\}/);
    expect(src).toContain('t("threadNav.open")');
  });

  it("turns a picked thread into a fresh jump, nonce included", () => {
    const src = code(ISSUE_SCREEN);
    // Without a nonce, picking the same thread twice is an identical prop
    // change and React never re-runs the scroll effect.
    expect(src).toMatch(
      /setJumpTarget\(\{\s*id: threadId,\s*nonce: String\(Date\.now\(\)\)/,
    );
  });

  it("forwards the jump target and nonce into the timeline", () => {
    const src = code(ISSUE_SCREEN);
    expect(src).toContain("jumpToThreadId={jumpTarget?.id}");
    expect(src).toContain("jumpNonce={jumpTarget?.nonce}");
  });

  it("feeds the sheet the live timeline entries", () => {
    const src = code(ISSUE_SCREEN);
    expect(src).toMatch(/<ThreadNavSheet[\s\S]*?entries=\{timeline\.data\}/);
  });

  it("consumes the jump in the timeline with an index scroll, not MVCP", () => {
    const src = code(TIMELINE);
    expect(src).toMatch(/jumpToThreadId/);
    expect(src).toMatch(/scrollToIndex\(/);
    // The deep-link path lands at the bottom of the document; using it here
    // would drop the reader at the newest comment instead of the picked thread.
    expect(src).toMatch(/jumpNonce/);
    expect(src).toMatch(/lastJumpRef/);
  });

  it("has the sheet render search, the filter chips and the day groups", () => {
    const src = code(SHEET);
    // The three things that make a long thread list navigable rather than a
    // second scroll surface — web's panel has all three.
    expect(src).toMatch(/threadNav\.searchPlaceholder/);
    expect(src).toContain("FILTERS");
    expect(src).toContain("groupPreparedThreads");
    expect(src).toMatch(
      /buildThreadNavThreads[\s\S]*?prepareThreads[\s\S]*?filterThreads/,
    );
  });
});
