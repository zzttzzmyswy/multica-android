/**
 * Pure optimistic-patch helpers for the iteration-72 inbox mutations.
 *
 * Same contract as data/mutations/issue-views.test.ts: the three-step
 * snapshot → patch → settle-invalidate flow is covered at the pure-function
 * level here; the hooks only wire these to the query cache, which the Node
 * vitest lane has no renderer for.
 *
 * Patches mirror web (packages/core/inbox/mutations.ts):
 *   - unarchive flips `archived:false` on the target AND its issue siblings —
 *     the server unarchives the whole issue group, and the archiving row's
 *     dedup helper (lib/inbox-display.ts) drops it from the view immediately.
 *   - mark-unread flips `read:false` on the single row (a row is never
 *     present in both caches: the server's two endpoints are mutually
 *     exclusive by issue).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/data/api", () => ({ api: {} }));
vi.mock("@/data/workspace-store", () => ({
  useWorkspaceStore: () => ({ currentWorkspaceId: "ws-1" }),
}));

import type { InboxItem } from "@multica/core/types";
import {
  archiveInboxPatch,
  markInboxUnreadPatch,
  unarchiveInboxPatch,
} from "./inbox";

function item(overrides: Partial<InboxItem>): InboxItem {
  return {
    id: "inbox-1",
    workspace_id: "ws-1",
    recipient_type: "member",
    recipient_id: "member-1",
    actor_type: "agent",
    actor_id: "agent-1",
    type: "new_comment",
    severity: "info",
    issue_id: "issue-1",
    title: "Issue title",
    body: null,
    issue_status: null,
    read: false,
    archived: false,
    created_at: "2026-06-15T08:00:00Z",
    details: null,
    ...overrides,
  };
}

describe("markInboxUnreadPatch", () => {
  it("flips read:false on the target row only", () => {
    const list = [item({ id: "a", read: true }), item({ id: "b", read: true })];
    const out = markInboxUnreadPatch(list, "a");

    expect(out?.[0]?.read).toBe(false);
    expect(out?.[1]?.read).toBe(true);
  });

  it("returns undefined for a cache miss (caller keeps old state)", () => {
    expect(markInboxUnreadPatch(undefined, "a")).toBeUndefined();
  });

  it("leaves unrelated rows untouched (same issue too)", () => {
    const list = [
      item({ id: "a", read: true }),
      item({ id: "a-sibling", issue_id: "issue-1", read: true }), // same issue
    ];
    const out = markInboxUnreadPatch(list, "a");

    expect(out?.[1]?.read).toBe(true);
  });
});

describe("unarchiveInboxPatch", () => {
  it("flips archived:false on the row and its issue siblings", () => {
    const list = [
      item({ id: "a", archived: true }),
      item({ id: "a-sibling", issue_id: "issue-1", archived: true }),
      item({ id: "z", issue_id: "issue-9", archived: true }),
    ];
    const out = unarchiveInboxPatch(list, "a");

    expect(out?.[0]?.archived).toBe(false);
    expect(out?.[1]?.archived).toBe(false);
    expect(out?.[2]?.archived).toBe(true);
  });

  it("preserves the read state verbatim on restore", () => {
    const out = unarchiveInboxPatch(
      [item({ id: "a", archived: true, read: true })],
      "a",
    );
    expect(out?.[0]).toMatchObject({ archived: false, read: true });
  });

  it("returns undefined for a cache miss", () => {
    expect(unarchiveInboxPatch(undefined, "a")).toBeUndefined();
  });
});

describe("archiveInboxPatch", () => {
  it("flips archived:true on the target and its issue siblings", () => {
    const list = [
      item({ id: "a", issue_id: "issue-1" }),
      item({ id: "b", issue_id: "issue-1" }),
      item({ id: "c", issue_id: "issue-2" }),
    ];
    const out = archiveInboxPatch(list, "a");

    expect(out?.[0]?.archived).toBe(true);
    expect(out?.[1]?.archived).toBe(true);
    expect(out?.[2]?.archived).toBe(false);
  });

  it("preserves the read state verbatim on archive", () => {
    const out = archiveInboxPatch(
      [item({ id: "a", read: true })],
      "a",
    );
    expect(out?.[0]).toMatchObject({ archived: true, read: true });
  });

  it("returns undefined for a cache miss", () => {
    expect(archiveInboxPatch(undefined, "a")).toBeUndefined();
  });
});