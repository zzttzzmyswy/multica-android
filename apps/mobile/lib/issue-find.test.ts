/**
 * Unit tests for the issue timeline's in-page find (`lib/issue-find.ts`).
 *
 * The behaviours pinned here are the ones that carry product meaning — each is
 * tied to the web hook it ports (`packages/views/issues/hooks/use-in-page-find.ts`)
 * or to the acceptance criteria on MYS-2090, not to a convenient local shape:
 *
 *   - **The searchable text is the FULL body.** This is the whole point of the
 *     round: the pre-existing thread navigator searches the first 240
 *     characters of root comments only (`lib/thread-nav.ts`), which reaches
 *     10.6% / 3.8% of the text on this deployment's long issues and nothing at
 *     all inside replies.
 *   - **Replies are searchable.** A hit inside a reply is the case the
 *     navigator structurally cannot answer.
 *   - **Case-insensitive.** Web lowercases both sides.
 *   - **A match never straddles a block boundary**, but it *does* span inline
 *     elements inside one block — a documented, one-directional divergence
 *     from web, whose text-node walk stops at a bold run.
 *   - **Code fences are not prose.** Mirrors web's `SKIP_TAGS`.
 *   - **Activity rows and tombstones contribute nothing**, so `matchCount`
 *     counts only hits a reader can step through and see.
 *   - **`n/m` is 1-based and never exceeds `m`**, and the empty state is the
 *     no-matches phrase rather than `0/0`.
 */
import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "@multica/core/types";
import {
  collectSearchables,
  descriptionFindOffset,
  descriptionTargetIndex,
  extractSearchBlocks,
  findCounter,
  findDescriptionTarget,
  findInTimeline,
  FIND_TARGET_DESCRIPTION,
  FIND_TARGET_TITLE,
  isDescriptionFindTarget,
  matchTarget,
  stepMatch,
} from "./issue-find";

function comment(
  id: string,
  content: string,
  partial: Partial<TimelineEntry> = {},
): TimelineEntry {
  return {
    type: "comment",
    id,
    actor_type: "member",
    actor_id: "u1",
    created_at: "2026-01-01T00:00:00Z",
    content,
    ...partial,
  };
}

function activity(id: string, action = "status_changed"): TimelineEntry {
  return {
    type: "activity",
    id,
    actor_type: "member",
    actor_id: "u1",
    created_at: "2026-01-01T00:00:00Z",
    action,
  };
}

const hits = (entries: readonly TimelineEntry[], q: string) =>
  findInTimeline(collectSearchables(entries), q);

describe("searchable text is the full comment body", () => {
  it("reaches text far past the thread navigator's 240-character preview", () => {
    // 400 characters of filler, then the needle. The navigator truncates a
    // root comment's preview at title 80 + body 160, so this word is invisible
    // to it — and visible here.
    const body = `${"filler ".repeat(57)}NEEDLE_AT_THE_END`;
    expect(body.indexOf("NEEDLE_AT_THE_END")).toBeGreaterThan(240);

    const found = hits([comment("c1", body)], "needle_at_the_end");
    expect(found).toHaveLength(1);
    expect(found[0]!.targetId).toBe("c1");
  });

  it("searches inside replies, which the navigator never indexes", () => {
    const entries = [
      comment("root", "the root comment"),
      comment("reply", "a reply carrying the PHRASE", { parent_id: "root" }),
    ];
    const found = hits(entries, "phrase");
    expect(found.map((m) => m.targetId)).toEqual(["reply"]);
  });

  it("reads markdown source as the words the reader sees", () => {
    // Emphasis / links / inline code contribute their text; the URL does not.
    const blocks = extractSearchBlocks(
      "This is **bold** and `code` and [a label](https://example.com/hidden).",
    );
    const text = blocks.join("\n");
    expect(text).toContain("bold");
    expect(text).toContain("code");
    expect(text).toContain("a label");
    expect(text).not.toContain("example.com");
  });

  it("matches across a bold run — more permissive than web, by design", () => {
    // Web's walk visits DOM text nodes, and a bold run is its own text node,
    // so web does NOT match this. RN has no per-inline text nodes, and the
    // reader perceives one run of text, so mobile matches. The divergence is
    // one-directional: mobile only ever finds more, never less.
    expect(hits([comment("c1", "keep **this** word")], "keep this word")).toHaveLength(
      1,
    );
  });

  it("keeps a link's label searchable but not its URL", () => {
    expect(extractSearchBlocks("[docs](https://x.y/z)").join("")).toBe("docs");
    expect(hits([comment("c1", "[docs](https://x.y/z)")], "x.y")).toEqual([]);
  });

  it("keeps identifiers inside inline code intact", () => {
    // A real defect this pins: a probe that mirrored this module in Python
    // stripped `_` as an emphasis marker across the whole line, so it reported
    // the word `LOGICALDISPLAYNODE` in text that actually reads
    // `LOGICAL_DISPLAY_NODE` inside backticks. The device then correctly found
    // nothing, and the disagreement looked like an app bug. Underscores are
    // emphasis only OUTSIDE code spans, and `marked` already knows which is
    // which — so the underscores must survive.
    expect(extractSearchBlocks("`LOGICAL_DISPLAY_NODE` 全是纯色")).toEqual([
      "LOGICAL_DISPLAY_NODE 全是纯色",
    ]);
    expect(hits([comment("c1", "`LOGICAL_DISPLAY_NODE`")], "LOGICAL_DISPLAY_NODE")).toHaveLength(1);
    expect(hits([comment("c1", "`LOGICAL_DISPLAY_NODE`")], "LOGICALDISPLAYNODE")).toEqual([]);
  });

  it("drops emphasis markers outside code spans", () => {
    // The other half of the same rule: `_like this_` is emphasis, so the
    // markers are not part of the text the reader sees.
    expect(extractSearchBlocks("an _emphasised_ word")).toEqual([
      "an emphasised word",
    ]);
  });

  it("indexes table cells", () => {
    const md = ["| head | other |", "| --- | --- |", "| CELL_A | CELL_B |"].join(
      "\n",
    );
    const text = extractSearchBlocks(md).join("\n");
    expect(text).toContain("CELL_A");
    expect(text).toContain("CELL_B");
  });

  it("indexes list items, including a nested list", () => {
    // `marked` hands a list item's inline content over inside a `text`
    // container whose own `.text` is the RAW source. Reading that would put
    // `**bold**` in the haystack — words the reader never sees — so the walk
    // has to descend into the container instead.
    expect(extractSearchBlocks("- item one\n- item two with **bold**")).toEqual([
      "item one",
      "item two with bold",
    ]);
    expect(extractSearchBlocks("1. ordered a\n   - nested x")).toEqual([
      "ordered a",
      "nested x",
    ]);
  });

  it("never puts markdown syntax into the haystack", () => {
    // The failure this guards: a container's `.text` is source, not rendered
    // text, so a naive walk makes `**` or `#` searchable and reports hits
    // that paint nothing on screen.
    for (const md of [
      "- item **bold** and `code`",
      "# Title **bold**",
      "> quoted **bold**",
      "1. a _b_ c",
    ]) {
      const text = extractSearchBlocks(md).join("\n");
      expect(text).not.toContain("*");
      expect(text).not.toContain("#");
      expect(text).not.toContain("`");
      expect(text).not.toContain("_");
    }
  });

  it("indexes a raw HTML block's inner text but not its tags", () => {
    expect(extractSearchBlocks("<div>raw block</div>")).toEqual(["raw block"]);
    expect(hits([comment("c1", "<div>raw block</div>")], "div")).toEqual([]);
  });

  it("decodes HTML entities so on-screen characters are searchable", () => {
    // `marked` keeps `&amp;` verbatim in token text while the renderer draws
    // `&`; without decoding, a query for the visible character misses.
    expect(extractSearchBlocks("a &amp; b")).toEqual(["a & b"]);
    expect(extractSearchBlocks("&lt;tag&gt;")).toEqual(["<tag>"]);
    expect(extractSearchBlocks("&#65;&#x42;")).toEqual(["AB"]);
    expect(hits([comment("c1", "a &amp; b")], "&")).toHaveLength(1);
  });

  it("treats a <br> as a block boundary, as two visible lines", () => {
    expect(extractSearchBlocks("line one<br>line two")).toEqual([
      "line one",
      "line two",
    ]);
    expect(hits([comment("c1", "line one<br>line two")], "one line")).toEqual([]);
  });

  it("keeps a soft line break inside one block, as one paragraph", () => {
    // A single newline is not a block boundary in markdown — it is one wrapped
    // paragraph, so a query may span it. The newline stays IN the text rather
    // than being collapsed to a space: web's haystack is the paragraph's DOM
    // text node, which holds the same literal newline, so the two clients
    // agree — including on the consequence pinned below.
    expect(extractSearchBlocks("alpha\nbeta")).toEqual(["alpha\nbeta"]);
    expect(hits([comment("c1", "alpha\nbeta")], "alpha\nbeta")).toHaveLength(1);
  });

  it("does not let a space match a soft line break — same as web", () => {
    // Deliberate web parity, not an oversight: web searches the DOM text node
    // (`node.nodeValue`), which keeps the source's newline, so a space-joined
    // query misses there too. Collapsing whitespace here would make mobile
    // answer differently from web for the same comment.
    expect(hits([comment("c1", "alpha\nbeta")], "alpha beta")).toEqual([]);
  });

  it("does not index an image's alt text", () => {
    expect(hits([comment("c1", "before ![alt text](i.png) after")], "alt")).toEqual(
      [],
    );
  });

  it("indexes an autolink, whose URL is also its label", () => {
    // Unlike `[label](url)` — where the URL is invisible — an autolink draws
    // the URL itself, so it is genuinely on screen.
    expect(hits([comment("c1", "see <https://x.y/z> now")], "x.y")).toHaveLength(1);
  });
});

describe("case-insensitivity and occurrence counting", () => {
  it("matches regardless of case in either direction", () => {
    const entries = [comment("c1", "Deploy the DEPLOYMENT")];
    expect(hits(entries, "deploy")).toHaveLength(2);
    expect(hits(entries, "DEPLOY")).toHaveLength(2);
    expect(hits(entries, "DePlOy")).toHaveLength(2);
  });

  it("does not double-count overlapping occurrences", () => {
    // Web advances by the needle's length, so "aa" in "aaa" is one hit.
    const found = hits([comment("c1", "aaa")], "aa");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ start: 0, end: 2 });
  });

  it("reports offsets that slice the matched text back out", () => {
    const body = "alpha beta GAMMA";
    const [m] = hits([comment("c1", body)], "gamma");
    expect(m).toBeDefined();
    expect(body.slice(m!.start, m!.end)).toBe("GAMMA");
  });

  it("finds nothing for an empty or whitespace-only query", () => {
    const entries = [comment("c1", "content")];
    expect(hits(entries, "")).toEqual([]);
    expect(hits(entries, "   ")).toEqual([]);
    expect(hits(entries, "\n\t")).toEqual([]);
  });
});

describe("a match never straddles a block boundary", () => {
  it("does not join two paragraphs", () => {
    // The reader sees two lines; web's one-text-node rule would not match
    // across them either.
    const md = "end of one\n\nstart of two";
    expect(hits([comment("c1", md)], "one start")).toEqual([]);
    expect(extractSearchBlocks(md)).toEqual(["end of one", "start of two"]);
  });

  it("does not join a paragraph to a following heading", () => {
    const md = "alpha\n\n## beta";
    expect(hits([comment("c1", md)], "alpha beta")).toEqual([]);
  });

  it("still matches inside a single block across inline elements", () => {
    // `strong` / `em` are inline: the reader sees one run of text, and web's
    // walk over text nodes inside one paragraph matches across them.
    const found = hits([comment("c1", "keep **this** word")], "keep this word");
    expect(found).toHaveLength(1);
  });

  it("does not join one list item to the next", () => {
    const md = ["- first thing", "- second thing"].join("\n");
    expect(hits([comment("c1", md)], "thing second")).toEqual([]);
  });
});

describe("what is not searchable", () => {
  it("skips fenced code blocks", () => {
    const md = ["prose here", "", "```js", "const secret = 1;", "```"].join("\n");
    expect(hits([comment("c1", md)], "secret")).toEqual([]);
    // The surrounding prose still is.
    expect(hits([comment("c1", md)], "prose")).toHaveLength(1);
  });

  it("counts no activity rows when the caller supplies no activity index", () => {
    // MYS-2109 turned activities INTO a searchable surface, but only through the
    // index the caller passes in (`lib/activity-search.ts`). A caller that does
    // not build one gets exactly the previous behaviour — same contract as the
    // absent `header`: nothing the caller omits can be found. That is what keeps
    // the timeline-only input this module shipped with honest, and it is why the
    // activity half is a separate, explicit argument rather than something
    // `collectSearchables` reaches for on its own.
    const entries = [activity("a1"), comment("c1", "real text")];
    expect(collectSearchables(entries)).toHaveLength(1);
    expect(hits(entries, "status")).toEqual([]);
    expect(hits(entries, "real")).toHaveLength(1);
  });

  it("skips deleted comments, which render no body", () => {
    const entries = [
      comment("gone", "tombstoned WORDS", { deleted_at: "2026-01-02T00:00:00Z" }),
      comment("here", "visible WORDS"),
    ];
    const found = hits(entries, "words");
    expect(found.map((m) => m.targetId)).toEqual(["here"]);
  });

  it("ignores a comment whose body is empty", () => {
    expect(collectSearchables([comment("c1", "")])).toEqual([]);
    expect(collectSearchables([comment("c2", "   \n\n  ")])).toEqual([]);
  });

  it("survives an undefined timeline", () => {
    expect(collectSearchables(undefined)).toEqual([]);
  });

  it("indexes header blocks only when the caller passes them in", () => {
    // The timeline-only input this module shipped with still behaves exactly as
    // it did: nothing the caller omits can be found. That matters because
    // `collectSearchables(entries)` is the shape the previous round's callers
    // and tests use, and widening the container must not silently change what
    // an un-updated caller searches.
    const entries = [
      activity("a1"),
      comment("c1", "only the comment body is indexed"),
    ];
    expect(hits(entries, "only the comment body")).toHaveLength(1);
    expect(collectSearchables(entries)).toHaveLength(1);
  });
});

describe("match order", () => {
  it("walks timeline order, then reading order inside a comment", () => {
    const entries = [
      comment("first", "hit one, hit two"),
      comment("second", "hit three"),
    ];
    expect(hits(entries, "hit").map((m) => m.targetId)).toEqual([
      "first",
      "first",
      "second",
    ]);
    expect(hits(entries, "hit").map((m) => m.start)).toEqual([0, 9, 0]);
  });
});

describe("the header is part of the container (title + description)", () => {
  // The gap this round closes, stated as the acceptance fixtures do: a word
  // that is plainly readable on the phone but appears only in the description.
  // The numbers below are measured against this deployment:
  //   MYS-1893 — 49 comments, 72,421 searchable characters, and
  //              `qemu_arm64_linux_min` in NONE of them; it is in the
  //              description.
  //   MYS-2007 — 1 comment, 30 searchable characters; `preview26` is in the
  //              description and the title.
  const withHeader = (
    entries: readonly TimelineEntry[],
    title: string,
    description: string | null,
    q: string,
  ) => findInTimeline(collectSearchables(entries, { title, description }), q);

  it("finds a word that appears only in the description", () => {
    // The exact shape of MYS-1893: a busy timeline that does not contain it.
    const entries = Array.from({ length: 49 }, (_, i) =>
      comment(`c${i}`, `comment ${i} about the build`),
    );
    const description = "产品配置 `vendor/ohemu/qemu_arm64_linux_min/config.json`";
    expect(withHeader(entries, "迭代 I11", description, "qemu_arm64_linux_min")).toHaveLength(1);
    // And it was genuinely unreachable before: the timeline alone has no hit.
    expect(findInTimeline(collectSearchables(entries), "qemu_arm64_linux_min")).toEqual([]);
  });

  it("finds a word that appears only in the title", () => {
    // MYS-2007's case — `preview26` is in its title.
    const found = withHeader(
      [comment("c1", "stub")],
      "G4：Windows preview26 集中实机验收（Explorer / 多屏 DPI）",
      null,
      "preview26",
    );
    expect(found).toHaveLength(1);
    expect(matchTarget(found[0])).toBe(FIND_TARGET_TITLE);
  });

  it("targets the description block, not a comment", () => {
    const found = withHeader([], "t", "the DESCRIPTION body", "description");
    expect(found).toHaveLength(1);
    expect(matchTarget(found[0])).toBe(FIND_TARGET_DESCRIPTION);
  });

  it("never mistakes a header sentinel for a comment id", () => {
    // The sentinels travel the same string channel a comment id does, so they
    // must not be mistakable for one.
    expect(FIND_TARGET_TITLE).not.toBe(FIND_TARGET_DESCRIPTION);
    for (const s of [FIND_TARGET_TITLE, FIND_TARGET_DESCRIPTION]) {
      expect(s.startsWith("__")).toBe(true);
    }
  });

  it("reads the description through the same markdown walk as a comment", () => {
    // The rule this pins: the description must NOT get its own simpler
    // splitter. A naive one strips `_` as an emphasis marker across the whole
    // line and would report `LOGICALDISPLAYNODE` in text that really reads
    // `LOGICAL_DISPLAY_NODE` inside backticks — a fabricated fixture.
    const description = "配置 `LOGICAL_DISPLAY_NODE` 与 `window_scene_board` 部件";
    expect(withHeader([], "t", description, "LOGICAL_DISPLAY_NODE")).toHaveLength(1);
    expect(withHeader([], "t", description, "LOGICALDISPLAYNODE")).toEqual([]);
    // Same call the comment path makes, so the two cannot drift. The block list
    // is compared on its TEXT, because since MYS-2112 each block also carries
    // the rendered segment it came from plus that segment's fraction span — see
    // the dedicated segment suite below, which pins those two fields.
    expect(
      collectSearchables([], { title: "", description }).map((s) => s.text),
    ).toEqual(extractSearchBlocks(description));
  });

  it("keeps the description's code fences out, like a comment's", () => {
    const description = ["prose", "", "```sh", "build.sh --gn-args secret_flag", "```"].join("\n");
    expect(withHeader([], "t", description, "secret_flag")).toEqual([]);
    expect(withHeader([], "t", description, "prose")).toHaveLength(1);
  });

  it("does not lex the title, which the header draws verbatim", () => {
    // `issue-header-card.tsx` renders `<Text>{issue.title}</Text>`, so these
    // characters are on screen. Lexing would delete them and answer a query
    // for `**` with "no matches" on a title that plainly shows `**`.
    const title = "fix **urgent** _now_";
    // `**` opens and closes, so it is two occurrences — found as two literal
    // hits rather than erased as one emphasis pair.
    expect(withHeader([], title, null, "**")).toHaveLength(2);
    expect(withHeader([], title, null, "_now_")).toHaveLength(1);
    expect(withHeader([], title, null, "fix **urgent** _now_")).toHaveLength(1);
  });

  it("puts title before description before comments — the reading order", () => {
    const found = withHeader(
      [comment("c1", "HIT in a comment")],
      "a HIT in the title",
      "a HIT in the description",
      "hit",
    );
    expect(found.map((m) => m.targetId)).toEqual([
      FIND_TARGET_TITLE,
      FIND_TARGET_DESCRIPTION,
      "c1",
    ]);
  });

  it("ignores an absent, empty or whitespace-only title and description", () => {
    const entries = [comment("c1", "body")];
    expect(collectSearchables(entries, { title: "", description: null })).toHaveLength(1);
    expect(collectSearchables(entries, { title: "   ", description: "  \n " })).toHaveLength(1);
    expect(collectSearchables(entries)).toHaveLength(1);
  });

  it("counts description hits in the total, and steps through them", () => {
    // The counter and the stepper read the same array, so a description hit
    // that inflated one without the other would print `n/m` disagreeing with
    // how many steps it takes to walk every match. This walks the real cycle.
    const matches = withHeader(
      [comment("c1", "hit here")],
      "hit title",
      "hit description",
      "hit",
    );
    expect(matches).toHaveLength(3);
    const seen: number[] = [];
    let i = -1;
    for (let step = 0; step < matches.length; step++) {
      i = stepMatch(i, matches.length, 1);
      seen.push(i);
    }
    expect(seen).toEqual([0, 1, 2]);
    expect(findCounter("hit", matches.length, i)).toEqual({
      kind: "count",
      current: 3,
      total: 3,
    });
    // Every step has a target to land on — no match is counted that find
    // cannot then scroll to.
    expect(matches.map((m) => matchTarget(m))).toEqual([
      FIND_TARGET_TITLE,
      FIND_TARGET_DESCRIPTION,
      "c1",
    ]);
  });

  it("does not regress the comment half that already worked", () => {
    // `SetScreenClientBuffer` is the fixture the previous round's device
    // acceptance used; it lives in a comment. Widening the container must not
    // change how it is found or where it lands.
    const entries = [comment("root", "the SetScreenClientBuffer path")];
    const found = withHeader(
      entries,
      "unrelated title",
      "unrelated description",
      "SetScreenClientBuffer",
    );
    expect(found).toHaveLength(1);
    expect(matchTarget(found[0])).toBe("root");
  });
});

describe("activity rows are part of the container (MYS-2109)", () => {
  // The gap this round closes, in the shape the probe measured on the real
  // deployment: on 39 of 40 sampled issues a status word appears ONLY inside an
  // activity row, so find answered "no matches" for a word the reader could
  // plainly read.
  //
  // NOTE the fixture text, because it is the detail the round turned on: the row
  // draws the **localized label** (`In Progress`), never the wire key
  // (`in_progress`). Searching `in_progress` finds nothing on screen in either
  // client — the phrase to search is the label, in the reader's locale. See the
  // pin at the bottom of this block.
  //
  // The index is built by `lib/activity-search.ts`, which needs i18n; passing it
  // in keeps this module — and this Node lane — free of that dependency, which
  // is why every fixture below hands over a literal map.
  const RUN = ["Ada", "changed status: Todo → In Progress"];
  const withActivities = (
    entries: readonly TimelineEntry[],
    blocks: Record<string, string[]>,
    q: string,
  ) => findInTimeline(collectSearchables(entries, undefined, new Map(Object.entries(blocks))), q);

  it("finds a word that lives only in an activity row", () => {
    const entries = [
      activity("a1", "status_changed"),
      comment("c1", "a comment that never mentions it"),
    ];
    // Before this round: 0 hits, while the row drew the word on screen.
    expect(hits(entries, "In Progress")).toEqual([]);
    expect(withActivities(entries, { a1: RUN }, "In Progress")).toHaveLength(1);
  });

  it("targets the activity row's own id, the same channel a comment uses", () => {
    const found = withActivities([activity("a1")], { a1: RUN }, "In Progress");
    expect(found).toHaveLength(1);
    expect(matchTarget(found[0])).toBe("a1");
  });

  it("indexes the label, not the wire key — the raw key is on no screen", () => {
    // Pins the distinction above so a future fixture cannot quietly reintroduce
    // the mistake: `in_progress` is what the SERVER stores and what the status
    // filter offers, but the row draws `In Progress`. Indexing the key instead
    // of the label would report matches for text nobody can see.
    const entries = [activity("a1", "status_changed")];
    expect(withActivities(entries, { a1: RUN }, "in_progress")).toEqual([]);
    expect(withActivities(entries, { a1: RUN }, "In Progress")).toHaveLength(1);
  });

  it("keeps the two text runs in separate blocks, so a query cannot straddle them", () => {
    // Web draws the actor name and the verb as two sibling <span>s, so its
    // text-node walk cannot match across that boundary. One joined string would
    // make mobile MORE permissive than the browser it ports.
    const blocks = { a1: RUN };
    expect(withActivities([activity("a1")], blocks, "Ada changed")).toEqual([]);
    // Each run on its own is found.
    expect(withActivities([activity("a1")], blocks, "Ada")).toHaveLength(1);
    expect(withActivities([activity("a1")], blocks, "changed status")).toHaveLength(1);
  });

  it("walks the timeline in reading order, comments and activities interleaved", () => {
    const entries = [
      activity("a1", "created"),
      comment("c1", "a HIT in a comment"),
      activity("a2", "status_changed"),
    ];
    const found = withActivities(
      entries,
      { a1: ["Ada", "a HIT in an activity"], a2: ["Ada", "a HIT in another"] },
      "a hit",
    );
    expect(found.map((m) => m.targetId)).toEqual(["a1", "c1", "a2"]);
  });

  it("counts every activity hit in the total, and every one has a target", () => {
    // The counter and the stepper read the same array; a hit counted but not
    // landable would make `n/m` disagree with how many steps it takes to walk
    // the matches — the invariant the old exclusion cited and this round keeps.
    const matches = withActivities(
      [activity("a1"), activity("a2")],
      { a1: ["Ada", "hit one"], a2: ["Ada", "hit two"] },
      "hit",
    );
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => matchTarget(m))).toEqual(["a1", "a2"]);
    expect(findCounter("hit", matches.length, 1)).toEqual({
      kind: "count",
      current: 2,
      total: 2,
    });
  });

  it("ignores an activity the index does not name (a merged-away row)", () => {
    // Coalescing keeps one row per merged run. A raw entry that renders nothing
    // must contribute nothing: counting it would promise a step to a row that
    // does not exist, and the scroll effect would refuse to move.
    const entries = [activity("merged-away"), activity("survives")];
    const found = withActivities(entries, { survives: RUN }, "In Progress");
    expect(found.map((m) => m.targetId)).toEqual(["survives"]);
  });

  it("skips an empty block rather than counting a blank match", () => {
    const found = withActivities([activity("a1")], { a1: ["Ada", ""] }, "ada");
    expect(found).toHaveLength(1);
    // An empty query still matches nothing, even with an empty block present.
    expect(withActivities([activity("a1")], { a1: [""] }, "")).toEqual([]);
  });

  it("does not regress the comment and header halves", () => {
    // Widening the timeline must not change how anything already searchable is
    // found or where it lands.
    const entries = [comment("root", "the SetScreenClientBuffer path")];
    const found = findInTimeline(
      collectSearchables(
        entries,
        { title: "a title", description: "a description" },
        new Map([["a1", RUN]]),
      ),
      "SetScreenClientBuffer",
    );
    expect(found).toHaveLength(1);
    expect(matchTarget(found[0])).toBe("root");
  });

  it("stays timeline-only when the caller passes neither header nor index", () => {
    // The contract this module shipped with, and the one its oldest callers
    // still use: nothing the caller omits can be found.
    expect(collectSearchables([activity("a1"), comment("c1", "body")])).toHaveLength(1);
    expect(collectSearchables([activity("a1")])).toEqual([]);
  });
});

describe("findCounter — n/m and the empty state", () => {
  it("shows nothing before a query is typed, not 0/0", () => {
    expect(findCounter("", 0, -1)).toEqual({ kind: "none", current: 0, total: 0 });
    expect(findCounter("   ", 0, -1)).toEqual({
      kind: "none",
      current: 0,
      total: 0,
    });
  });

  it("shows the no-matches phrase, never 1/0, when a query hits nothing", () => {
    const counter = findCounter("zzz", 0, -1);
    expect(counter.kind).toBe("no_matches");
    expect(counter.total).toBe(0);
  });

  it("counts 1-based", () => {
    expect(findCounter("a", 3, 0)).toEqual({ kind: "count", current: 1, total: 3 });
    expect(findCounter("a", 3, 2)).toEqual({ kind: "count", current: 3, total: 3 });
  });

  it("never reports a current past the total", () => {
    // A content change can shrink the match set under a stale index; the
    // counter must not print 5/3.
    const counter = findCounter("a", 3, 4);
    expect(counter).toEqual({ kind: "count", current: 3, total: 3 });
  });

  it("clamps a negative active index up to the first match", () => {
    expect(findCounter("a", 2, -1)).toEqual({ kind: "count", current: 1, total: 2 });
  });

  it("agrees with the real match count for a real query", () => {
    const entries = [comment("c1", "x x x"), comment("c2", "x")];
    const matches = hits(entries, "x");
    expect(findCounter("x", matches.length, matches.length - 1)).toEqual({
      kind: "count",
      current: 4,
      total: 4,
    });
  });
});

describe("stepMatch — prev/next with wrap-around", () => {
  it("enters at the first match going forward", () => {
    expect(stepMatch(-1, 3, 1)).toBe(0);
  });

  it("enters at the last match going backward", () => {
    expect(stepMatch(-1, 3, -1)).toBe(2);
  });

  it("wraps forward off the end", () => {
    expect(stepMatch(2, 3, 1)).toBe(0);
  });

  it("wraps backward off the start", () => {
    expect(stepMatch(0, 3, -1)).toBe(2);
  });

  it("stays at -1 when there is nothing to step to", () => {
    expect(stepMatch(-1, 0, 1)).toBe(-1);
    expect(stepMatch(0, 0, -1)).toBe(-1);
  });

  it("walks every match exactly once over a full cycle", () => {
    const n = 5;
    const seen: number[] = [];
    let i = -1;
    for (let step = 0; step < n; step++) {
      i = stepMatch(i, n, 1);
      seen.push(i);
    }
    expect(seen).toEqual([0, 1, 2, 3, 4]);
    // And the next step returns to the start.
    expect(stepMatch(i, n, 1)).toBe(0);
  });
});

describe("matchTarget", () => {
  it("names the comment the match lives in", () => {
    expect(matchTarget({ targetId: "c9", start: 0, end: 1 })).toBe("c9");
  });

  it("has no target without a match", () => {
    expect(matchTarget(undefined)).toBeUndefined();
  });
});

/**
 * The description's landing target (MYS-2112).
 *
 * Before this round every description block shared ONE target
 * (`FIND_TARGET_DESCRIPTION`), so a hit in the description's 4th rendered
 * segment was landed by scrolling to the description's top. Measured on this
 * deployment, 28% of descriptions contain a table, tables are 8.32% of all
 * description text, and the distance from a description's start to its last
 * table row has a median of 1,939 characters — more than a screen. The device
 * fixture (MYS-2077) put the matched row 1,987dp below the description top
 * against a ~700dp viewport, with find reporting `1/1`.
 *
 * The fix names the rendered SEGMENT. What these tests pin:
 *
 *   - segment 0 keeps the bare sentinel, so every existing consumer keeps its
 *     meaning ("the description's first block");
 *   - the block list is UNCHANGED by segmenting — the same text, in the same
 *     order, the same count (measured identical on 100/100 live descriptions);
 *   - a block carries where it sits inside its segment, which is what turns
 *     "the segment" into a position;
 *   - the landing offset is computed from MEASURED geometry, and degrades to
 *     the old behaviour rather than to nonsense when geometry is missing.
 */
describe("a description hit names the rendered segment it lives in", () => {
  const header = (description: string) => ({ title: "", description });

  it("keeps the bare sentinel for the first segment, so nothing downstream moves", () => {
    // A single-segment description is the common case (87/100 measured), and it
    // must keep producing exactly the target it always did.
    const out = collectSearchables([], header("just one paragraph"));
    expect(out.map((s) => s.targetId)).toEqual([FIND_TARGET_DESCRIPTION]);
    expect(findDescriptionTarget(0)).toBe(FIND_TARGET_DESCRIPTION);
  });

  it("names later segments with their index", () => {
    expect(findDescriptionTarget(1)).toBe(`${FIND_TARGET_DESCRIPTION}:1`);
    expect(findDescriptionTarget(4)).toBe(`${FIND_TARGET_DESCRIPTION}:4`);
    // Still a sentinel — it must never look like a comment uuid, which is the
    // only other thing this channel carries.
    expect(findDescriptionTarget(3).startsWith("__")).toBe(true);
    expect(isDescriptionFindTarget(findDescriptionTarget(3))).toBe(true);
    expect(descriptionTargetIndex(`${FIND_TARGET_DESCRIPTION}:3`)).toBe(3);
    expect(descriptionTargetIndex(FIND_TARGET_DESCRIPTION)).toBe(0);
    // A non-description target must be *rejected* by the predicate, not silently
    // read as segment 0 — the two are indistinguishable through the index alone.
    expect(isDescriptionFindTarget(FIND_TARGET_TITLE)).toBe(false);
    expect(isDescriptionFindTarget("6f1e0a5c-1111-2222-3333-444455556666")).toBe(false);
  });

  it("tags a hit in the 4th segment with that segment, not the description", () => {
    // The MYS-2077 shape: prose, a fence, a fence, then the prose holding the
    // match. The old code answered `FIND_TARGET_DESCRIPTION` for the match,
    // which is why the jump landed at the description's top.
    const description = [
      "opening prose",
      "",
      "```sh",
      "fence one",
      "```",
      "",
      "```sh",
      "fence two",
      "```",
      "",
      "closing prose with the needle",
    ].join("\n");
    const found = findInTimeline(collectSearchables([], header(description)), "needle");
    expect(found).toHaveLength(1);
    expect(matchTarget(found[0])).toBe(`${FIND_TARGET_DESCRIPTION}:3`);
  });

  it("does not change the block list — same text, same order, same count", () => {
    // The load-bearing invariant: segmenting is a RELABELLING. If it reordered
    // or dropped a block, every `n/m` and every step would shift. Measured
    // identical over this deployment's 100 descriptions; pinned here on a shape
    // that exercises prose / fence / table / list / heading together.
    const description = [
      "# heading",
      "",
      "para with `code`",
      "",
      "| a | b |",
      "|---|---|",
      "| c | d |",
      "",
      "- item one",
      "- item two",
      "",
      "```sh",
      "excluded_fence_text",
      "```",
      "",
      "trailing para",
    ].join("\n");
    const whole = extractSearchBlocks(description);
    const bySegment = collectSearchables([], header(description)).map((s) => s.text);
    expect(bySegment).toEqual(whole);
    // And the fence really is excluded, so this test cannot pass vacuously on
    // two empty lists.
    expect(whole.length).toBeGreaterThan(3);
    expect(whole.join("\n")).not.toContain("excluded_fence_text");
  });

  it("reports where a block sits inside its segment, as a 0..1 fraction", () => {
    // A description whose match is in the LAST block of its segment: the
    // fraction must be near 1, which is what puts the match at the segment's
    // bottom rather than its top.
    const description = [
      "first paragraph here",
      "",
      "second paragraph here",
      "",
      "third paragraph with needle",
    ].join("\n");
    const found = findInTimeline(collectSearchables([], header(description)), "needle");
    expect(found).toHaveLength(1);
    expect(found[0]!.fraction).toBeGreaterThan(0.6);
    expect(found[0]!.fraction).toBeLessThanOrEqual(1);

    // A match in the FIRST block sits near 0.
    const first = findInTimeline(
      collectSearchables([], header(description)),
      "first paragraph",
    );
    expect(first[0]!.fraction).toBe(0);
  });

  it("puts a later hit strictly deeper than an earlier one in the same segment", () => {
    // Ordering is the property that matters: the landing must move DOWN the
    // segment as the match moves down the text, or stepping through hits would
    // walk backwards.
    const description = "alpha one\n\nbeta two\n\ngamma three\n\ndelta four";
    const blocks = collectSearchables([], header(description));
    const frac = (q: string) => findInTimeline(blocks, q)[0]!.fraction!;
    expect(frac("alpha")).toBeLessThan(frac("beta"));
    expect(frac("beta")).toBeLessThan(frac("gamma"));
    expect(frac("gamma")).toBeLessThan(frac("delta"));
  });

  it("leaves every non-description target without a fraction", () => {
    // A comment / activity / title hit lands on a ROW, where the whole row is
    // the landing — a fraction there would be meaningless, and a stray one
    // would make `descriptionFindOffset` act on a target it does not own.
    const found = findInTimeline(
      collectSearchables([comment("c1", "needle in a comment")], {
        title: "needle in the title",
        description: null,
      }),
      "needle",
    );
    expect(found).toHaveLength(2);
    for (const m of found) expect(m.fraction).toBeUndefined();
  });

  it("counts and steps every segment's hits, exactly as before", () => {
    // The counter and the stepper read the same array, and a hit in a later
    // segment is still ONE match — the relabelling must not multiply or drop
    // any. This walks the real cycle across segments.
    const description = [
      "hit number one",
      "",
      "```sh",
      "fence",
      "```",
      "",
      "hit number two",
    ].join("\n");
    const matches = findInTimeline(
      collectSearchables([comment("c1", "hit number three")], header(description)),
      "hit number",
    );
    expect(matches).toHaveLength(3);
    expect(matches.map((m) => m.targetId)).toEqual([
      FIND_TARGET_DESCRIPTION,
      `${FIND_TARGET_DESCRIPTION}:2`,
      "c1",
    ]);
    const seen: number[] = [];
    let i = -1;
    for (let step = 0; step < matches.length; step++) {
      i = stepMatch(i, matches.length, 1);
      seen.push(i);
    }
    expect(seen).toEqual([0, 1, 2]);
    expect(findCounter("hit number", matches.length, i)).toEqual({
      kind: "count",
      current: 3,
      total: 3,
    });
  });
});

/**
 * `descriptionFindOffset` — the landing arithmetic.
 *
 * It is separated out and tested here because it is the one place a MODELLED
 * number (the fraction) meets MEASURED ones (the segment rectangle, the
 * viewport), and the failure modes are arithmetic rather than visual: a NaN or
 * an out-of-range fraction would scroll to a nonsense offset, and a missing
 * segment rectangle must degrade to the previous behaviour instead of to the top
 * of the list.
 *
 * The CENTRING is the load-bearing part, and it was settled by the device rather
 * than by taste: the first cut put the match 12dp below the top edge, and the
 * fixture's modelled fraction was 12 points off the real rendered position, which
 * pushed the match ~240dp ABOVE the viewport — the very bug this round fixes.
 * Centring absorbs half a viewport of modelling error instead of 12px.
 */
describe("descriptionFindOffset", () => {
  const VIEWPORT = 700;

  it("centres the match inside its segment", () => {
    // segmentTop 5000, height 2000, fraction 0.9 → the match is 1800 into the
    // segment; centring it puts the viewport's middle there.
    expect(
      descriptionFindOffset({
        segmentTop: 5000,
        segmentHeight: 2000,
        fraction: 0.9,
        viewportHeight: VIEWPORT,
      }),
    ).toBe(5000 + 1800 - 350);
    // Fraction 0 centres the segment's own top.
    expect(
      descriptionFindOffset({
        segmentTop: 5000,
        segmentHeight: 2000,
        fraction: 0,
        viewportHeight: VIEWPORT,
      }),
    ).toBe(5000 - 350);
  });

  it("moves the landing DOWN the segment as the fraction grows", () => {
    // Monotonicity is what makes stepping through hits walk forward instead of
    // jumping around.
    const at = (fraction: number) =>
      descriptionFindOffset({
        segmentTop: 1000,
        segmentHeight: 4000,
        fraction,
        viewportHeight: VIEWPORT,
      });
    expect(at(0)).toBeLessThan(at(0.25));
    expect(at(0.25)).toBeLessThan(at(0.5));
    expect(at(0.5)).toBeLessThan(at(0.75));
    expect(at(0.75)).toBeLessThan(at(1));
  });

  it("absorbs the model's error — the reason for centring", () => {
    // The measured fixture error: the model says 0.800, the rendered text sits
    // at 0.920 of the segment. With centring the gap between the two landings is
    // 0.12 * height = 240dp, and BOTH land the match inside a 700dp viewport,
    // because each is centred. A top-edge pad of 12dp would put the true
    // position 240dp above the viewport.
    const height = 2000;
    const modelled = descriptionFindOffset({
      segmentTop: 3000,
      segmentHeight: height,
      fraction: 0.8,
      viewportHeight: VIEWPORT,
    });
    const truth = descriptionFindOffset({
      segmentTop: 3000,
      segmentHeight: height,
      fraction: 0.92,
      viewportHeight: VIEWPORT,
    });
    // The offset the model computes, versus where the truth should have been:
    // the truth's screen position under the model's offset is still on screen.
    const truthOnScreenUnderModelledOffset =
      3000 + 0.92 * height - modelled;
    expect(truthOnScreenUnderModelledOffset).toBeGreaterThan(0);
    expect(truthOnScreenUnderModelledOffset).toBeLessThan(VIEWPORT);
    // And the two landings differ by exactly the error, so the tolerance is
    // understood rather than accidental.
    expect(truth - modelled).toBeCloseTo(0.12 * height, 5);
  });

  it("falls back to the segment's top when the fraction is unknown", () => {
    // A caller with no fraction still lands strictly better than the old
    // description-top behaviour, because the segment top is measured.
    expect(
      descriptionFindOffset({
        segmentTop: 5000,
        segmentHeight: 2000,
        fraction: undefined,
        viewportHeight: VIEWPORT,
      }),
    ).toBe(5000 - 350);
  });

  it("falls back to no pad before the viewport has been measured", () => {
    // `viewportHeight` is 0 until the list's first layout pass. The landing then
    // sits at the match's position rather than an arbitrary half-viewport above
    // it — degraded, but still the right neighbourhood.
    expect(
      descriptionFindOffset({
        segmentTop: 5000,
        segmentHeight: 2000,
        fraction: 0.5,
        viewportHeight: 0,
      }),
    ).toBe(6000);
  });

  it("falls back to the given origin when the segment height is unmeasured", () => {
    // An unlaid-out segment reports height 0. The offset must then be its top
    // (here: the description's own top, which is what the caller passes), never
    // a fraction of a height that does not exist.
    expect(
      descriptionFindOffset({
        segmentTop: 3782,
        segmentHeight: 0,
        fraction: 0.9,
        viewportHeight: VIEWPORT,
      }),
    ).toBe(3782 - 350);
  });

  it("clamps a nonsense fraction instead of scrolling to a nonsense offset", () => {
    const base = { segmentTop: 1000, segmentHeight: 500, viewportHeight: VIEWPORT };
    // Out of range in both directions.
    expect(descriptionFindOffset({ ...base, fraction: 2 })).toBe(1000 + 500 - 350);
    expect(descriptionFindOffset({ ...base, fraction: -3 })).toBe(1000 - 350);
    // NaN / Infinity — the shapes a bad computation actually produces. NaN has
    // no direction, so it falls back to the segment's top; Infinity clamps to
    // the segment's bottom.
    expect(descriptionFindOffset({ ...base, fraction: Number.NaN })).toBe(1000 - 350);
    expect(descriptionFindOffset({ ...base, fraction: Number.POSITIVE_INFINITY })).toBe(
      1000 + 500 - 350,
    );
  });

  it("never returns a negative offset", () => {
    // A segment near the top of the list with a half-viewport of centring would
    // otherwise ask the list to scroll above its own start.
    expect(
      descriptionFindOffset({
        segmentTop: 5,
        segmentHeight: 100,
        fraction: 0,
        viewportHeight: VIEWPORT,
      }),
    ).toBe(0);
  });
});
