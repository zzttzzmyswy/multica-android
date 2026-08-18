/**
 * Inbox query-key + options tests for the iteration-72 archived sub-view.
 * Mirrors web's `archivedInboxListOptions` (packages/core/inbox/queries.ts):
 * a distinct cache entry (`["inbox", wsId, "archived"]`) so the archive can
 * be prefetched for the footer count without polluting the main list, and the
 * server — not the client — decides which issues belong in which list.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { QueryFunctionContext } from "@tanstack/react-query";

const { mockListArchivedInbox } = vi.hoisted(() => ({
  mockListArchivedInbox: vi.fn(),
}));

vi.mock("@/data/api", () => ({
  api: { listArchivedInbox: mockListArchivedInbox },
}));

import { archivedInboxListOptions, inboxKeys } from "./inbox";

const ROW = {
  id: "arch-1",
  workspace_id: "ws-1",
  recipient_type: "member",
  recipient_id: "member-1",
  actor_type: "agent",
  actor_id: "agent-1",
  type: "status_changed",
  severity: "info",
  issue_id: "issue-1",
  title: "Archived notification",
  body: "",
  issue_status: "done",
  read: true,
  archived: true,
  created_at: "2026-08-01T00:00:00Z",
  details: { from: "in_progress", to: "done" },
} as const;

describe("inboxKeys.archived", () => {
  it("is a sibling entry of the main list key under the wsId root", () => {
    expect(inboxKeys.archived("ws-1")).toEqual(["inbox", "ws-1", "archived"]);
    expect(inboxKeys.archived("ws-1")).not.toEqual(inboxKeys.list("ws-1"));
    expect(inboxKeys.all("ws-1")).toEqual(["inbox", "ws-1"]);
  });

  it("scopes by workspace (switching workspaces refetches)", () => {
    expect(inboxKeys.archived("ws-1")).not.toEqual(inboxKeys.archived("ws-2"));
  });
});

describe("archivedInboxListOptions", () => {
  beforeEach(() => {
    mockListArchivedInbox.mockReset();
  });

  it("queries the archived key and is disabled without a workspace", () => {
    const opts = archivedInboxListOptions("ws-1");
    expect(opts.queryKey).toEqual(inboxKeys.archived("ws-1"));
    expect(opts.enabled).toBe(true);

    expect(archivedInboxListOptions(null).enabled).toBe(false);
  });

  it("resolves through api.listArchivedInbox", async () => {
    const signal = new AbortController().signal;
    mockListArchivedInbox.mockResolvedValue([ROW]);
    const options = archivedInboxListOptions("ws-1");

    const ctx: QueryFunctionContext<
      readonly ["inbox", string | null, "archived"]
    > = {
      client: new QueryClient(),
      queryKey: ["inbox", "ws-1", "archived"],
      signal,
      meta: undefined,
    };
    const data = await options.queryFn?.(ctx);

    expect(mockListArchivedInbox).toHaveBeenCalledWith({ signal });
    expect(data).toEqual([ROW]);
  });
});