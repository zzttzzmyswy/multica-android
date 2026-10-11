/**
 * Unit tests for the thread-resolution derivation (`lib/thread-resolution.ts`)
 * — the pure half of web's `packages/views/issues/components/thread-utils.ts`
 * (`deriveThreadResolution`) plus the reply fold around the resolution.
 *
 * Two writes share `resolved_at`: "Resolve thread" sets it on the ROOT (the
 * whole thread folds), "Resolve thread with comment" sets it on a REPLY (that
 * reply is the resolution, the others fold around it). The derivation must be
 * total — a thread with several resolved rows still renders exactly one
 * resolution, and the root always wins.
 */
import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "@multica/core/types";
import {
  deriveThreadResolution,
  foldThreadReplies,
  resolvedThreadRootIds,
  rootCommentIds,
} from "./thread-resolution";

function entry(
  id: string,
  partial: Partial<TimelineEntry> = {},
): TimelineEntry {
  return {
    type: "comment",
    id,
    actor_type: "member",
    actor_id: "u1",
    created_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

/** An activity row (not a comment) — `rootCommentIds` must skip these.
 *  Activity entries carry no actor, so one is supplied to satisfy the type
 *  even though every assertion that reads them ignores actors. */
function activity(
  id: string,
  partial: Partial<TimelineEntry> = {},
): TimelineEntry {
  return {
    type: "activity",
    id,
    actor_type: "member",
    actor_id: "u1",
    created_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

describe("deriveThreadResolution", () => {
  it("returns none when nothing in the thread is resolved", () => {
    const root = entry("root");
    expect(deriveThreadResolution(root, [entry("r1"), entry("r2")])).toEqual({
      kind: "none",
    });
  });

  it("returns root when the root itself carries resolved_at", () => {
    const root = entry("root", { resolved_at: "2026-01-02T00:00:00Z" });
    expect(deriveThreadResolution(root, [entry("r1")])).toEqual({
      kind: "root",
    });
  });

  it("prefers the root when a reply is ALSO resolved", () => {
    // Older / concurrent writes can leave more than one resolved row; the
    // root must win so the UI never renders two resolutions.
    const root = entry("root", { resolved_at: "2026-01-02T00:00:00Z" });
    const replies = [entry("r1", { resolved_at: "2026-01-03T00:00:00Z" })];
    expect(deriveThreadResolution(root, replies)).toEqual({ kind: "root" });
  });

  it("returns the resolved reply when the root is unresolved", () => {
    const root = entry("root");
    const replies = [entry("r1"), entry("r2", { resolved_at: "2026-01-03T00:00:00Z" })];
    expect(deriveThreadResolution(root, replies)).toEqual({
      kind: "reply",
      resolutionId: "r2",
    });
  });

  it("picks the LATEST resolved_at when several replies are resolved", () => {
    const root = entry("root");
    const replies = [
      entry("r1", { resolved_at: "2026-01-05T00:00:00Z" }),
      entry("r2", { resolved_at: "2026-01-09T00:00:00Z" }),
      entry("r3", { resolved_at: "2026-01-02T00:00:00Z" }),
    ];
    expect(deriveThreadResolution(root, replies)).toEqual({
      kind: "reply",
      resolutionId: "r2",
    });
  });

  it("ignores resolved_at: null / undefined rows", () => {
    const root = entry("root", { resolved_at: null });
    const replies = [entry("r1", { resolved_at: null }), entry("r2")];
    expect(deriveThreadResolution(root, replies)).toEqual({ kind: "none" });
  });

  it("treats an empty thread with a resolved root as root-resolution", () => {
    const root = entry("root", { resolved_at: "2026-01-02T00:00:00Z" });
    expect(deriveThreadResolution(root, [])).toEqual({ kind: "root" });
  });
});

describe("foldThreadReplies", () => {
  it("keeps every reply when there is no reply-resolution", () => {
    const replies = [entry("r1"), entry("r2")];
    expect(foldThreadReplies(replies, { kind: "none" })).toEqual(replies);
    expect(foldThreadReplies(replies, { kind: "root" })).toEqual(replies);
  });

  it("hides exactly the resolution reply, preserving order", () => {
    const replies = [entry("r1"), entry("r2"), entry("r3")];
    const folded = foldThreadReplies(replies, {
      kind: "reply",
      resolutionId: "r2",
    });
    expect(folded.map((r) => r.id)).toEqual(["r1", "r3"]);
  });

  it("keeps nested replies of the resolution in the fold", () => {
    // Mobile renders the thread flat, so a nested reply is just another row
    // — only the resolved row itself is pinned out of the fold.
    const replies = [
      entry("r1"),
      entry("r2", { resolved_at: "2026-01-03T00:00:00Z", parent_id: "root" }),
      entry("r2-child", { parent_id: "r2" }),
    ];
    const folded = foldThreadReplies(replies, {
      kind: "reply",
      resolutionId: "r2",
    });
    expect(folded.map((r) => r.id)).toEqual(["r1", "r2-child"]);
  });

  it("returns an empty fold when the only reply is the resolution", () => {
    const replies = [entry("r1", { resolved_at: "2026-01-03T00:00:00Z" })];
    expect(
      foldThreadReplies(replies, { kind: "reply", resolutionId: "r1" }),
    ).toEqual([]);
  });
});

// ── Iteration 228: the thread-root collections ────────────────────────────
// Ports of web's `rootCommentIds` / `resolvedThreadRootIds`
// (`packages/views/issues/components/thread-utils.ts`). Both feed the search
// panel's fold/unfold-all-comments rows: `rootCommentIds` is the fold set,
// `resolvedThreadRootIds` the expand set. Getting either wrong changes which
// comments the commands act on, which no screen-level test would catch.
describe("rootCommentIds", () => {
  it("returns top-level comments only, in timeline order", () => {
    const entries = [
      entry("root-1"),
      entry("reply-1", { parent_id: "root-1" }),
      entry("root-2"),
      entry("nested", { parent_id: "reply-1" }),
    ];
    expect(rootCommentIds(entries)).toEqual(["root-1", "root-2"]);
  });

  it("ignores activity rows", () => {
    const entries = [
      activity("a1"),
      entry("root-1"),
      activity("a2"),
    ];
    expect(rootCommentIds(entries)).toEqual(["root-1"]);
  });

  it("returns nothing for an empty timeline", () => {
    expect(rootCommentIds([])).toEqual([]);
  });
});

describe("resolvedThreadRootIds", () => {
  it("includes a root resolved on itself", () => {
    const entries = [
      entry("root-1", { resolved_at: "2026-01-02T00:00:00Z" }),
      entry("root-2"),
    ];
    expect(resolvedThreadRootIds(entries)).toEqual(["root-1"]);
  });

  it("includes a root whose REPLY carries the resolution", () => {
    // "Resolve thread with comment" writes resolved_at on a reply; the thread
    // is still resolved and must expand on unfold-all.
    const entries = [
      entry("root-1"),
      entry("reply-1", { parent_id: "root-1", resolved_at: "2026-01-02T00:00:00Z" }),
    ];
    expect(resolvedThreadRootIds(entries)).toEqual(["root-1"]);
  });

  it("finds a resolution nested below another reply", () => {
    const entries = [
      entry("root-1"),
      entry("reply-1", { parent_id: "root-1" }),
      entry("reply-2", { parent_id: "reply-1", resolved_at: "2026-01-02T00:00:00Z" }),
    ];
    expect(resolvedThreadRootIds(entries)).toEqual(["root-1"]);
  });

  it("excludes unresolved roots", () => {
    // Seeding an unresolved root into the expand set would keep it expanded
    // through a later resolve (web's own note).
    const entries = [
      entry("root-1"),
      entry("reply-1", { parent_id: "root-1" }),
      entry("root-2", { resolved_at: "2026-01-02T00:00:00Z" }),
    ];
    expect(resolvedThreadRootIds(entries)).toEqual(["root-2"]);
  });

  it("never treats a reply as a root, even a resolved one", () => {
    // An orphan reply (its parent not in the loaded timeline) is promoted to
    // top-level by the renderer, but the store's units are threads — a reply
    // id seeded there would fold nothing.
    const entries = [
      entry("orphan", { parent_id: "missing", resolved_at: "2026-01-02T00:00:00Z" }),
    ];
    expect(resolvedThreadRootIds(entries)).toEqual([]);
  });

  it("ignores activity rows even when they carry a resolved_at", () => {
    const entries = [
      activity("a1", { resolved_at: "2026-01-02T00:00:00Z" } as Partial<TimelineEntry>),
      entry("root-1"),
    ];
    expect(resolvedThreadRootIds(entries)).toEqual([]);
  });
});
