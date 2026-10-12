/**
 * In-page find over the issue timeline — the mobile port of web's
 * `packages/views/issues/hooks/use-in-page-find.ts`.
 *
 * Why this exists: web gives the issue detail page a real find-in-page bar
 * (`Cmd/Ctrl+F` → `packages/views/issues/components/find-bar.tsx`). Its own
 * docblock gives the reason it cannot simply defer to the browser:
 *
 *   > The comment timeline is virtualized, so native browser find only sees
 *   > the handful of comments mounted in the viewport. This hook powers a real
 *   > find-in-page bar: the host force-renders the timeline flat while find is
 *   > open (so every comment is in the DOM).
 *
 * Mobile had no equivalent. Its only "find something in this issue" surface is
 * the thread navigator (`lib/thread-nav.ts`), which searches **root comments
 * only** and only against their **preview string** — `PREVIEW_TITLE_MAX = 80`
 * plus `PREVIEW_BODY_MAX = 160`, i.e. the first 240 characters of each root.
 * Measured against this deployment's own long issues that reaches 10.6% and
 * 3.8% of the timeline's text, and **not one character of a reply**:
 *
 *   | issue    | comments | all text | reachable by the navigator |
 *   |----------|----------|----------|----------------------------|
 *   | MYS-1893 |       49 |  84,743  |  8,995  (10.6%)            |
 *   | MYS-2016 |       23 |  72,905  |  2,799  ( 3.8%)            |
 *
 * So the two clients answered different questions about the same issue. This
 * module closes that: the searchable container is the issue's **title, its
 * description, every comment body (replies included) and every activity row**.
 *
 * ## The searchable container
 *
 * Web's container is the issue page's whole scroll root — title, description,
 * every comment and every activity (`issue-detail.tsx:2623`). Mobile's is the
 * four parts of that root which carry text the reader can see, in the reader's
 * top-to-bottom order:
 *
 *   1. the **title** — one block, read as the literal string the header draws;
 *   2. the **description** — through the SAME `extractSearchBlocks` the
 *      comments use: one markdown dialect, one block rule;
 *   3. the **timeline** — every comment body, replies included;
 *   4. the **activity rows** on that timeline — their drawn text, supplied by
 *      `lib/activity-search.ts` (see "Activity rows" below).
 *
 * The title is deliberately NOT run through the lexer. The header renders it
 * as plain text (`issue-header-card.tsx` → `<Text>{issue.title}</Text>`), so a
 * title carrying `**` or `_` shows those characters; lexing would delete them
 * and leave the haystack disagreeing with the screen.
 *
 * The container grew twice, and both gaps were measured on this deployment
 * rather than argued. First the description:
 *
 *   | issue    | description | timeline | description's share |
 *   |----------|-------------|----------|---------------------|
 *   | MYS-1893 |       5,510 |   72,421 |  7.1%               |
 *   | MYS-2007 |       1,322 |       30 | 97.8%               |
 *
 * MYS-2007 is the shape that matters: an issue whose prose is almost entirely
 * in its description and whose single comment is a stub. Its description holds
 * `preview26` and `Explorer`; MYS-1893's holds `qemu_arm64_linux_min` and
 * `window_scene_board`, and neither appears in any of its 49 comments. Those
 * are words the reader can see on the phone that find reported as "no
 * matches". Then the activity rows, measured across 40 issues of this
 * deployment:
 *
 *   | measure                                  | value            |
 *   |------------------------------------------|------------------|
 *   | activity rows on those issues            | 215              |
 *   | rows rendering non-empty text            | 215 (100%)       |
 *   | characters those rows draw               | 15,028           |
 *   | title + description + comment characters | 328,898          |
 *   | activity rows' share of the page's text  | **4.4%**         |
 *   | activity rows : comment rows             | **2.65 : 1**     |
 *   | (status word, issue) pairs found ONLY in  | **97 across 39** |
 *   | an activity row, i.e. 0 hits today       | of 40 issues     |
 *
 * That last row is the whole point. A status name like `in_progress` appears on
 * a typical issue **only** inside `changed status: todo → in_progress`, which
 * the row draws and the reader can read — while find answered "no matches" for
 * a word plainly on screen.
 *
 * ## Activity rows
 *
 * Indexed from their **drawn** text, produced by `lib/activity-search.ts` — the
 * same function `ActivityRow` renders from, so "searched text == drawn text" is
 * structural rather than a rule to remember. Two properties of that source are
 * load-bearing and are documented there: the text is two runs (the actor name
 * and the verb), matching web's two sibling `<span>`s; and it comes from the
 * **coalesced** rows, because a merged activity renders no row of its own and
 * its sentence can differ (`completed 3 tasks`).
 *
 * A block's target is the row's **own `entry.id`** — no new channel and no
 * sentinel. It is already the list's `keyExtractor`, and `TimelineList`'s find
 * effect already resolves a target against `row.entry.id`, so an activity lands
 * through exactly the path a comment does (scroll to the row, flash it). The
 * two header sentinels remain the only non-id targets.
 *
 * The rows' `×N` coalesce chip and relative timestamp stay out of the haystack:
 * they are chrome derived from the viewing moment, and "2 days ago" drifting to
 * "3 days ago" under a stable query is not text find can honestly navigate.
 * Web reaches both only by walking raw DOM nodes — a one-directional divergence
 * in mobile's favour, listed under "What is deliberately NOT searchable" below.
 *
 * ## Two kinds of jump target
 *
 * A match lands either in a comment, in an activity row, or in the header, and
 * the first two navigate identically (both are rows of the list) while the
 * header does not: it is `ListHeaderComponent`, above index 0. So a match
 * carries a `targetId` that is either a real entry id or one of the header
 * sentinels (`FIND_TARGET_TITLE` / `findDescriptionTarget(i)`). `TimelineList`
 * resolves a sentinel to a scroll to the header offset plus a flash on that
 * header block; an entry id keeps the existing row lookup, which already
 * reaches inside replies.
 *
 * The sentinels are string constants rather than a second channel because the
 * existing one is a single `string | undefined` prop with a nonce, and a hit in
 * the description has to travel the same path a hit in a comment does —
 * including the nonce that makes stepping onto the same target twice re-fire
 * the scroll. `highlightCommentId` / `highlightNonce` (inbox deep links) are
 * untouched, and a sentinel cannot collide with the entry ids that channel
 * carries: those are uuids.
 *
 * ## Landing inside a long description (MYS-2112)
 *
 * Naming the description as ONE target was never enough to land a hit in it,
 * and on this deployment that is the common case rather than an edge: measured
 * over 100 live descriptions, **28% contain a markdown table**, tables are
 * **8.3% of all description text**, and the offset from a description's start to
 * its last table row has a **median of 1,939 characters** — more than one
 * screen. So the landing target is the description's *rendered segment*, not the
 * description: each block is tagged with the segment index it came from, and
 * `TimelineList` scrolls using that segment's own measured rectangle.
 *
 * Measured on the fixture (MYS-2077, description 5,591 chars, its last table at
 * character 4,632, token `sophgo-SQM2270` occurring once): the matched row sits
 * **1,987dp** below the description top, while a viewport is ~700dp. That is the
 * bug — find reports `1/1` and the reader sees the description's first line.
 * The number comes from a scroll-chained device sweep whose every step was
 * accepted only when its measured delta was plausible (see the round's
 * `measure-true.py`); a `contentY = 2862 + 1.138 × charOffset` fit over 13
 * located blocks has R² 0.958, and the token's own position is confirmed by the
 * two measured blocks bracketing it.
 *
 * The two aligned facts that make the segment tag sound, each measured over the
 * same 100 descriptions: splitting the description and lexing each segment
 * yields the **identical** block list as lexing it whole (**100/100**), so no
 * count, hit or step changes; and `splitMarkdown`'s type sequence is identical
 * for the raw description and the preprocessed one the renderer actually splits
 * (**100/100**), so the index is the one the renderer measures geometry for.
 *
 * | what was measured (100 live descriptions)  | value        |
 * |--------------------------------------------|--------------|
 * | descriptions containing a table            | **28 / 100** |
 * | table rows / characters                    | 447 / 26,232 |
 * | tables as a share of description text      | **8.32%**    |
 * | offset to last table row: median / p90     | 1,939 / 3,363 chars |
 * | descriptions rendering as ONE segment      | 87 / 100     |
 * | tables living in segment 0                 | 57 / 69      |
 *
 * The last two rows are why the landing is segment-anchored rather than
 * per-block: the renderer draws a whole prose island as ONE native text view
 * (md4c → `StaticLayout`) and exposes no per-block geometry to JS, so a segment
 * rectangle is the finest geometry that is MEASURED rather than guessed. Inside
 * a segment the landing falls back to the block's character share and CENTRES
 * the result, which is what makes that share's error survivable — measured on
 * the fixture at 12 points of a segment (~240dp), far beyond what a few pixels
 * of top padding could absorb. See `descriptionFindOffset` for the numbers.
 *
 * ## Matching semantics, ported from web
 *
 * - **Case-insensitive**, via `toLowerCase()` on both sides — web
 *   `collectTextMatches` (`use-in-page-find.ts:56-63`). Deliberately not
 *   locale-aware `toLocaleLowerCase`: web's behaviour is the contract, and a
 *   locale-aware fold would make the same query match a different set on a
 *   Turkish device.
 * - **A match never straddles a block boundary.** A *block* — a paragraph, a
 *   heading, a list item, a table cell — is mobile's unit of confinement, and
 *   this is a deliberate, sanctioned divergence from web in one direction.
 *   Web confines every match to a single DOM text node and says so explicitly
 *   ("a query straddling an element boundary (e.g. across a bold run) is not
 *   found, which is the standard trade-off for lightweight find"). On web that
 *   makes `**this**` a boundary, because a bold run is its own text node;
 *   React Native has no per-inline-element text nodes to address, and the
 *   reader perceives one continuous run of text, so a query spanning a bold
 *   run matches here where web would miss it. Block granularity is the
 *   coarsest unit that still keeps every reported match landable: each one
 *   belongs to exactly one target (a comment, an activity row, or the header),
 *   which is what the jump needs.
 *   Mobile is therefore strictly *more* permissive inside a block and
 *   identical across blocks — never less able to find something.
 * - **Empty / whitespace-only query matches nothing.** Web returns early on
 *   `!needle` and again on `query.trim().length === 0` in `recompute`.
 *
 * ## What is deliberately NOT searchable
 *
 * - **A code fence.** A fenced block is program text, not prose. Mirrors web's
 *   `SKIP_TAGS` (`SCRIPT` / `STYLE` / `NOSCRIPT`) — content present in the
 *   document that find should not walk. `thread-nav.ts` makes the same call
 *   for its preview (`` ```…``` `` collapses to nothing, "they carry no
 *   scannable text").
 * - **A deleted comment.** A tombstone renders no body and, for a reply, no row
 *   at all (`lib/comment-deletion.ts` → `comment-card.tsx`). A match there
 *   would point at something the reader cannot see.
 * - **An image's alt text.** The renderer does not draw it as text, so a match
 *   there would be unfindable on screen.
 * - **The `×N` chip and the relative timestamp on an activity row.** The row
 *   draws both, and web's scroll-root walk reaches both. Mobile does not index
 *   them because they are derived from *when the reader is looking* rather than
 *   from the entry: "2 days ago" becomes "3 days ago" with no write, so a query
 *   that matched yesterday's rendering would miss today's. Everything else on
 *   an activity row **is** indexed (see "Activity rows" above) — a deliberate,
 *   one-directional divergence: mobile may find less here, never something that
 *   is not on screen.
 * - **The custom-property / metadata / sub-issue / PR rows in the header.**
 *   They render text the reader can see, and web's scroll-root walk reaches
 *   them. Mobile does not index them: each is a separate query the screen may
 *   not have loaded, and a hit inside a loading section would be counted and
 *   then be unlandable. The title and description are the two header blocks
 *   that are already on the `Issue` object, which is why they are the two this
 *   module's header half covers.
 *
 * ### Two claims this section used to make, and why they are gone (MYS-2109)
 *
 * Activities were excluded here for two stated reasons, and **neither held**:
 *
 *   1. *"An activity carries no body (`TimelineEntry.content` is a comment
 *      field)"* → the conclusion drawn from it, "so it renders no text", does
 *      not follow. `formatActivity` (`lib/format-activity.ts`) is the row's
 *      text, and it needs no `content`. Measured on this deployment: **215 of
 *      215 activity rows render non-empty text** — not one is blank.
 *   2. *"hits that have no text and no jump target"* → activity entries carry
 *      their own `id` (a uuid), and an activity row is a FlashList row like any
 *      other, so such a hit has exactly the jump target a comment hit has.
 *      Nothing had to be invented: the target is `entry.id`.
 *
 * The counter-inflation worry the old text raised was real, but its cause was
 * narrower than "activities have no text": it is that an index over the **raw**
 * timeline would count merged-away entries, which render no row. The rows come
 * from `lib/activity-search.ts`, which indexes the coalesced list, so
 * `matchCount` and the set of rows the reader can step through are the same set
 * by construction. The invariant itself is unchanged and still the rule: every
 * counted match must be one the reader can step to and see.
 *
 * PURE — no React, no i18n, no native imports. Runs in the Node vitest lane.
 */
import { marked } from "marked";
import type { TimelineEntry } from "@multica/core/types";
import { isDeletedComment } from "./comment-deletion";
import { stripHtml } from "./markdown/preprocess";
import { splitMarkdown } from "./markdown/split-markdown";

/**
 * Sentinels for the two header blocks, which have no comment id.
 *
 * A match inside the description or the title has to name *something* for the
 * scroll channel to carry, and `TimelineList` needs to tell those two apart: a
 * description hit scrolls to the description (not merely to offset 0, which on
 * a long issue can leave it below the fold if the header is taller than the
 * viewport), and both flash their own block rather than a comment card.
 *
 * Dunder-wrapped for the same reason `DIVIDER_ID` is: they cannot collide with
 * a comment id, which is a uuid. `FIND_TARGET_TITLE` exists even though a title
 * hit is always above a description hit, so the two stay distinguishable — the
 * flash has to land on the block the match is actually in.
 */
export const FIND_TARGET_TITLE = "__issue_title__";
export const FIND_TARGET_DESCRIPTION = "__issue_description__";

/**
 * The target of the description's `index`-th RENDERED segment.
 *
 * Segment 0 keeps the bare `FIND_TARGET_DESCRIPTION`, so every existing caller,
 * assertion and consumer of that constant keeps its exact meaning: "the first
 * block of the description". Later segments get a `:<index>` suffix.
 *
 * Why the description needs more than one target at all (MYS-2112): the
 * description is rendered as a LIST of segments (`splitMarkdown`), each its own
 * React child with its own measured geometry, and a hit in the 4th segment
 * cannot be landed by an offset computed against the description as a whole
 * (see `descriptionFindOffset`). Naming the segment is what lets the landing use
 * a MEASURED position instead of an extrapolation across blocks the match has
 * nothing to do with.
 *
 * The `:<index>` suffix is still a sentinel rather than a comment id — the
 * channel stays the one `string | undefined` prop it always was, and a uuid can
 * never look like this.
 */
export function findDescriptionTarget(index: number): string {
  return index === 0 ? FIND_TARGET_DESCRIPTION : `${FIND_TARGET_DESCRIPTION}:${index}`;
}

/** Whether `id` names the description at all (any segment). */
export function isDescriptionFindTarget(id: string): boolean {
  return id === FIND_TARGET_DESCRIPTION || id.startsWith(`${FIND_TARGET_DESCRIPTION}:`);
}

/**
 * The segment index a description target names, or 0 for the bare sentinel.
 *
 * Callers must gate on `isDescriptionFindTarget` first: this answers `0` for
 * anything that is not a description target, which is the useful default for
 * "the description as a whole" but indistinguishable from segment 0.
 */
export function descriptionTargetIndex(id: string): number {
  const suffix = id.slice(FIND_TARGET_DESCRIPTION.length);
  if (suffix === "") return 0;
  const parsed = Number.parseInt(suffix.slice(1), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** One occurrence of the query inside one searchable block's text. */
export interface FindMatch {
  /**
   * Where the jump/highlight should land: a real timeline entry id (a comment
   * — root **or** reply — or an activity row), or one of the header sentinels
   * above (`FIND_TARGET_TITLE` / `findDescriptionTarget(i)`).
   *
   * An activity row needs no special case anywhere downstream: it is a row of
   * the list, so its id travels the same `highlightedId` / `scrollToIndex`
   * path a comment id does.
   */
  targetId: string;
  /**
   * 0-based offset of the match within its own block's searchable text.
   * Offsets from different blocks are therefore not comparable; they are only
   * meaningful together with `targetId`.
   */
  start: number;
  /** Exclusive end offset, so `end - start === needle.length`. */
  end: number;
  /**
   * Where the match sits inside its TARGET's own span, as `0 ≤ fraction ≤ 1`.
   * Present only for a description-segment hit, which is the one target long
   * enough that landing at its top can leave the match off screen.
   *
   * A MODEL, not a measurement — see `descriptionFindOffset` for what it is
   * worth and why it is measured against the segment rather than assumed.
   * Absent for every other target, where the whole row IS the landing.
   */
  fraction?: number;
}

/** One block's flattened searchable text plus the target it belongs to. */
interface Searchable {
  targetId: string;
  text: string;
  /** Searchable-text length in the target's span that precedes this block.
   *  Only set for a description segment — see `fraction` on `FindMatch`. */
  fractionBase?: number;
  /** The target's total searchable-text length. Only set for a description
   *  segment. */
  fractionSpan?: number;
}

/**
 * The issue fields find indexes besides the timeline.
 *
 * A structural subset rather than `Issue`: this module stays free of the
 * `@multica/core` runtime and of every field it does not read, and a caller in
 * the Node test lane can pass a two-key literal.
 */
export interface FindHeader {
  title: string;
  description: string | null;
}

/**
 * HTML entities, decoded so the haystack holds the characters the reader sees.
 *
 * `marked.lexer` keeps source text verbatim, so `&amp;` stays five characters
 * in the token while the renderer (md4c / `NSAttributedString`) draws `&`.
 * Without this, searching for `&` — or for any word containing one — misses
 * text that is visibly on screen. Web needs no equivalent step: its walk reads
 * already-decoded DOM text nodes.
 *
 * `&nbsp;` decodes to the non-breaking space, not a plain one, because that is
 * what both renderers draw; a typed space therefore does not match it, exactly
 * as on web.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(
    /&(?:([a-zA-Z]+)|#(\d+)|#[xX]([0-9a-fA-F]+));/g,
    (whole, name?: string, dec?: string, hex?: string) => {
      if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
      const code = dec ? Number.parseInt(dec, 10) : Number.parseInt(hex!, 16);
      // A code point outside Unicode (or a lone surrogate) would make
      // `fromCodePoint` throw; leaving the source text is the safe fallback.
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
      return String.fromCodePoint(code);
    },
  );
}

/** A `<br>` is a visible break: the two sides are separate lines on screen,
 *  so they are separate match surfaces. */
const BR_TAG = /^<br\s*\/?>/i;

/** Walk state shared across one top-level block's inline tokens. */
interface InlineState {
  buf: string;
}

function flushBlock(blocks: string[], state: InlineState): void {
  if (state.buf.length > 0) blocks.push(state.buf);
  state.buf = "";
}

/**
 * Flatten inline tokens to the visible text they render, appending completed
 * blocks to `out`.
 *
 * Per token type:
 *   - `text` / `escape` / `codespan` are leaf text (the renderer draws inline
 *     code as text, so web matches it too).
 *   - Anything carrying sub-tokens — `paragraph`, `heading`, `strong`, `em`,
 *     `del`, and the `text` wrapper `marked` puts inside list items and table
 *     cells — is walked *through*, never read from. That container's own
 *     `.text` is the RAW markdown source, so reading it would seed the
 *     haystack with syntax the reader never sees.
 *   - `html` carries a raw tag with no visible text of its own — its inner
 *     text arrives as sibling text tokens. The one exception is `<br>`, which
 *     *is* a visible break and so ends the current block.
 *   - `link` keeps its label and drops its URL — the URL is not drawn, and
 *     `stripMarkdown` (`lib/strip-markdown.ts`) drops the same half for the
 *     same reason. An autolink (`<https://x.y>`) has its URL *as* its label,
 *     so it stays.
 *   - `image` contributes nothing (alt text is not rendered as text).
 *   - A nested `list` (an item holding a sub-list) ends the current block, then
 *     contributes each of its own items as its own block.
 */
function pushInline(
  tokens: readonly unknown[] | undefined,
  out: string[],
  state: InlineState,
): void {
  if (!tokens) return;
  for (const raw of tokens) {
    const token = raw as {
      type?: string;
      text?: string;
      tokens?: unknown[];
      items?: unknown[];
    };
    // `marked` wraps a list item's and a table cell's inline content in a
    // `text` token whose own `.text` is the RAW source (so a bold run in a
    // bullet arrives as `"item two with **bold**"`). Reading `.text` there
    // would put markdown syntax into the haystack — searchable words the
    // reader never sees, and a query for `**` that "matches" on screen
    // nowhere. Whenever a token carries sub-tokens, the sub-tokens are the
    // rendered text; only a token with none is a leaf.
    if (token.tokens && token.tokens.length > 0) {
      if (token.type === "list") {
        // A sub-list inside an item starts its own line.
        flushBlock(out, state);
        pushListItems(token.items, out, state);
        continue;
      }
      // `image` is the one wrapper whose children must NOT be walked: its
      // tokens are the alt text, which the renderer does not draw (`image`
      // also has no sub-tokens in practice, but the guard is explicit).
      if (token.type === "image") continue;
      pushInline(token.tokens, out, state);
      continue;
    }
    switch (token.type) {
      case "text":
      case "escape":
      case "codespan":
        state.buf += decodeEntities(token.text ?? "");
        break;
      case "br":
        flushBlock(out, state);
        break;
      case "html":
        if (BR_TAG.test(token.text ?? "")) flushBlock(out, state);
        break;
      case "image":
        break;
      case "list":
        flushBlock(out, state);
        pushListItems(token.items, out, state);
        break;
      case "link":
        // A link with no sub-tokens is an autolink: its URL *is* its label,
        // and the renderer draws it.
        state.buf += decodeEntities(token.text ?? "");
        break;
      default:
        if (typeof token.text === "string") state.buf += decodeEntities(token.text);
        break;
    }
  }
}

/** One block per list item — the reader sees one line per item. */
function pushListItems(
  items: readonly unknown[] | undefined,
  out: string[],
  state: InlineState,
): void {
  for (const raw of items ?? []) {
    const item = raw as { tokens?: unknown[] };
    pushInline(item.tokens, out, state);
    flushBlock(out, state);
  }
}

/**
 * Extract a comment body's searchable text as a list of **independent
 * blocks**.
 *
 * Block granularity is load-bearing, not cosmetic: each returned string is
 * matched on its own, so a query cannot straddle two of them — the same
 * confinement web gets from matching inside one text node. Joining the blocks
 * into one string would let a query span a paragraph break, producing a match
 * the reader could never see highlighted and that no "next" step could land on.
 *
 * Fenced code blocks are dropped entirely (see the module docblock).
 */
export function extractSearchBlocks(content: string | undefined): string[] {
  if (!content) return [];
  const blocks: string[] = [];
  // `marked.lexer` is already a dependency of the render pipeline
  // (`lib/markdown/split-markdown.ts`), so this adds no parser and no second
  // markdown dialect to keep in step with the renderer.
  for (const raw of marked.lexer(content)) {
    const token = raw as {
      type?: string;
      text?: string;
      tokens?: unknown[];
      items?: unknown[];
      header?: unknown;
      rows?: unknown;
    };
    switch (token.type) {
      case "code":
      case "math":
      case "space":
      case "hr":
        break;
      case "html":
        // A raw HTML block. The renderer routes it through `stripHtml`, so the
        // tags vanish and the inner text stays — search exactly that, splitting
        // where `stripHtml` left a line break.
        for (const part of stripHtml(token.text ?? "").split("\n")) {
          if (part.trim().length > 0) blocks.push(part);
        }
        break;
      case "list":
        pushListItems(token.items, blocks, { buf: "" });
        break;
      case "table":
        // One block per CELL: each cell is its own element on screen, so web
        // cannot match across two of them either. Each cell needs its own
        // flush — a shared buffer would join the row's cells into one string
        // and let a query span a cell boundary.
        for (const row of tableRows(token)) {
          for (const cell of row) {
            const cellState: InlineState = { buf: "" };
            pushInline(cell.tokens, blocks, cellState);
            flushBlock(blocks, cellState);
          }
        }
        break;
      default: {
        const state: InlineState = { buf: "" };
        // Same rule as `pushInline`: a token carrying sub-tokens is a
        // container, and its `.text` is raw source. Only a leaf's text is
        // rendered text.
        if (token.tokens && token.tokens.length > 0) {
          pushInline(token.tokens, blocks, state);
        } else if (typeof token.text === "string") {
          state.buf += decodeEntities(token.text);
        }
        flushBlock(blocks, state);
        break;
      }
    }
  }
  return blocks;
}

/** Table rows in render order: header first, then the body rows. */
function tableRows(token: {
  header?: unknown;
  rows?: unknown;
}): { tokens?: unknown[] }[][] {
  const rows: { tokens?: unknown[] }[][] = [];
  if (Array.isArray(token.header)) rows.push(token.header as { tokens?: unknown[] }[]);
  if (Array.isArray(token.rows)) {
    rows.push(...(token.rows as { tokens?: unknown[] }[][]));
  }
  return rows;
}

/**
 * Every searchable block on the issue page, in top-to-bottom reading order:
 * title → description → timeline (comments and activity rows interleaved).
 *
 * Kept separate from `findInTimeline` so a caller that recomputes on every
 * keystroke can build the haystack once per content change and re-run only the
 * (cheap) scan — the same split as web, whose host passes a `contentKey` and
 * whose hook re-walks the DOM only when it changes.
 *
 * `header` and `activityBlocks` are both optional so the timeline-only input
 * this module shipped with still works; a caller that omits them gets exactly
 * the previous behaviour for the parts it omits.
 *
 * `activityBlocks` is passed IN rather than computed here, and that is the one
 * structural decision worth explaining: producing an activity row's text needs
 * `formatActivity`, which resolves through the i18n dictionary. This module is
 * deliberately free of i18n and native imports so it runs in the plain-Node
 * vitest lane, and importing the formatter would drag `expo-secure-store` in
 * after it. The caller (`components/issue/timeline-list.tsx` via
 * `lib/activity-search.ts`) owns that side of the line; here the blocks are
 * just text.
 */
export function collectSearchables(
  entries: readonly TimelineEntry[] | undefined,
  header?: FindHeader | undefined,
  activityBlocks?: ReadonlyMap<string, readonly string[]> | undefined,
): Searchable[] {
  const out: Searchable[] = [];

  // The title is one block of plain text. NOT lexed: the header draws the raw
  // string (`issue-header-card.tsx`), so `**` in a title is four visible
  // characters, and running it through markdown would delete them and let a
  // query for `**` "match" text that is not on screen. A title is a single
  // line, so it cannot straddle a block boundary either way.
  const title = header?.title;
  if (title && title.trim().length > 0) {
    out.push({ targetId: FIND_TARGET_TITLE, text: title });
  }

  // The description is markdown and goes through the SAME extractor as a
  // comment — one dialect, one block rule. A second, simpler splitter for the
  // description is the failure this module already documented: it disagrees
  // with the renderer on inline code vs emphasis and invents matches.
  //
  // The description is walked **segment by segment**, with each block tagged by
  // the RENDERED SEGMENT it came from (`findDescriptionTarget`). Two facts make
  // that sound rather than merely convenient, and both were measured over this
  // deployment's 100 descriptions:
  //
  //   1. splitting first and lexing each piece yields exactly the same block
  //      list as lexing the whole document (100/100), so the haystack — and
  //      therefore every count, hit and step — is unchanged by this; and
  //   2. `splitMarkdown`'s type sequence is identical for the raw description and
  //      for the preprocessed one the renderer splits (100/100), so the index
  //      this tags a block with is the index the renderer reports geometry for.
  //
  // What the tag buys: a hit in segment 4 can land using segment 4's MEASURED
  // rectangle instead of an offset extrapolated across the code fences and
  // tables before it (see `descriptionFindOffset`).
  const description = header?.description;
  if (description) {
    const segments = splitMarkdown(description);
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index]!;
      // A non-prose segment (a fence, an image, block math) holds nothing
      // `extractSearchBlocks` would return — the splitter only routes prose
      // here, and the extractor drops fences and images itself. Skipping them
      // is what keeps this list identical to the whole-document walk.
      if (segment.type !== "prose") continue;
      const blocks = extractSearchBlocks(segment.content);
      // The denominator for a block's `fraction`: the segment's own searchable
      // text, not the raw source. Everything in this module counts characters
      // of SEARCHABLE text, so a fraction taken against raw markdown would be
      // measuring a different string than the one find matched in — and the
      // raw source includes syntax the reader never sees.
      const span = blocks.reduce((n, text) => n + text.length, 0);
      let elapsed = 0;
      for (const text of blocks) {
        if (text.length > 0) {
          out.push({
            targetId: findDescriptionTarget(index),
            text,
            fractionBase: elapsed,
            fractionSpan: span,
          });
        }
        elapsed += text.length;
      }
    }
  }

  // The timeline, in its own order: a comment contributes its body, an
  // activity row contributes the text it draws. Walking `entries` once keeps
  // the two interleaved the way the list renders them, so `n/m` steps in the
  // order the reader scrolls.
  for (const entry of entries ?? []) {
    if (entry.type === "activity") {
      // Absent from the index means the row is not rendered — a merged-away
      // entry, or a caller that passed no index at all. Either way there is
      // nothing on screen to land on, so nothing is counted. See
      // `lib/activity-search.ts` for why the index is keyed by row, not by
      // raw entry.
      for (const text of activityBlocks?.get(entry.id) ?? []) {
        if (text.length === 0) continue;
        out.push({ targetId: entry.id, text });
      }
      continue;
    }
    if (entry.type !== "comment") continue;
    if (isDeletedComment(entry)) continue;
    // Joined into ONE entry per comment, not one per block: a hit inside a
    // comment is addressed by comment id alone, so its blocks gain nothing
    // from separate entries — and `findCounter`'s total is unaffected either
    // way, since the match scan is per-occurrence.
    const text = extractSearchBlocks(entry.content).join("\n");
    if (text.length === 0) continue;
    out.push({ targetId: entry.id, text });
  }
  return out;
}

/**
 * Every case-insensitive occurrence of `query` across the page, in reading
 * order: title, description, then the timeline (comments and activity rows in
 * the order the list draws them); within one block, left to right.
 *
 * Returns `[]` for an empty or whitespace-only query. The whitespace test is
 * the stricter of web's two guards: web bails on `!needle` (so `" "` does
 * search for a space) in the walk and separately on `query.trim().length === 0`
 * in the host's recompute, which is the one the user actually experiences.
 * Mobile has a single entry point, so the stricter rule applies here.
 */
export function findInTimeline(
  searchables: readonly Searchable[],
  query: string,
): FindMatch[] {
  const needle = query.toLowerCase();
  if (needle.length === 0 || query.trim().length === 0) return [];

  const matches: FindMatch[] = [];
  for (const { targetId, text, fractionBase, fractionSpan } of searchables) {
    const haystack = text.toLowerCase();
    let index = haystack.indexOf(needle);
    while (index !== -1) {
      // Where in its target this occurrence sits. Only a description segment
      // carries the span, because only there is the target long enough for
      // "land at the top" to leave the match off screen.
      const fraction =
        fractionSpan && fractionSpan > 0
          ? (fractionBase! + index) / fractionSpan
          : undefined;
      matches.push({
        targetId,
        start: index,
        end: index + needle.length,
        ...(fraction === undefined ? {} : { fraction }),
      });
      // Advance by the needle's length, not by one: overlapping occurrences are
      // not separate hits. Web's walk does the same
      // (`indexOf(needle, index + needle.length)`), so "aa" in "aaa" counts
      // once in both clients.
      index = haystack.indexOf(needle, index + needle.length);
    }
  }
  return matches;
}

/**
 * The `n/m` counter's user-visible state, and the empty state web renders
 * instead of `0/0`.
 *
 * Web's `find-bar.tsx:30-40`:
 *
 *   - no query at all → the counter area is **blank** (not `0/0`, not the
 *     no-matches phrase);
 *   - query with no hits → `detail.find.no_matches`;
 *   - query with hits → `detail.find.count` bound to `current` / `total`,
 *     where `current` is **1-based** (web passes `activeIndex + 1`).
 *
 * `activeIndex` is clamped rather than trusted: it is state a content change
 * can leave pointing past the end of a shrunken match set, and the counter must
 * never print `5/3`.
 */
export interface FindCounter {
  /** `"count"` / `"no_matches"` / `"none"` — which string to render. */
  kind: "none" | "no_matches" | "count";
  /** 1-based position of the active match. Only meaningful for `"count"`. */
  current: number;
  /** Total matches. */
  total: number;
}

export function findCounter(
  query: string,
  matchCount: number,
  activeIndex: number,
): FindCounter {
  if (query.trim().length === 0) {
    return { kind: "none", current: 0, total: 0 };
  }
  if (matchCount === 0) {
    return { kind: "no_matches", current: 0, total: 0 };
  }
  const clamped = Math.min(Math.max(activeIndex, 0), matchCount - 1);
  return { kind: "count", current: clamped + 1, total: matchCount };
}

/**
 * Step the active index, wrapping at both ends — web's `goNext` / `goPrev`
 * (`use-in-page-find.ts:299-315`). Wrapping is what makes the buttons usable
 * with two hits: without it the reader has to notice they are at the end and
 * press the other arrow.
 *
 * `-1` (nothing active yet) enters at the first match going forward and at the
 * last going backward, matching web.
 */
export function stepMatch(
  activeIndex: number,
  matchCount: number,
  direction: 1 | -1,
): number {
  if (matchCount === 0) return -1;
  if (activeIndex < 0) return direction === 1 ? 0 : matchCount - 1;
  return (activeIndex + direction + matchCount) % matchCount;
}

/**
 * Where to scroll for a match inside a description segment.
 *
 * Inputs, all in the scroll content's own coordinates except the last:
 *
 *   - `segmentTop` / `segmentHeight` — the segment's rectangle as MEASURED by
 *     its own `onLayout` (`Markdown.onSegmentLayout`), not modelled;
 *   - `fraction` — where inside the segment the match sits; and
 *   - `viewportHeight` — the visible height of the scroll container, from its
 *     own `onLayout`.
 *
 * ## The rule, and where it comes from
 *
 * Web's `scrollRangeIntoView` (`use-in-page-find.ts:86-102`) computes
 * `offsetWithin - clientHeight/2 + rectHeight/2` — it CENTRES the match — and it
 * does nothing at all when the match is already inside the comfortable band
 * (`pad = 80`: not above `top + pad`, not below `bottom - pad`). This function
 * does the centring half; the band test belongs to the caller, which is the only
 * place that knows whether the match is already on screen.
 *
 *     offset = segmentTop + fraction * segmentHeight - viewportHeight / 2
 *
 * ## Why centring, and not "place the match just below the top edge"
 *
 * `fraction` is a MODEL, and centring is what makes its error survivable.
 * Placing the match `pad` below the top edge gives it only `pad` of slack, so
 * any model error larger than `pad` pushes the match off screen — the bug this
 * round exists to fix, reintroduced with more machinery around it.
 *
 * That is not hypothetical. The first cut of this function subtracted a 12dp
 * pad, and the DEVICE rejected it: on the fixture (MYS-2077) the token's
 * modelled fraction inside its segment is 0.800 while the text that actually
 * rendered at the resulting scroll position sits at 0.920 — a **12-point**
 * error. A searchable block is not a rendered line: one markdown table ROW is a
 * single drawn line but contributes one block per CELL, so it consumes several
 * times the vertical share its character count suggests. 12% of that segment is
 * ~240dp, which against a 12dp pad left the match ~240dp above the viewport;
 * against `viewportHeight / 2` (~350dp) the same error still lands on screen.
 *
 * Centring therefore buys half a viewport of tolerance instead of a few pixels,
 * and it is what web does with the same intent. The cost is one web also
 * accepts: for a match very near the document start the target offset goes
 * negative and clamps to 0, so the match sits lower than centre — visible,
 * which is the requirement, rather than centred, which is a nicety.
 *
 * `viewportHeight <= 0` (the list has not laid out yet) falls back to no pad, so
 * the match lands at its segment's top — reachable only before the first layout
 * pass, and still strictly better than the description top.
 *
 * `fraction` is clamped, not trusted: it is derived from a model, and a value
 * outside [0,1] would otherwise scroll to a nonsense offset. The clamp is
 * directional — an over-large fraction pins to the segment's BOTTOM and a
 * negative one to its top — so a bad number still lands inside the segment that
 * holds the match. `NaN` is the exception: it has no direction, so it falls back
 * to the segment's top rather than propagating into the offset (`Math.min` over a
 * `NaN` would poison the whole result and scroll to `NaN`).
 *
 * `segmentHeight <= 0` (a segment that has not laid out yet) falls back to
 * `segmentTop` alone: the top of the segment is still the right neighbourhood,
 * and it degrades to a position strictly better than today's description top.
 */
export function descriptionFindOffset({
  segmentTop,
  segmentHeight,
  fraction,
  viewportHeight,
}: {
  segmentTop: number;
  segmentHeight: number;
  fraction: number | undefined;
  /** The scroll container's visible height, from its `onLayout`. `0` before it
   *  has laid out — see above. */
  viewportHeight: number;
}): number {
  const raw = fraction ?? 0;
  const safeFraction = Number.isNaN(raw) ? 0 : Math.min(Math.max(raw, 0), 1);
  const height = Number.isFinite(segmentHeight) ? Math.max(0, segmentHeight) : 0;
  const within = height > 0 ? safeFraction * height : 0;
  const viewport = Number.isFinite(viewportHeight)
    ? Math.max(0, viewportHeight)
    : 0;
  return Math.max(0, segmentTop + within - viewport / 2);
}

/**
 * The jump/highlight target a given match should scroll to and flash.
 *
 * Its own function because it is the single place the two halves meet: the
 * match knows where it lives, and the timeline's existing highlight channel
 * (`highlightCommentId` / `highlightNonce`, see
 * `components/issue/timeline-list.tsx`) is keyed by a target id. A reply id
 * works there too — `CommentCard` highlights the matching reply inline — so a
 * hit inside a reply lands on the reply itself, not merely on its thread root.
 * An activity row's id works there unchanged, because an activity row is a row
 * of the same list.
 *
 * Since an earlier round the return value may also be one of the two header
 * sentinels; `TimelineList` is what gives those their meaning (scroll to the
 * header, flash that block). Everything already consuming an entry id keeps
 * working unchanged, because a sentinel only appears when the caller passed a
 * header in.
 */
export function matchTarget(match: FindMatch | undefined): string | undefined {
  return match?.targetId;
}
