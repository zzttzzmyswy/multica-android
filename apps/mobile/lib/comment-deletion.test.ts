/**
 * Iteration 210 — comment deletion semantics (#8296).
 *
 * A server that declares `comment_delete_keep_replies_supported` keeps a
 * deleted comment's replies: the row stays as an empty tombstone so every
 * reply keeps its direct parent. Older servers delete the replies with the
 * comment. The deployment the mobile client talks to declares the capability
 * (`https://muapi.zztweb.top/api/config`), so the old "replies went too"
 * reading was a promise the screen could not keep.
 *
 * These tests pin the decision surface. The wiring tests next door
 * (`comment-deletion-wiring.test.ts`) pin that the screens actually consult
 * it — this lane has no renderer, so a pure helper can be perfect while the
 * card still hides replies.
 */
import { describe, expect, it } from "vitest";
import type { AppConfigResponse } from "@multica/core/api/schemas";
import type { TimelineEntry } from "@multica/core/types";
import {
  applyCommentDeletion,
  commentDeleteKeepsReplies,
  isDeletedComment,
  removeCommentSubtree,
} from "./comment-deletion";

/** A full config with the capability bit overridable, so the test says which
 *  config shape it means rather than relying on a partial literal. */
function config(
  keepReplies?: unknown,
): AppConfigResponse {
  return {
    cdn_domain: "",
    allow_signup: true,
    ...(keepReplies === undefined
      ? {}
      : { comment_delete_keep_replies_supported: keepReplies as boolean }),
  };
}

/** The helpers pass an absent cache through unchanged (TanStack's
 *  `setQueryData` updater may see `undefined`), so call sites and tests narrow
 *  it back. */
function defined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected a timeline, got undefined");
  return value;
}

function comment(partial: {
  id: string;
  created_at: string;
  parent_id?: string | null;
  content?: string;
  deleted_at?: string | null;
}): TimelineEntry {
  return {
    type: "comment",
    id: partial.id,
    actor_type: "member",
    actor_id: "u1",
    content: partial.content ?? `c-${partial.id}`,
    created_at: partial.created_at,
    updated_at: partial.created_at,
    parent_id: partial.parent_id ?? null,
    ...(partial.deleted_at !== undefined
      ? { deleted_at: partial.deleted_at }
      : {}),
  };
}

function activity(id: string, created_at: string): TimelineEntry {
  return {
    type: "activity",
    id,
    actor_type: "member",
    actor_id: "u1",
    action: "status_changed",
    created_at,
  };
}

describe("commentDeleteKeepsReplies fails closed", () => {
  it("is true only for an explicit true", () => {
    expect(commentDeleteKeepsReplies(config(true))).toBe(true);
  });

  it("is false when the field is absent (older server)", () => {
    expect(commentDeleteKeepsReplies(config())).toBe(false);
  });

  it("is false when the config has not loaded", () => {
    expect(commentDeleteKeepsReplies(undefined)).toBe(false);
  });

  it("is false for a falsy or malformed value", () => {
    expect(commentDeleteKeepsReplies(config(false))).toBe(false);
    expect(commentDeleteKeepsReplies(config("true"))).toBe(false);
  });
});

describe("isDeletedComment", () => {
  it("recognises a tombstone by its deleted_at marker", () => {
    expect(isDeletedComment({ deleted_at: "2026-10-08T00:00:00Z" })).toBe(true);
  });

  it("treats a live comment as live, whatever the field's shape", () => {
    expect(isDeletedComment({ deleted_at: null })).toBe(false);
    expect(isDeletedComment({ deleted_at: "" })).toBe(false);
    expect(isDeletedComment({})).toBe(false);
  });
});

describe("applyCommentDeletion keeps replies", () => {
  const timeline = [
    comment({ id: "A", created_at: "2026-10-08T00:00:00Z" }),
    comment({ id: "B", created_at: "2026-10-08T00:01:00Z", parent_id: "A" }),
    comment({ id: "C", created_at: "2026-10-08T00:02:00Z", parent_id: "A" }),
    comment({ id: "D", created_at: "2026-10-08T00:03:00Z", parent_id: "B" }),
  ];

  it("tombstones the target in place instead of removing it", () => {
    const next = applyCommentDeletion(timeline, "A", "2026-10-08T01:00:00Z");
    expect(next).toHaveLength(4);
    const root = defined(next).find((e) => e.id === "A")!;
    expect(root.deleted_at).toBe("2026-10-08T01:00:00Z");
  });

  it("keeps every descendant reply", () => {
    const next = applyCommentDeletion(timeline, "A", "2026-10-08T01:00:00Z");
    expect(defined(next).map((e) => e.id)).toEqual(["A", "B", "C", "D"]);
  });

  it("clears the body and thread resolution a tombstone cannot keep", () => {
    const withResolve = [
      {
        ...comment({ id: "A", created_at: "2026-10-08T00:00:00Z" }),
        resolved_at: "2026-10-08T00:30:00Z",
        resolved_by_type: "member" as const,
        resolved_by_id: "u1",
      },
      comment({ id: "B", created_at: "2026-10-08T00:01:00Z", parent_id: "A" }),
    ];
    const next = applyCommentDeletion(withResolve, "A", "2026-10-08T01:00:00Z");
    const root = defined(next).find((e) => e.id === "A")!;
    expect(root.content).toBe("");
    expect(root.resolved_at).toBeNull();
    expect(root.resolved_by_id).toBeNull();
  });

  it("leaves an unrelated timeline untouched", () => {
    const next = applyCommentDeletion(timeline, "missing", "2026-10-08T01:00:00Z");
    expect(next).toEqual(timeline);
  });

  it("passes through a null cache rather than inventing one", () => {
    expect(applyCommentDeletion(undefined, "A", "2026-10-08T01:00:00Z")).toBeUndefined();
  });

  it("keeps activity rows in order", () => {
    const mixed = [
      activity("act1", "2026-10-08T00:00:30Z"),
      ...timeline,
    ];
    const next = applyCommentDeletion(mixed, "A", "2026-10-08T01:00:00Z");
    expect(defined(next).map((e) => e.id)).toEqual(["act1", "A", "B", "C", "D"]);
  });
});

describe("removeCommentSubtree mirrors an older server", () => {
  const timeline = [
    comment({ id: "A", created_at: "2026-10-08T00:00:00Z" }),
    comment({ id: "B", created_at: "2026-10-08T00:01:00Z", parent_id: "A" }),
    comment({ id: "C", created_at: "2026-10-08T00:02:00Z", parent_id: "B" }),
    comment({ id: "Z", created_at: "2026-10-08T00:03:00Z" }),
  ];

  it("removes the comment and the whole reply chain", () => {
    const next = removeCommentSubtree(timeline, "A");
    expect(defined(next).map((e) => e.id)).toEqual(["Z"]);
  });

  it("removes a mid-chain comment with its own descendants", () => {
    const next = removeCommentSubtree(timeline, "B");
    expect(defined(next).map((e) => e.id)).toEqual(["A", "Z"]);
  });

  it("never removes an unrelated comment that shares no parent link", () => {
    const next = removeCommentSubtree(timeline, "Z");
    expect(defined(next).map((e) => e.id)).toEqual(["A", "B", "C"]);
  });

  it("passes through a null cache", () => {
    expect(removeCommentSubtree(undefined, "A")).toBeUndefined();
  });
});
