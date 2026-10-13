import { describe, expect, it } from "vitest";
import { InboxListSchema } from "./schemas";

/**
 * Tests for mobile's CLIENT-SIDE parsing of GET /api/inbox.
 *
 * Scope, stated precisely because the name of this file used to overclaim:
 * these are hand-written fixtures run against `InboxListSchema`. They pin how
 * this client REACTS to a given payload. They cannot fail when the Go server
 * starts sending something new — nothing here executes server code.
 *
 * The matching server-side guarantee is structural rather than a test: every
 * `details` map in server/cmd/server/notification_listeners.go is typed
 * `map[string]string`, so a non-string value is a compile error there.
 *
 * Why both halves exist: during MUL-5483 a new inbox type was added and the
 * mobile label map was updated so `tsc` passed — but a NUMBER went into
 * `details.child_count`, and `details` is `z.record(z.string(), z.string())`.
 * Because the endpoint parses an ARRAY, one bad row fails the whole parse and
 * `listInbox` falls back to `EMPTY_INBOX_LIST`: the entire mobile inbox
 * renders empty, not just that row. The blast radius is what these tests
 * document; the compile-time type is what prevents it.
 */
describe("inbox list schema", () => {
  it("parses a row shaped like the documented server payload", () => {
    const serverRow = {
      id: "inbox-1",
      workspace_id: "ws-1",
      recipient_type: "member",
      recipient_id: "user-1",
      type: "status_changed",
      severity: "info",
      issue_id: "issue-1",
      title: "P0: delegated subscription rule",
      body: "",
      actor_type: "agent",
      actor_id: "agent-1",
      read: false,
      archived: false,
      created_at: "2026-07-30T00:00:00Z",
      // The ordinary shape: all strings, as most notification types send.
      details: { from: "in_progress", to: "in_review" },
    };

    const parsed = InboxListSchema.safeParse([serverRow]);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data[0]?.type).toBe("status_changed");
    expect(parsed.success && parsed.data[0]?.details?.to).toBe("in_review");
  });

  it("accepts a numeric details value, coerced to its string form", () => {
    // This test used to assert the opposite ("rejects a numeric details
    // value"), on the assumption that `details` is a string map. The live
    // server disproved it in iteration 238: an `autopilot_paused` row carries
    // `{fail_pct: 90.6, total_runs: 235, …}`. Rejecting the row emptied the
    // whole page (see the test below), which is how the archive rendered as
    // "no archived notifications" over 910 of them. Numbers are coerced rather
    // than dropped so a consumer still reads a value.
    const row = {
      id: "inbox-2",
      recipient_type: "member",
      type: "status_changed",
      details: { child_count: 3 },
    };

    const parsed = InboxListSchema.safeParse([row]);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data[0]?.details?.child_count).toBe("3");
  });

  it("keeps one odd row from emptying the entire list", () => {
    // The blast radius that makes this a P1 rather than a cosmetic bug: the
    // schema is an array, so a single rejected row invalidates every good one
    // and `parseWithFallback` returns the empty list for the whole page. The
    // fix is to make the row parseable, so this asserts the blast radius is
    // gone rather than documenting it as expected behaviour.
    const good = {
      id: "inbox-3",
      recipient_type: "member",
      type: "status_changed",
      details: { from: "todo", to: "in_review" },
    };
    const odd = {
      id: "inbox-4",
      recipient_type: "member",
      type: "status_changed",
      details: { child_count: 3 },
    };

    expect(InboxListSchema.safeParse([good]).success).toBe(true);
    const parsed = InboxListSchema.safeParse([good, odd]);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toHaveLength(2);
    // The good row's own details are untouched by its neighbour.
    expect(parsed.success && parsed.data[0]?.details?.to).toBe("in_review");
  });

  it("renders an unknown server type instead of dropping the row", () => {
    // Mirrors the root CLAUDE.md API-compatibility rule and mobile's own
    // "render every inbox type, never silently drop a category" parity rule: a
    // type this build has never heard of must still parse.
    const future = {
      id: "inbox-5",
      recipient_type: "member",
      type: "some_future_type",
      details: { anything: "still a string" },
    };

    const parsed = InboxListSchema.safeParse([future]);
    expect(parsed.success).toBe(true);
  });
});
