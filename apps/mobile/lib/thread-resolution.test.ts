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
import { deriveThreadResolution, foldThreadReplies } from "./thread-resolution";

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
