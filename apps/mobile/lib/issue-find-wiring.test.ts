/**
 * Wiring guard: the issue detail page must actually reach in-page find, and
 * find must actually reach the timeline's scroll/highlight channel.
 *
 * The ratchet is on the *call sites*, not on the helper's existence. This
 * project learned that the expensive way: an iteration shipped a correct pinyin
 * predicate that stayed green for a whole release because nothing asserted any
 * picker was wired to something that could feed it (see the note in
 * `thread-nav-wiring.test.ts`). A correct `lib/issue-find.ts` with no consumer
 * is a released feature that does not exist.
 *
 * So this file asserts the chain end to end:
 *
 *   1. the header offers an entry point, and it does not displace the thread
 *      navigator's button (the two surfaces are complements — the navigator
 *      searches a root comment's preview, find searches every full body);
 *   2. the screen owns the open/query/active-match state and renders the bar
 *      only while open;
 *   3. the search runs over the FULL timeline the screen already reads, through
 *      the pure helpers — not over a preview string;
 *   4. an active match becomes a *fresh* jump (id + nonce), so stepping onto
 *      the same comment twice re-fires the scroll instead of short-circuiting;
 *   5. the scroll is driven by user navigation, not by the match set changing
 *      (an incoming WS comment must not yank the view);
 *   6. `TimelineList` consumes the target, and resolves it through REPLIES as
 *      well as top-level rows — a hit inside a reply is the case this whole
 *      feature exists for, and replies are not rows in the mobile flat list;
 *   7. both nonce guards exist, so the scroll effect can re-fire.
 *
 * Removing any single link turns this red.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");
const ISSUE_SCREEN = "app/(app)/[workspace]/issue/[id].tsx";
const TIMELINE = "components/issue/timeline-list.tsx";
const BAR = "components/issue/find-bar.tsx";

function code(rel: string): string {
  // Comments describe the design and would let this pass on prose alone.
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("in-page find wiring", () => {
  it("offers the entry point in the issue header", () => {
    const src = code(ISSUE_SCREEN);
    expect(src).toMatch(/onPress=\{\(\) => setFindOpen\(true\)\}/);
    // The a11y label is the same string web uses as the input placeholder.
    expect(src).toContain('t("detail.find.placeholder")');
  });

  it("keeps the thread navigator's own entry point", () => {
    // Find and the navigator answer different questions (full-body text vs
    // root-comment preview). Displacing the navigator's button would trade one
    // zero-valued surface for another instead of closing the gap.
    const src = code(ISSUE_SCREEN);
    expect(src).toMatch(/onPress=\{\(\) => setThreadNavOpen\(true\)\}/);
    expect(src).toContain("ThreadNavSheet");
  });

  it("renders the bar only while find is open", () => {
    const src = code(ISSUE_SCREEN);
    expect(src).toMatch(/findOpen \?\s*\(\s*<FindBar/);
  });

  it("searches the full timeline through the pure helpers", () => {
    const src = code(ISSUE_SCREEN);
    // The haystack comes from the timeline the screen already reads — no new
    // request, and nothing preview-shaped.
    expect(src).toMatch(/collectSearchables\(\s*timeline\.data\s*\)/);
    expect(src).toMatch(/findInTimeline\(searchables, findQuery\)/);
    expect(src).toContain("findCounter(");
    expect(src).not.toMatch(/commentPreview|PREVIEW_BODY_MAX|PREVIEW_TITLE_MAX/);
  });

  it("turns an active match into a fresh jump, nonce included", () => {
    const src = code(ISSUE_SCREEN);
    expect(src).toContain("matchTarget(");
    // Without a fresh nonce, stepping onto the same comment twice is an
    // identical prop change and React never re-runs the scroll effect. A
    // CONSTANT nonce is just as dead — it has to advance per step — so this
    // pins the advancing counter, not merely the presence of a `nonce` key.
    expect(src).toMatch(/stepNonceRef\.current \+= 1/);
    expect(src).toMatch(
      /setFindStep\(\{\s*id: target,\s*nonce: String\(stepNonceRef\.current\)\s*\}\)/,
    );
  });

  it("drives the scroll from user navigation, not from the match set", () => {
    const src = code(ISSUE_SCREEN);
    // Both navigation paths call through the one applier...
    expect(src).toMatch(/applyFindTarget\(matches, next\)/);
    expect(src).toMatch(/applyFindTarget\(next, 0\)/);
    // ...and there is no effect that re-applies a target when the match set or
    // the active index changes on its own. Such an effect would scroll the
    // reader away whenever a websocket comment landed mid-find.
    expect(src).not.toMatch(/useEffect\([^)]*\[[^\]]*activeMatch[^\]]*\]/);
  });

  it("forwards the find target and nonce into the timeline", () => {
    const src = code(ISSUE_SCREEN);
    expect(src).toContain("findTargetId={findStep?.id}");
    expect(src).toContain("findNonce={findStep?.nonce}");
  });

  it("resolves the target through replies, not just top-level rows", () => {
    const src = code(TIMELINE);
    expect(src).toMatch(/findTargetId/);
    // Replies live inside their parent's card, so matching only the row's own
    // entry id would find nothing for a hit inside a reply.
    expect(src).toMatch(/row\.replies\.some\(\(reply\) => reply\.id === findTargetId\)/);
    expect(src).toMatch(/scrollToIndex\(/);
    expect(src).toMatch(/lastFindRef/);
  });

  it("flashes the target through the existing highlight channel", () => {
    const src = code(TIMELINE);
    // One "this is the row you asked for" affordance, not a second mechanism.
    expect(src).toMatch(/setHighlightedId\(findTargetId\)/);
  });

  it("has the bar render every control and the counter", () => {
    const src = code(BAR);
    for (const key of [
      "detail.find.placeholder",
      "detail.find.count",
      "detail.find.no_matches",
      "detail.find.previous",
      "detail.find.next",
      "detail.find.close",
    ]) {
      expect(src).toContain(key);
    }
    // The counter is never printed as `0/0`: it comes from `findCounter`, which
    // reports a kind rather than a raw pair.
    expect(src).toContain("counter.kind");
  });
});
