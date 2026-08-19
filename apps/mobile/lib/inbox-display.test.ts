import { describe, expect, it } from "vitest";
import type { InboxItem } from "@multica/core/types";
import {
  deduplicateArchivedInboxItems,
  deduplicateInboxItems,
  getInboxArchiveMode,
  getQuickCreateEditSeed,
  groupInboxItemsByIssue,
  isQuickCreateOutcome,
} from "./inbox-display";

function item(overrides: Partial<InboxItem>): InboxItem {
  return {
    id: "inbox-1",
    workspace_id: "workspace-1",
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

describe("deduplicateInboxItems", () => {
  it("keeps the newest issue row while preserving an older comment anchor", () => {
    const merged = deduplicateInboxItems([
      item({
        id: "comment-notification",
        created_at: "2026-06-15T08:00:00Z",
        details: { comment_id: "comment-1" },
      }),
      item({
        id: "status-notification",
        type: "status_changed",
        created_at: "2026-06-15T08:01:00Z",
        details: { from: "in_progress", to: "in_review" },
      }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: "status-notification",
      type: "status_changed",
      details: {
        from: "in_progress",
        to: "in_review",
        comment_id: "comment-1",
      },
    });
  });
});

describe("groupInboxItemsByIssue", () => {
  it("groups by issue_id and keeps the newest row per issue", () => {
    const merged = groupInboxItemsByIssue([
      item({
        id: "older-comment",
        issue_id: "issue-1",
        created_at: "2026-06-15T08:00:00Z",
      }),
      item({
        id: "newer-status",
        issue_id: "issue-1",
        type: "status_changed",
        created_at: "2026-06-15T09:00:00Z",
      }),
      item({ id: "other-issue", issue_id: "issue-2", created_at: "2026-06-15T10:00:00Z" }),
    ]);

    expect(merged.map((m) => m.id)).toEqual(["other-issue", "newer-status"]);
  });

  it("falls back to the item id when issue_id is absent", () => {
    const merged = groupInboxItemsByIssue([
      item({ id: "no-issue", issue_id: null }),
      item({ id: "with-issue", issue_id: "issue-9" }),
    ]);

    expect(merged.map((m) => m.id).sort()).toEqual(["no-issue", "with-issue"]);
  });

  it("never mutates the input array", () => {
    const input = [item({ id: "a" }), item({ id: "b" })];
    const copy = [...input];
    groupInboxItemsByIssue(input);
    expect(input).toEqual(copy);
  });
});

describe("deduplicateArchivedInboxItems", () => {
  it("keeps archived rows grouped by issue, dropping active ones", () => {
    const merged = deduplicateArchivedInboxItems([
      item({
        id: "arch-1",
        archived: true,
        created_at: "2026-06-15T08:00:00Z",
      }),
      item({
        id: "arch-2",
        archived: true,
        type: "status_changed",
        created_at: "2026-06-15T09:00:00Z",
      }),
      item({ id: "active-row", archived: false }),
    ]);

    expect(merged.map((m) => m.id)).toEqual(["arch-2"]);
  });

  it("preserves the newest comment_id anchor like the main list", () => {
    const merged = deduplicateArchivedInboxItems([
      item({
        id: "comment-notification",
        archived: true,
        created_at: "2026-06-15T08:00:00Z",
        details: { comment_id: "comment-1" },
      }),
      item({
        id: "status-notification",
        archived: true,
        type: "status_changed",
        created_at: "2026-06-15T08:01:00Z",
        details: { from: "in_progress", to: "in_review" },
      }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: "status-notification",
      details: {
        from: "in_progress",
        to: "in_review",
        comment_id: "comment-1",
      },
    });
  });

  it("keeps archived and active lists mutually exclusive", () => {
    const rows = [item({ id: "a", archived: true }), item({ id: "b" })];
    const main = deduplicateInboxItems(rows).map((m) => m.id);
    const arch = deduplicateArchivedInboxItems(rows).map((m) => m.id);

    expect(main).toEqual(["b"]);
    expect(arch).toEqual(["a"]);
  });
});

describe("isQuickCreateOutcome", () => {
  it("treats failed + unconfirmed as recoverable quick-create outcomes", () => {
    expect(isQuickCreateOutcome("quick_create_failed")).toBe(true);
    expect(isQuickCreateOutcome("quick_create_unconfirmed")).toBe(true);
  });

  it("does not treat success or unrelated types as outcomes", () => {
    expect(isQuickCreateOutcome("quick_create_done")).toBe(false);
    expect(isQuickCreateOutcome("new_comment")).toBe(false);
    expect(isQuickCreateOutcome("agent_blocked")).toBe(false);
  });
});

describe("getQuickCreateEditSeed", () => {
  it("returns prompt + agent when a failed outcome carries both", () => {
    const seed = getQuickCreateEditSeed(
      item({
        id: "qc-failed",
        type: "quick_create_failed",
        issue_id: null,
        details: {
          original_prompt: "  build a login page  ",
          agent_id: "agent-9",
        },
      }),
    );
    expect(seed).toEqual({
      description: "build a login page",
      agentId: "agent-9",
    });
  });

  it("omits agentId when the outcome has no agent hint", () => {
    const seed = getQuickCreateEditSeed(
      item({
        id: "qc-unconfirmed",
        type: "quick_create_unconfirmed",
        issue_id: null,
        details: { original_prompt: "ship the settings screen" },
      }),
    );
    expect(seed).toEqual({ description: "ship the settings screen" });
  });

  it("returns null when there is no prompt to recover", () => {
    expect(
      getQuickCreateEditSeed(
        item({
          id: "no-prompt",
          type: "quick_create_failed",
          issue_id: null,
          details: {},
        }),
      ),
    ).toBeNull();
  });

  it("returns null for non-quick-create notifications", () => {
    expect(getQuickCreateEditSeed(item({ type: "new_comment" }))).toBeNull();
  });
});

describe("getInboxArchiveMode", () => {
  it("reverses with the view the item is read in", () => {
    expect(getInboxArchiveMode("inbox")).toBe("archive");
    expect(getInboxArchiveMode("archived")).toBe("unarchive");
  });
});
