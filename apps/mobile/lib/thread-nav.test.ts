/**
 * Unit tests for the thread navigator's pure logic (`lib/thread-nav.ts`), the
 * mobile port of web's `thread-nav-panel.tsx` + the `thread-minimap.tsx`
 * preview splitter.
 *
 * The behaviours asserted here are the ones that carry product meaning, and
 * each is pinned to the web shape rather than a convenient local shape:
 *
 *   - **`resolved` must cover reply resolutions.** A thread resolved by
 *     replying renders folded in the timeline, so marking it unresolved in the
 *     navigator would put a "still open" row next to a visibly folded thread.
 *   - **`replyCount` must count the whole subtree.** The timeline bundles a
 *     nested chain under one bubble, so a one-level count would show a smaller
 *     number than the bubble the reader is looking at.
 *   - **Orphan replies must not vanish.** The timeline promotes a reply whose
 *     parent is missing to a top-level row (web #1857); a navigator that
 *     dropped it would lose a jump target the reader can see.
 */
import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "@multica/core/types";
import {
  buildThreadNavThreads,
  commentPreview,
  filterThreads,
  groupPreparedThreads,
  matchesFilter,
  mentionsUser,
  prepareThreads,
  threadDayGroup,
  threadFilterCounts,
  type ThreadNavThread,
} from "./thread-nav";

function comment(
  id: string,
  partial: Partial<TimelineEntry> = {},
): TimelineEntry {
  return {
    type: "comment",
    id,
    actor_type: "member",
    actor_id: "u1",
    created_at: "2026-01-01T00:00:00Z",
    content: "",
    ...partial,
  };
}

function thread(
  partial: Partial<ThreadNavThread> = {},
): ThreadNavThread {
  return {
    id: "c1",
    entry: comment("c1"),
    resolved: false,
    replyCount: 0,
    involvesMe: false,
    ...partial,
  };
}

describe("threadDayGroup", () => {
  // A fixed local noon so the "start of today" boundary is unambiguous in
  // whatever zone the test runner sits in.
  const now = new Date(2026, 5, 15, 12, 0, 0).getTime();

  it("buckets today / yesterday / earlier by local calendar day", () => {
    expect(threadDayGroup(new Date(2026, 5, 15, 9, 30).toISOString(), now)).toBe(
      "today",
    );
    expect(threadDayGroup(new Date(2026, 5, 14, 23, 41).toISOString(), now)).toBe(
      "yesterday",
    );
    expect(threadDayGroup(new Date(2026, 5, 13, 23, 41).toISOString(), now)).toBe(
      "earlier",
    );
  });

  it("treats midnight today as today, not yesterday", () => {
    expect(threadDayGroup(new Date(2026, 5, 15, 0, 0).toISOString(), now)).toBe(
      "today",
    );
  });

  it("falls back to `earlier` on an unparseable timestamp", () => {
    expect(threadDayGroup("not a date", now)).toBe("earlier");
  });
});

describe("matchesFilter", () => {
  const open = thread({ id: "open", resolved: false, involvesMe: false });
  const resolved = thread({ id: "resolved", resolved: true, involvesMe: false });
  const mine = thread({ id: "mine", resolved: false, involvesMe: true });

  it("partitions by resolution and involvement", () => {
    expect(matchesFilter(open, "all")).toBe(true);
    expect(matchesFilter(resolved, "all")).toBe(true);
    expect(matchesFilter(mine, "all")).toBe(true);

    expect(matchesFilter(open, "unresolved")).toBe(true);
    expect(matchesFilter(resolved, "unresolved")).toBe(false);

    expect(matchesFilter(resolved, "resolved")).toBe(true);
    expect(matchesFilter(open, "resolved")).toBe(false);

    expect(matchesFilter(mine, "mine")).toBe(true);
    expect(matchesFilter(open, "mine")).toBe(false);
  });

  it("keeps the total default arm: an unknown filter hides nothing", () => {
    // Web's default arm exists so a future server-driven filter can't blank
    // the list. Reaching it requires a cast, which is the point.
    expect(matchesFilter(open, "nonsense" as never)).toBe(true);
  });
});

describe("mentionsUser", () => {
  const uid = "11111111-2222-3333-4444-555555555555";

  it("matches the current link form", () => {
    expect(
      mentionsUser(`hey [@Ada](mention://member/${uid}) take a look`, uid),
    ).toBe(true);
  });

  it("matches the legacy shortcode form still sitting in the database", () => {
    // Mentions were stored as `[@ id="..." label="..."]` before the link
    // migration; `preprocessMarkdown` converts on read, so the timeline hands
    // the navigator the raw form. Matching only links would drop these.
    const legacy = `[@ id="${uid}" label="Ada"] please review`;
    expect(mentionsUser(legacy, uid)).toBe(true);
  });

  it("does not match a different member, or an empty/missing input", () => {
    expect(mentionsUser(`[@Ada](mention://member/other-id)`, uid)).toBe(false);
    expect(mentionsUser("no mentions here", uid)).toBe(false);
    expect(mentionsUser(undefined, uid)).toBe(false);
    expect(mentionsUser(`[@Ada](mention://member/${uid})`, "")).toBe(false);
  });

  it("does not match a mention of a non-member actor carrying the same id", () => {
    // `mention://agent/<id>` must not count as mentioning a member.
    expect(mentionsUser(`[@Bot](mention://agent/${uid})`, uid)).toBe(false);
  });
});

describe("commentPreview", () => {
  it("splits the first line into a title and the rest into a body", () => {
    expect(commentPreview("Deploy failed\nbecause the token expired")).toEqual({
      title: "Deploy failed",
      body: "because the token expired",
    });
  });

  it("strips code fences, link syntax, list bullets and emphasis markers", () => {
    const md = [
      "## Fix the [parser](https://example.com)",
      "```ts",
      "const x = 1;",
      "```",
      "- see `foo` for *details*",
    ].join("\n");
    const { title, body } = commentPreview(md);
    expect(title).toBe("Fix the parser");
    // The fenced block contributes no scannable text; the bullet's marker and
    // its backticks/asterisks are gone, leaving readable prose.
    expect(body).toBe("see foo for details");
  });

  it("degrades an image to its alt text", () => {
    expect(commentPreview("![diagram](https://example.com/x.png)")).toEqual({
      title: "diagram",
      body: "",
    });
  });

  it("returns empty strings for whitespace-only markdown", () => {
    expect(commentPreview("   \n\n  ")).toEqual({ title: "", body: "" });
  });

  it("clips the title at 80 chars and the body at 160", () => {
    const { title, body } = commentPreview(
      `${"t".repeat(200)}\n${"b".repeat(400)}`,
    );
    expect(title).toHaveLength(80);
    expect(body).toHaveLength(160);
  });
});

describe("buildThreadNavThreads", () => {
  it("emits one row per top-level comment, in timeline order", () => {
    const threads = buildThreadNavThreads(
      [comment("a"), comment("b"), comment("c")],
      null,
    );
    expect(threads.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(threads.every((t) => t.replyCount === 0)).toBe(true);
  });

  it("ignores activity entries and replies as roots", () => {
    const entries: TimelineEntry[] = [
      comment("root"),
      comment("reply", { parent_id: "root" }),
      { ...comment("act"), type: "activity" } as TimelineEntry,
    ];
    const threads = buildThreadNavThreads(entries, null);
    expect(threads.map((t) => t.id)).toEqual(["root"]);
    expect(threads[0]!.replyCount).toBe(1);
  });

  it("rescues an orphan reply as a top-level row, like the timeline does", () => {
    // A reply whose parent is not in the loaded batch is promoted by
    // `buildTimelineRows` (web #1857) so the subtree isn't silently lost. The
    // navigator must promote it too, otherwise the row is visible in the
    // timeline with no jump target here.
    const entries: TimelineEntry[] = [
      comment("A"),
      comment("orphan", { parent_id: "not-in-batch" }),
    ];
    const threads = buildThreadNavThreads(entries, null);
    expect(threads.map((t) => t.id)).toEqual(["A", "orphan"]);
    expect(threads[1]!.replyCount).toBe(0);
  });

  it("counts a nested reply chain as part of the root's subtree", () => {
    // A → B → C. The timeline bundles the whole chain into A's bubble, so the
    // navigator must report 2 replies, not 1.
    const entries: TimelineEntry[] = [
      comment("A"),
      comment("B", { parent_id: "A" }),
      comment("C", { parent_id: "B" }),
    ];
    const threads = buildThreadNavThreads(entries, null);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.replyCount).toBe(2);
  });

  it("marks a reply-resolved thread resolved, matching the folded timeline", () => {
    const entries: TimelineEntry[] = [
      comment("A"),
      comment("B", {
        parent_id: "A",
        resolved_at: "2026-01-02T00:00:00Z",
      }),
    ];
    const threads = buildThreadNavThreads(entries, null);
    expect(threads[0]!.resolved).toBe(true);
  });

  it("leaves an unresolved thread unresolved", () => {
    const threads = buildThreadNavThreads(
      [comment("A"), comment("B", { parent_id: "A" })],
      null,
    );
    expect(threads[0]!.resolved).toBe(false);
  });

  it("flags `involvesMe` when the reader authored the root or a reply", () => {
    const entries: TimelineEntry[] = [
      comment("A", { actor_id: "me" }),
      comment("B", { parent_id: "A", actor_id: "other" }),
    ];
    const threads = buildThreadNavThreads(entries, "me");
    expect(threads[0]!.involvesMe).toBe(true);
  });

  it("flags `involvesMe` when only a reply @mentions the reader", () => {
    const entries: TimelineEntry[] = [
      comment("A", { actor_id: "other" }),
      comment("B", {
        parent_id: "A",
        actor_id: "other",
        content: "[@Me](mention://member/me) thoughts?",
      }),
    ];
    const threads = buildThreadNavThreads(entries, "me");
    expect(threads[0]!.involvesMe).toBe(true);
  });

  it("leaves `involvesMe` false without a signed-in user", () => {
    const threads = buildThreadNavThreads(
      [comment("A", { actor_id: "me" })],
      null,
    );
    expect(threads[0]!.involvesMe).toBe(false);
  });

  it("does not let an agent's authorship count as the reader's", () => {
    // Web's rule is `entry.actor_type === "member" && actor_id === userId`.
    // An agent whose id collides with the reader's must not match.
    const entries: TimelineEntry[] = [
      comment("A", { actor_type: "agent", actor_id: "me" }),
    ];
    const threads = buildThreadNavThreads(entries, "me");
    expect(threads[0]!.involvesMe).toBe(false);
  });
});

describe("prepareThreads", () => {
  const now = new Date(2026, 5, 15, 12, 0, 0).getTime();
  const name = () => "Ada";

  function built(partial: Partial<TimelineEntry> = {}): ThreadNavThread[] {
    return buildThreadNavThreads([comment("c1", partial)], null);
  }

  it("splits the preview into title + excerpt and records the author", () => {
    const [row] = prepareThreads(
      built({ content: "Deploy failed\nbecause the token expired" }),
      name,
      now,
    );
    expect(row!.title).toBe("Deploy failed");
    expect(row!.excerpt).toBe("because the token expired");
    expect(row!.authorName).toBe("Ada");
  });

  it("falls back to the author name when the comment body is empty", () => {
    // An attachment-only or bare-mention comment has no first line; without
    // the fallback the row renders blank and there is nothing to aim at.
    const [row] = prepareThreads(built({ content: "   " }), name, now);
    expect(row!.title).toBe("Ada");
    expect(row!.excerpt).toBe("");
  });

  it("buckets by the reader's local day", () => {
    const rows = prepareThreads(
      built({ created_at: new Date(2026, 5, 13, 9, 0).toISOString() }),
      name,
      now,
    );
    expect(rows[0]!.group).toBe("earlier");
  });

  it("puts title, excerpt and author all in the search haystack", () => {
    const [row] = prepareThreads(
      built({ content: "Deploy failed\nbecause the token expired" }),
      name,
      now,
    );
    expect(row!.haystack).toContain("deploy failed");
    expect(row!.haystack).toContain("token expired");
    expect(row!.haystack).toContain("ada");
  });
});

describe("filterThreads", () => {
  const now = new Date(2026, 5, 15, 12, 0, 0).getTime();
  const name = () => "Ada";

  const prepared = prepareThreads(
    [
      ...buildThreadNavThreads(
        [comment("open", { content: "Open question" })],
        null,
      ),
      ...buildThreadNavThreads(
        [
          comment("resolved", { content: "Settled thing" }),
          comment("r", {
            parent_id: "resolved",
            resolved_at: "2026-01-02T00:00:00Z",
          }),
        ],
        null,
      ),
    ],
    name,
    now,
  );

  it("matches the query against title, excerpt and author", () => {
    expect(filterThreads(prepared, "all", "settled").map((r) => r.thread.id)).toEqual([
      "resolved",
    ]);
    expect(filterThreads(prepared, "all", "ada")).toHaveLength(2);
    expect(filterThreads(prepared, "all", "").map((r) => r.thread.id)).toEqual([
      "open",
      "resolved",
    ]);
  });

  it("ANDs the filter chip with the query", () => {
    expect(
      filterThreads(prepared, "resolved", "open").map((r) => r.thread.id),
    ).toEqual([]);
    expect(
      filterThreads(prepared, "unresolved", "open").map((r) => r.thread.id),
    ).toEqual(["open"]);
  });

  it("is case-insensitive and trims the query", () => {
    expect(
      filterThreads(prepared, "all", "  OPEN  ").map((r) => r.thread.id),
    ).toEqual(["open"]);
  });
});

describe("groupPreparedThreads", () => {
  const now = new Date(2026, 5, 15, 12, 0, 0).getTime();
  const name = () => "Ada";

  it("omits empty buckets so no orphan header is drawn", () => {
    const prepared = prepareThreads(
      buildThreadNavThreads(
        [comment("a", { created_at: new Date(2026, 5, 15, 9, 0).toISOString() })],
        null,
      ),
      name,
      now,
    );
    const sections = groupPreparedThreads(prepared);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.group).toBe("today");
  });

  it("orders buckets today, yesterday, earlier", () => {
    const prepared = prepareThreads(
      buildThreadNavThreads(
        [
          comment("old", { created_at: new Date(2026, 5, 10, 9, 0).toISOString() }),
          comment("yday", { created_at: new Date(2026, 5, 14, 9, 0).toISOString() }),
          comment("now", { created_at: new Date(2026, 5, 15, 9, 0).toISOString() }),
        ],
        null,
      ),
      name,
      now,
    );
    expect(groupPreparedThreads(prepared).map((s) => s.group)).toEqual([
      "today",
      "yesterday",
      "earlier",
    ]);
  });
});

describe("threadFilterCounts", () => {
  it("counts over the whole set, so a selected chip never reads 0", () => {
    const threads = [
      ...buildThreadNavThreads([comment("a")], null),
      ...buildThreadNavThreads(
        [
          comment("b"),
          comment("b1", { parent_id: "b", resolved_at: "2026-01-02T00:00:00Z" }),
        ],
        null,
      ),
      ...buildThreadNavThreads([comment("c", { actor_id: "me" })], "me"),
    ];
    expect(threadFilterCounts(threads)).toEqual({
      all: 3,
      unresolved: 2,
      resolved: 1,
      mine: 1,
    });
  });
});
