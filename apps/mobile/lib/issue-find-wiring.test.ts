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
 *   7. a hit in the header lands on the header (an offset scroll, its own
 *      flash), not on row 0 through `scrollToIndex`;
 *   8. both nonce guards exist, so the scroll effect can re-fire.
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

  it("searches the full page: title + description + timeline", () => {
    const src = code(ISSUE_SCREEN);
    // The haystack comes from the issue and the timeline the screen already
    // reads — no new request, and nothing preview-shaped.
    expect(src).toMatch(/collectSearchables\(\s*timeline\.data,\s*\{/);
    expect(src).toMatch(/title: headerTitle/);
    expect(src).toMatch(/description: headerDescription/);
    expect(src).toMatch(/findInTimeline\(searchables, findQuery\)/);
    expect(src).toContain("findCounter(");
    expect(src).not.toMatch(/commentPreview|PREVIEW_BODY_MAX|PREVIEW_TITLE_MAX/);
  });

  it("reads the header off the issue object, without a second request", () => {
    const src = code(ISSUE_SCREEN);
    // Title and description already ride on `issueDetailOptions`' result, so
    // indexing them must not introduce another query.
    expect(src).toMatch(/detail\.data\?\.title/);
    expect(src).toMatch(/detail\.data\?\.description/);
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

  it("counts every match the reader can step to, header hits included", () => {
    const src = code(ISSUE_SCREEN);
    // The counter and the stepper must read the SAME list. Filtering the
    // header's hits out of the total (or out of the array the stepper walks)
    // would print `n/m` that disagrees with how many steps it takes to reach
    // the last match — the reader steps past `m` and the bar still says `m`.
    // Pinned at the call site, not just in the pure helper: the helper is
    // correct for whatever count it is handed.
    expect(src).toMatch(/findCounter\(findQuery, matches\.length, activeMatch\)/);
    // One array feeds both `stepFind` and `applyFindTarget`, and it is the
    // unfiltered match set.
    expect(src).toMatch(/const matches = useMemo\(\s*\(\) => findInTimeline\(searchables, findQuery\)/);
    expect(src).toMatch(/stepMatch\(activeMatch, matches\.length, direction\)/);
    expect(src).toMatch(/applyFindTarget\(matches, next\)/);
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

  it("lands a header hit on the header, not on row 0", () => {
    const src = code(TIMELINE);
    // A hit in the description is above index 0 (the header is
    // `ListHeaderComponent`), so resolving it through `scrollToIndex` would
    // push the matched block off the top of the screen.
    expect(src).toMatch(/isHeaderFindTarget/);
    expect(src).toMatch(/scrollToOffset\(\{\s*offset,\s*animated:\s*true\s*\}\)/);
    // The description's offset is measured, not assumed: the header card above
    // it grows and shrinks with its chips.
    expect(src).toMatch(/measuredHeaderTopsRef\.current\.description/);
    expect(src).toMatch(/onLayout=/);
  });

  it("has its own flash for the header, which is not a comment id channel", () => {
    const src = code(TIMELINE);
    // `highlightedId` is consumed as a comment id by every `CommentCard`, so a
    // sentinel pushed through it would reach each card as a target matching
    // nothing.
    expect(src).toMatch(/findHeaderFlash/);
    // Compared against the SENTINELS, not a local `"title"` / `"description"`
    // string: the state holds `findTargetId`, and a mismatched literal would
    // leave the flash permanently dark while every other assertion still
    // passed.
    expect(src).toMatch(/titleHighlighted=\{findHeaderFlash === FIND_TARGET_TITLE\}/);
    expect(src).toMatch(/findHeaderFlash === FIND_TARGET_DESCRIPTION/);
    // The comment path is unchanged.
    expect(src).toMatch(/setHighlightedId\(findTargetId\)/);
  });

  it("flashes the header blocks through the one shared overlay", () => {
    // Three surfaces flash (root comment, reply, header block). One
    // implementation, so their timing cannot drift apart.
    const overlay = code("components/issue/highlight-overlay.tsx");
    expect(overlay).toContain("withSequence");
    expect(overlay).toMatch(/withTiming\(1, \{ duration: 700 \}\)/);
    expect(overlay).toMatch(/withDelay\(1800/);
    for (const rel of [TIMELINE, "components/issue/comment-card.tsx"]) {
      expect(code(rel)).toContain("HighlightOverlay");
    }
    // The header card owns the title's flash surface.
    expect(code("components/issue/issue-header-card.tsx")).toMatch(
      /titleHighlighted/,
    );
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

  // ── Activity rows (MYS-2109) ────────────────────────────────────────────
  // The ratchet matters most here. `lib/activity-search.ts` can be perfect and
  // its tests all green while an activity row stays unfindable, because the
  // feature only exists once FOUR links are in place: the screen builds the
  // index, the index reaches `collectSearchables`, the row renders from the same
  // helper, and the row accepts the highlight. Each is asserted below, so
  // deleting any one turns this red.

  it("builds the activity index from the timeline the screen already reads", () => {
    const src = code(ISSUE_SCREEN);
    // No new request: the timeline query is the only input.
    expect(src).toMatch(/activityBlockIndex\(timeline\.data,/);
    expect(src).toContain("activityBlockIndex");
  });

  it("feeds the activity index into the find haystack", () => {
    const src = code(ISSUE_SCREEN);
    // The index must reach `collectSearchables` as its third argument. A helper
    // that exists but is never handed over is a released feature that does not
    // exist — the exact failure this file was written for.
    expect(src).toMatch(
      /collectSearchables\(\s*timeline\.data,\s*\{[^}]*\},\s*activityBlocks,?\s*\)/,
    );
    // And the memo must depend on it, or a late-arriving actor/status list would
    // leave the haystack holding the pre-load "Unknown" fallbacks.
    expect(src).toMatch(/\[timeline\.data, headerTitle, headerDescription, activityBlocks\]/);
  });

  it("resolves activity text through memoised actor and status lookups", () => {
    const src = code(ISSUE_SCREEN);
    // Unstable resolvers would rebuild the haystack — and re-run the markdown
    // walk — on every keystroke, which is precisely what the searchables memo
    // exists to avoid.
    expect(src).toContain("useActorLookup()");
    expect(src).toContain("useStatusLabel(wsId)");
  });

  it("renders activity rows from the same helper find indexes", () => {
    // The one-implementation rule. If the row assembled its own sentence, find
    // could report words that are not on screen (or miss ones that are) — the
    // bug class this whole round is inside of.
    //
    // Asserted as the CALL, not as the identifier: an `import { activityRowText }`
    // that nothing invokes still satisfies a bare `toContain`, and this project
    // has already shipped a correct helper with no consumer once. Mutation
    // testing caught exactly that hole in an earlier draft of this test.
    const row = code("components/issue/activity-row.tsx");
    expect(row).toMatch(/activityRowText\(entry,\s*\{/);
    // The row must read BOTH runs off it, or it is not drawing what find indexes.
    expect(row).toMatch(/const \{ actor: actorName, verb \} = activityRowText\(/);
    // …and must NOT reach for the formatter directly, which is how a second
    // producer would reappear.
    expect(row).not.toContain("formatActivity");
  });

  it("lets an activity row carry the find highlight", () => {
    const timeline = code(TIMELINE);
    // An activity is a find target now, so it needs the same landing affordance
    // a comment row has. Without the prop the jump would scroll correctly and
    // then mark nothing, leaving the reader to guess which row they landed on.
    expect(timeline).toMatch(
      /<ActivityRow entry=\{item\.entry\} highlighted=\{highlightedId === item\.entry\.id\}/,
    );
    const row = code("components/issue/activity-row.tsx");
    expect(row).toContain("HighlightOverlay");
    // One shared overlay implementation across all the flashing surfaces, so
    // their timing cannot drift apart.
    expect(row).toMatch(/highlighted\?: boolean/);
  });

  it("keeps activities out of the header's flash channel", () => {
    // An activity id is a real uuid and travels `highlightedId`; only the title
    // and description are sentinels. A regression that routed an activity
    // through `findHeaderFlash` would make the header flash for a row hit.
    const timeline = code(TIMELINE);
    expect(timeline).toMatch(/isHeaderFindTarget\(findTargetId\)/);
    // The row lookup still resolves the target against `row.entry.id`, which is
    // what makes an activity id work with no special case.
    expect(timeline).toMatch(/row\.entry\.id === findTargetId/);
  });
});
