/**
 * Regression: the inbox `details` map is not a string map, and requiring it to
 * be one silently emptied the archive.
 *
 * Found on the live server during iteration 238 (v0.6.72), while verifying the
 * new paged archive on the Pixel 5 — the screen rendered
 * 「无法加载已归档通知：Invalid archived inbox page response」 over an archive
 * of 910 rows. The row below is copied verbatim from
 * `GET /api/inbox/archived/page?limit=50` against mu.zztweb.top: an
 * `autopilot_paused` notification whose `details` mixes four numbers in with
 * its strings.
 *
 * Why it emptied the whole list rather than dropping one row: `details` was
 * `z.record(z.string(), z.string())`, so the row failed to parse; the row
 * belongs to an array schema, and a Zod array parse fails as a unit — so
 * `parseWithFallback` returned the EMPTY list for the whole page. One autopilot
 * notification was enough to make ~50 archived notifications look like none.
 *
 * The fix coerces scalars to their string form and drops structural values
 * (see `InboxDetailsSchema`). These fixtures are the real payloads, kept
 * verbatim so a future tightening of the schema has to argue with the server's
 * actual bytes rather than with a hand-written example.
 */
import { describe, expect, it } from "vitest";
import { InboxListSchema } from "./schemas";

/** Verbatim from the live page-1 response (see the module doc). */
const AUTOPILOT_PAUSED_ROW = {
  id: "01a0ec21-230f-751f-bf94-057353fb8d55",
  workspace_id: "22905062-4e0d-4733-84af-828768dcb9c1",
  recipient_type: "member",
  recipient_id: "674cb686-c2c6-404b-8fb5-34dc35aa38ee",
  type: "autopilot_paused",
  severity: "attention",
  issue_id: null,
  title: "Autopilot paused: BM1684X OpenHarmony 迭代（每小时）",
  body: "Auto-paused after 213 of 235 runs failed (90.6%) in the last 7 days.",
  read: true,
  archived: true,
  created_at: "2026-09-29T15:46:29+08:00",
  issue_status: null,
  issue_priority: null,
  actor_type: "system",
  actor_id: null,
  details: {
    reason: "auto_paused_high_failure_rate",
    fail_pct: 90.6,
    total_runs: 235,
    failed_runs: 213,
    autopilot_id: "731e0601-8e3c-411c-9ddb-7b1d02df992f",
    autopilot_title: "BM1684X OpenHarmony 迭代（每小时）",
    lookback_seconds: 604800,
    threshold_min_runs: 50,
    threshold_fail_ratio: 0.9,
  },
} as const;

/** Verbatim shape of an ordinary comment-anchored archived row. */
const COMMENT_ROW = {
  id: "01a13324-8df9-7efc-a6ca-77a9615f6618",
  workspace_id: "22905062-4e0d-4733-84af-828768dcb9c1",
  recipient_type: "member",
  recipient_id: "674cb686-c2c6-404b-8fb5-34dc35aa38ee",
  type: "mentioned",
  severity: "info",
  issue_id: "01a132fd-1487-7cf0-abd1-7065b74fcb1e",
  title: "NanoPi R3S 健康巡检 2026-10-13",
  body: null,
  read: true,
  archived: true,
  created_at: "2026-10-13T10:43:16+08:00",
  issue_status: "in_review",
  issue_priority: "none",
  actor_type: "agent",
  actor_id: "5e489b58-8073-485d-a8b5-409f4a3f24fd",
  details: { comment_id: "01a13324-8df3-766a-af9c-bfa6f7281300" },
} as const;

describe("inbox list schema against real server payloads", () => {
  it("parses a row whose details carry numbers", () => {
    const result = InboxListSchema.safeParse([AUTOPILOT_PAUSED_ROW]);
    expect(result.success).toBe(true);
  });

  it("keeps the numeric details as their string form", () => {
    // Coerced, not dropped: a consumer reading the map gets a value rather
    // than a hole where the number was.
    const parsed = InboxListSchema.parse([AUTOPILOT_PAUSED_ROW]);
    expect(parsed[0]?.details?.fail_pct).toBe("90.6");
    expect(parsed[0]?.details?.total_runs).toBe("235");
    expect(parsed[0]?.details?.reason).toBe("auto_paused_high_failure_rate");
  });

  it("keeps comment_id byte-identical", () => {
    // The one key with behaviour attached (tap-through to a comment) is a uuid
    // string on the wire and must survive untouched.
    const parsed = InboxListSchema.parse([COMMENT_ROW]);
    expect(parsed[0]?.details?.comment_id).toBe(
      "01a13324-8df3-766a-af9c-bfa6f7281300",
    );
  });

  it("does NOT let one odd row empty the whole list", () => {
    // The failure mode exactly: an array parse fails as a unit, so a strict
    // `details` turned one autopilot notification into "no archived
    // notifications" for the entire page.
    const parsed = InboxListSchema.parse([
      COMMENT_ROW,
      AUTOPILOT_PAUSED_ROW,
      COMMENT_ROW,
    ]);
    expect(parsed).toHaveLength(3);
  });

  it("drops a structural detail value without failing the row", () => {
    // No consumer reads a nested object out of this flat map, and letting one
    // reject the row is how the list empties.
    const parsed = InboxListSchema.parse([
      {
        ...COMMENT_ROW,
        id: "nested",
        details: { comment_id: "c1", nested: { deep: true }, list: [1, 2] },
      },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.details).toEqual({ comment_id: "c1" });
  });

  it("accepts a null details map", () => {
    const parsed = InboxListSchema.parse([{ ...COMMENT_ROW, details: null }]);
    expect(parsed[0]?.details).toBeNull();
  });

  it("still rejects an item missing a required field", () => {
    // Leniency is scoped to `details`; the rest of the row contract stands.
    const { id: _id, ...withoutId } = COMMENT_ROW;
    expect(InboxListSchema.safeParse([withoutId]).success).toBe(false);
  });

  it("defaults details to null when the key is absent", () => {
    const { details: _details, ...withoutDetails } = COMMENT_ROW;
    const parsed = InboxListSchema.parse([withoutDetails]);
    expect(parsed[0]?.details).toBeNull();
  });
});
