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
      /setFindStep\(\{\s*id: target,\s*nonce: String\(stepNonceRef\.current\),/,
    );
    // The landing fraction must travel WITH the step (MYS-2112). Reading it
    // from the live `matches` array at scroll time instead would let a step
    // land using a DIFFERENT hit's fraction the moment the match set changed
    // underneath — a websocket comment is enough to renumber it.
    expect(src).toMatch(/fraction: match\?\.fraction/);
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
    // The description's flash is tested through `isDescriptionFindTarget`, not
    // an equality against the bare sentinel: since MYS-2112 a description
    // target names a SEGMENT, so an equality check would leave every hit past
    // the description's first segment flashing nothing at all.
    expect(src).toMatch(/isDescriptionFindTarget\(findHeaderFlash\)/);
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

  // ── Landing inside a long description (MYS-2112) ────────────────────────
  // Measured on this deployment: 28% of descriptions contain a table, tables are
  // 8.32% of all description text, and the distance from a description's start
  // to its last table row has a median of 1,939 characters — more than a screen.
  // The fixture (MYS-2077) puts the matched row 1,987dp below the description
  // top against a ~700dp viewport, so landing on the description's top reported
  // `1/1` and showed the reader the wrong part of the page.
  //
  // The landing is only real once FOUR links exist, and each is asserted — the
  // same reason the activity-row block above exists: a correct
  // `descriptionFindOffset` that nothing calls is a released feature that does
  // not exist.
  //
  //   1. `Markdown` measures each rendered segment;
  //   2. `IssueDescription` forwards those measurements;
  //   3. `TimelineList` stores them and feeds them to the offset;
  //   4. the screen carries the match's fraction alongside its target.

  it("measures each rendered segment and reports it", () => {
    const md = code("lib/markdown/markdown.tsx");
    // The measurement is on a wrapper the component owns. Asserted as the
    // onLayout WIRING, not as the identifier: an `onSegmentLayout` prop that is
    // declared but never called from a layout pass measures nothing.
    expect(md).toMatch(/onLayout=\{measure\(index\)\}/);
    expect(md).toMatch(/nativeEvent\.layout\.y/);
    expect(md).toMatch(/nativeEvent\.layout\.height/);
    // A segment's rectangle is reported per segment, so the index has to travel
    // with it — a bare `{top,height}` could not say WHICH segment it describes.
    expect(md).toMatch(/index,/);
  });

  it("does not wrap segments for callers that asked for no measurement", () => {
    // Every other <Markdown> surface (comment bodies, chat bubbles, run logs)
    // must keep exactly the tree it had. A wrapper rendered unconditionally
    // would add a Yoga node — and a `gap-3` spacing participant — everywhere.
    const md = code("lib/markdown/markdown.tsx");
    expect(md).toMatch(/onSegmentLayout \? \(/);
  });

  it("forwards segment geometry from the description block", () => {
    const desc = code("components/issue/issue-description.tsx");
    expect(desc).toMatch(/onSegmentLayout/);
    // The callback must reach `Markdown` through the prop, not be computed and
    // dropped.
    expect(desc).toMatch(/onSegmentLayout=\{onSegmentLayout\}/);
  });

  it("stores the measured rectangles and lands the jump on the segment", () => {
    const timeline = code(TIMELINE);
    // The ref exists and is written from the callback, storing the rect AS
    // REPORTED — wrapper-relative. The read side adds the description's offset;
    // adding it here as well double-counts it, which is a bug this round
    // shipped and the device caught (a 213dp overshoot, exactly
    // `measuredHeaderTopsRef.current.description`, which pushed the matched row
    // just past the viewport's bottom edge). Pinned as the ABSENCE of that sum
    // on the write side, because a diff between "stores + adds" and "stores" is
    // one token wide and reads as equivalent.
    expect(timeline).toMatch(/measuredSegmentRectsRef/);
    expect(timeline).toMatch(
      /measuredSegmentRectsRef\.current\.set\(report\.index, \{\s*top: report\.top,/,
    );
    expect(timeline).not.toMatch(
      /current\.set\(report\.index, \{\s*top:\s*measuredHeaderTopsRef/,
    );
    // And it is READ by the landing — a measurement that only accumulates is
    // the dead-helper failure this file exists to catch.
    expect(timeline).toMatch(/measuredSegmentRectsRef\.current\.get\(/);
    // The landing goes through the tested pure helper rather than re-deriving
    // the arithmetic inline, where it would escape the clamp tests.
    expect(timeline).toMatch(/descriptionFindOffset\(\{/);
    // Which segment to look up comes from the target, through the helper that
    // owns that parsing.
    expect(timeline).toMatch(/descriptionTargetIndex\(findTargetId\)/);
    // The block's own offset is ADDED at read time — exactly once, on this side.
    expect(timeline).toMatch(
      /measuredHeaderTopsRef\.current\.description \+ segmentTop\.top/,
    );
    // Centring is fed the container's measured height, not a constant pad: the
    // top-pad variant is what the device rejected.
    expect(timeline).toMatch(/viewportHeight: viewportHeightRef\.current/);
    expect(timeline).toMatch(/viewportHeightRef\.current =/);
  });

  it("carries the match's fraction from the screen into the timeline", () => {
    const screen = code(ISSUE_SCREEN);
    const timeline = code(TIMELINE);
    expect(screen).toMatch(/findFraction=\{findStep\?\.fraction\}/);
    expect(timeline).toMatch(/findFraction/);
    // The prop must reach the offset computation, not merely be declared.
    expect(timeline).toMatch(/fraction: findFraction/);
  });

  it("flashes the segment rather than the whole description", () => {
    const timeline = code(TIMELINE);
    // The overlay's rectangle is computed from the measured segment, so the
    // wash marks the block the match is in.
    expect(timeline).toMatch(/descriptionFlashRect/);
    expect(timeline).toMatch(/style=\{descriptionFlashRect\}/);
    // `inset-0` (the whole-block wash) must be GONE: with a segment rectangle
    // driving the position, an `inset-0` class would fight it and win.
    expect(timeline).not.toMatch(/absolute inset-0 rounded-lg border-2 border-brand/);
  });

  it("degrades to the previous behaviour when geometry is missing", () => {
    const timeline = code(TIMELINE);
    // A segment that has not laid out falls back to the description's own
    // measured top, which is what shipped before this round — so a slow first
    // layout can never land the reader somewhere worse than v0.6.67 did.
    //
    // Asserted as the FALLBACK EXPRESSION, not as the two halves separately:
    // both the segment lookup and the description top are present in the file
    // for other reasons (the flash rectangle reads the lookup; the fallback
    // reads the description top), so asserting them independently let a version
    // that always used the description top still pass. Pinning `?.top ??` is
    // what makes the measured segment the primary source and the description
    // top the fallback, rather than the other way round.
    expect(timeline).toMatch(
      /segmentTop:\s*segmentTop === undefined\s*\?\s*Math\.max\(0, measuredHeaderTopsRef\.current\.description\)/,
    );
    expect(timeline).toMatch(/segmentHeight:\s*segmentTop\?\.height \?\? 0/);
  });

  it("routes a per-segment description target to the header path", () => {
    // The routing predicate has to recognise a SEGMENTED description target,
    // not just the bare sentinel. With an equality check against
    // `FIND_TARGET_DESCRIPTION`, every hit past the description's first segment
    // would fall through to the comment lookup, find no row, and never scroll —
    // the exact class of silent dead-end this round exists to remove.
    const timeline = code(TIMELINE);
    expect(timeline).toMatch(
      /isHeaderFindTarget[\s\S]{0,120}?isDescriptionFindTarget\(id\)/,
    );
  });
});
