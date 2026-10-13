/**
 * The inbox cache patchers' handling of the ARCHIVED list, which is now a
 * paged infinite query rather than a flat array.
 *
 * Both patchers used to write a single `setQueryData(inboxKeys.archived(wsId))`
 * and be done. That key no longer holds the archive's rows — the rows live
 * under `["inbox", wsId, "archived", "pages", <filters>]`, one entry per filter
 * selection the user has visited. A patcher that kept writing only the old key
 * would update nothing on screen, and the failure is invisible in the common
 * case: the row is usually off-screen anyway, so "the status icon never
 * changed" reads as a rendering detail rather than a dropped event.
 *
 * `issue:updated` and `issue:deleted` are the two cross-cutting events that
 * change inbox state without firing an `inbox:*` event (see the module doc),
 * so they are the ones that regress silently.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { ArchivedInboxPage, InboxItem } from "@multica/core/types";
import {
  dropInboxItemsByIssue,
  patchInboxIssueStatus,
} from "./inbox-ws-updaters";
import { archivedInboxPagesOptions, inboxKeys } from "@/data/queries/inbox";
import { EMPTY_INBOX_FILTERS, type InboxFilters } from "@/lib/inbox-filters";

vi.mock("@/data/api", () => ({
  api: {
    listArchivedInboxPage: vi.fn(),
    getArchivedInboxFacets: vi.fn(),
    listArchivedInbox: vi.fn(),
    listInbox: vi.fn(),
  },
}));

function row(id: string, overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id,
    workspace_id: "ws-1",
    recipient_type: "member",
    recipient_id: "m1",
    actor_type: "agent",
    actor_id: "a1",
    type: "new_comment",
    severity: "info",
    issue_id: `issue-${id}`,
    title: "t",
    body: null,
    issue_status: "todo",
    issue_priority: "high",
    read: true,
    archived: true,
    created_at: "2026-08-01T00:00:00Z",
    details: null,
    ...overrides,
  };
}

function page(items: InboxItem[], nextCursor: string | null = null): ArchivedInboxPage {
  return { items, nextCursor, hasMore: nextCursor !== null };
}

function filters(overrides: Partial<InboxFilters> = {}): InboxFilters {
  return { ...EMPTY_INBOX_FILTERS, ...overrides };
}

/** Register a paged archive entry under one filter selection. */
function seedPages(qc: QueryClient, wsId: string, f: InboxFilters, data: ArchivedInboxPage[]) {
  const key = archivedInboxPagesOptions(wsId, f).queryKey;
  qc.setQueryData(key, { pages: data, pageParams: data.map(() => null) });
  return key;
}

function pageRows(qc: QueryClient, key: readonly unknown[]): InboxItem[] {
  const data = qc.getQueryData<{ pages: ArchivedInboxPage[] }>(key);
  return data?.pages.flatMap((p) => p.items) ?? [];
}

let qc: QueryClient;

beforeEach(() => {
  qc = new QueryClient();
});

describe("patchInboxIssueStatus", () => {
  it("updates the status icon on a paged archived row", () => {
    const key = seedPages(qc, "ws-1", EMPTY_INBOX_FILTERS, [
      page([row("a", { issue_id: "issue-1" })]),
    ]);

    patchInboxIssueStatus(qc, "ws-1", "issue-1", "done");

    expect(pageRows(qc, key)[0]?.issue_status).toBe("done");
  });

  it("reaches pages cached under other filter selections too", () => {
    // The user can toggle back to a filter they used earlier; its cached rows
    // are what they would see, so they have to be current.
    const base = seedPages(qc, "ws-1", EMPTY_INBOX_FILTERS, [page([row("a")])]);
    const narrowed = seedPages(qc, "ws-1", filters({ statuses: ["todo"] }), [
      page([row("b")]),
    ]);

    patchInboxIssueStatus(qc, "ws-1", "issue-a", "done");
    patchInboxIssueStatus(qc, "ws-1", "issue-b", "blocked");

    expect(pageRows(qc, base)[0]?.issue_status).toBe("done");
    expect(pageRows(qc, narrowed)[0]?.issue_status).toBe("blocked");
  });

  it("patches every page, not just the first", () => {
    const key = seedPages(qc, "ws-1", EMPTY_INBOX_FILTERS, [
      page([row("a", { issue_id: "issue-1" })], "c2"),
      page([row("b", { issue_id: "issue-1" })], null),
    ]);

    patchInboxIssueStatus(qc, "ws-1", "issue-1", "done");

    expect(pageRows(qc, key).every((r) => r.issue_status === "done")).toBe(true);
  });

  it("leaves rows for other issues alone", () => {
    const key = seedPages(qc, "ws-1", EMPTY_INBOX_FILTERS, [
      page([row("a", { issue_id: "issue-1" }), row("b", { issue_id: "issue-2" })]),
    ]);

    patchInboxIssueStatus(qc, "ws-1", "issue-1", "done");

    const rows = pageRows(qc, key);
    expect(rows.find((r) => r.id === "a")?.issue_status).toBe("done");
    expect(rows.find((r) => r.id === "b")?.issue_status).toBe("todo");
  });

  it("still patches the flat main list", () => {
    const listKey = inboxKeys.list("ws-1");
    qc.setQueryData<InboxItem[]>(listKey, [row("a", { issue_id: "issue-1", archived: false })]);

    patchInboxIssueStatus(qc, "ws-1", "issue-1", "done");

    expect(qc.getQueryData<InboxItem[]>(listKey)?.[0]?.issue_status).toBe("done");
  });

  it("does not touch another workspace's archive", () => {
    const mine = seedPages(qc, "ws-1", EMPTY_INBOX_FILTERS, [page([row("a")])]);
    const theirs = seedPages(qc, "ws-2", EMPTY_INBOX_FILTERS, [page([row("b")])]);

    patchInboxIssueStatus(qc, "ws-1", "issue-a", "done");

    expect(pageRows(qc, mine)[0]?.issue_status).toBe("done");
    expect(pageRows(qc, theirs)[0]?.issue_status).toBe("todo");
  });
});

describe("dropInboxItemsByIssue", () => {
  it("removes a deleted issue's rows from the paged archive", () => {
    // The server cascades the delete, so leaving the rows would offer a tap
    // through to a 404.
    const key = seedPages(qc, "ws-1", EMPTY_INBOX_FILTERS, [
      page([row("a", { issue_id: "issue-1" }), row("b", { issue_id: "issue-2" })]),
    ]);

    dropInboxItemsByIssue(qc, "ws-1", "issue-1");

    expect(pageRows(qc, key).map((r) => r.id)).toEqual(["b"]);
  });

  it("reaches every cached filter selection", () => {
    const base = seedPages(qc, "ws-1", EMPTY_INBOX_FILTERS, [
      page([row("a", { issue_id: "issue-1" })]),
    ]);
    const narrowed = seedPages(qc, "ws-1", filters({ unreadOnly: true }), [
      page([row("b", { issue_id: "issue-1" })]),
    ]);

    dropInboxItemsByIssue(qc, "ws-1", "issue-1");

    expect(pageRows(qc, base)).toEqual([]);
    expect(pageRows(qc, narrowed)).toEqual([]);
  });

  it("keeps a page's cursor metadata intact", () => {
    // Emptying a page must not corrupt the chain: `hasMore`/`nextCursor`
    // describe the server's window, not the rows we happen to be holding.
    const key = seedPages(qc, "ws-1", EMPTY_INBOX_FILTERS, [
      page([row("a", { issue_id: "issue-1" })], "c2"),
    ]);

    dropInboxItemsByIssue(qc, "ws-1", "issue-1");

    const data = qc.getQueryData<{ pages: ArchivedInboxPage[]; pageParams: unknown[] }>(key);
    expect(data?.pages[0]?.items).toEqual([]);
    expect(data?.pages[0]?.nextCursor).toBe("c2");
    expect(data?.pages[0]?.hasMore).toBe(true);
    expect(data?.pageParams).toEqual([null]);
  });

  it("does not delete an issue-less row that happens to share no issue", () => {
    const key = seedPages(qc, "ws-1", EMPTY_INBOX_FILTERS, [
      page([row("n", { issue_id: null })]),
    ]);

    dropInboxItemsByIssue(qc, "ws-1", "issue-1");

    expect(pageRows(qc, key).map((r) => r.id)).toEqual(["n"]);
  });

  it("still drops from the flat main list", () => {
    const listKey = inboxKeys.list("ws-1");
    qc.setQueryData<InboxItem[]>(listKey, [
      row("a", { issue_id: "issue-1", archived: false }),
      row("b", { issue_id: "issue-2", archived: false }),
    ]);

    dropInboxItemsByIssue(qc, "ws-1", "issue-1");

    expect(qc.getQueryData<InboxItem[]>(listKey)?.map((r) => r.id)).toEqual(["b"]);
  });
});
