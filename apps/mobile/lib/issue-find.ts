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
 * module closes that: the searchable text is **each comment's full body**,
 * replies included.
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
 *   belongs to exactly one comment, which is what the jump target needs.
 *   Mobile is therefore strictly *more* permissive inside a block and
 *   identical across blocks — never less able to find something.
 * - **Empty / whitespace-only query matches nothing.** Web returns early on
 *   `!needle` and again on `query.trim().length === 0` in `recompute`.
 *
 * ## What is deliberately NOT searchable
 *
 * - **Activity rows.** An activity carries no body (`TimelineEntry.content` is
 *   a comment field); web's walk visits every text node of the scroll root, so
 *   it can match an activity's rendered verb. Mobile has no DOM to walk and no
 *   rendered text to read back, so it searches what it can address: comment
 *   bodies. Counting activities would inflate `matchCount` with hits that have
 *   no text and no jump target, so the count would disagree with what the
 *   reader can step through.
 * - **Code fences.** A fenced block is program text, not prose. Mirrors web's
 *   `SKIP_TAGS` (`SCRIPT` / `STYLE` / `NOSCRIPT`) — content present in the
 *   document that find should not walk. `thread-nav.ts` makes the same call
 *   for its preview (`` ```…``` `` collapses to nothing, "they carry no
 *   scannable text").
 * - **Deleted comments.** A tombstone renders no body and, for a reply, no row
 *   at all (`lib/comment-deletion.ts` → `comment-card.tsx`). A match there
 *   would point at something the reader cannot see.
 * - **Images.** Guarded on the alt text, which the renderer does not draw as
 *   text — a match there would be unfindable on screen.
 *
 * ## Known boundary: the title and description are not searched
 *
 * Web's search container is the whole scroll root — the issue title, its
 * description, every comment and every activity (`issue-detail.tsx:2625`). This
 * module searches **comment bodies only**, which is the input contract the
 * round was specified with (`TimelineEntry[]`, and every acceptance fixture is
 * a comment). The boundary is real and worth stating: a phrase that appears
 * only in the issue's description is findable on web and not here.
 *
 * It was left out deliberately rather than overlooked. Closing the comment half
 * first is the measurable part — replies alone are 43% / 63% of the text on the
 * long issues this round was justified with, and none of it was reachable at
 * all. The description half needs a second kind of jump target (the header has
 * no comment id, so it would scroll to offset 0 — a different code path in
 * `TimelineList`), and folding two target kinds into one round is how the
 * "one mechanism, two meanings" bugs in this file's callers started.
 *
 * PURE — no React, no i18n, no native imports. Runs in the Node vitest lane.
 */
import { marked } from "marked";
import type { TimelineEntry } from "@multica/core/types";
import { isDeletedComment } from "./comment-deletion";
import { stripHtml } from "./markdown/preprocess";

/** One occurrence of the query inside one comment's searchable text. */
export interface FindMatch {
  /** Id of the comment the match lives in — the jump/highlight target. */
  commentId: string;
  /**
   * 0-based offset of the match within the comment's own searchable text.
   * Offsets from different comments are therefore not comparable; they are
   * only meaningful together with `commentId`.
   */
  start: number;
  /** Exclusive end offset, so `end - start === needle.length`. */
  end: number;
}

/** A comment's flattened searchable text plus the match offsets inside it. */
interface Searchable {
  commentId: string;
  text: string;
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
 * Every comment entry's searchable text, in timeline order.
 *
 * Kept separate from `findInTimeline` so a caller that recomputes on every
 * keystroke can build the haystack once per timeline change and re-run only the
 * (cheap) scan — the same split as web, whose host passes a `contentKey` and
 * whose hook re-walks the DOM only when it changes.
 */
export function collectSearchables(
  entries: readonly TimelineEntry[] | undefined,
): Searchable[] {
  if (!entries) return [];
  const out: Searchable[] = [];
  for (const entry of entries) {
    if (entry.type !== "comment") continue;
    if (isDeletedComment(entry)) continue;
    const text = extractSearchBlocks(entry.content).join("\n");
    if (text.length === 0) continue;
    out.push({ commentId: entry.id, text });
  }
  return out;
}

/**
 * Every case-insensitive occurrence of `query` across the timeline, in timeline
 * order and, within one comment, in reading order.
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
  for (const { commentId, text } of searchables) {
    const haystack = text.toLowerCase();
    let index = haystack.indexOf(needle);
    while (index !== -1) {
      matches.push({ commentId, start: index, end: index + needle.length });
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
 * The comment id a given match should scroll to and flash.
 *
 * Its own function because it is the single place the two halves meet: the
 * match knows which comment it belongs to, and the timeline's existing
 * highlight channel (`highlightCommentId` / `highlightNonce`, see
 * `components/issue/timeline-list.tsx`) is keyed by comment id. A reply id
 * works there too — `CommentCard` highlights the matching reply inline — so a
 * hit inside a reply lands on the reply itself, not merely on its thread root.
 */
export function matchTarget(match: FindMatch | undefined): string | undefined {
  return match?.commentId;
}
