import { describe, expect, it } from "vitest";
import type { InboxWorkspaceUnread } from "@multica/core/types";
import { workspaceUnreadBadge } from "./workspace-unread-badge";

const rows = (...entries: [string, number][]): InboxWorkspaceUnread[] =>
  entries.map(([workspace_id, count]) => ({ workspace_id, count }));

describe("workspaceUnreadBadge", () => {
  it("marks the other workspace holding unread items", () => {
    const badge = workspaceUnreadBadge(rows(["ws-a", 0], ["ws-b", 3]), "ws-a");
    expect(badge.unreadIds.has("ws-b")).toBe(true);
    expect(badge.showAggregateDot).toBe(true);
  });

  it("never marks the active workspace — its unread is the Inbox tab count", () => {
    const badge = workspaceUnreadBadge(rows(["ws-a", 5]), "ws-a");
    expect(badge.unreadIds.has("ws-a")).toBe(false);
    expect(badge.unreadIds.size).toBe(0);
    expect(badge.showAggregateDot).toBe(false);
  });

  it("drops zero-count workspaces from both signals", () => {
    const badge = workspaceUnreadBadge(rows(["ws-a", 0], ["ws-b", 0]), "ws-a");
    expect(badge.unreadIds.size).toBe(0);
    expect(badge.showAggregateDot).toBe(false);
  });

  it("shows nothing for an empty summary", () => {
    const badge = workspaceUnreadBadge([], "ws-a");
    expect(badge.unreadIds.size).toBe(0);
    expect(badge.showAggregateDot).toBe(false);
  });

  // The switcher sheet renders before the workspaces list resolves, so the
  // active id can still be null. Treating that as "no active workspace" would
  // dot the workspace the user is standing in — the duplicate signal the
  // active-workspace exclusion exists to prevent. Both signals stay off.
  it("shows nothing while the active workspace is unresolved", () => {
    const badge = workspaceUnreadBadge(rows(["ws-a", 5]), null);
    expect(badge.unreadIds.size).toBe(0);
    expect(badge.showAggregateDot).toBe(false);
  });

  it("marks every unread workspace when the summary has several", () => {
    const badge = workspaceUnreadBadge(
      rows(["ws-a", 1], ["ws-b", 2], ["ws-c", 0], ["ws-d", 9]),
      "ws-a",
    );
    expect([...badge.unreadIds].sort()).toEqual(["ws-b", "ws-d"]);
    expect(badge.showAggregateDot).toBe(true);
  });
});
