import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, type MutationOptions, type InfiniteData } from "@tanstack/react-query";
import type { ArchivedInboxPage, InboxItem } from "@multica/core/types";

import { useArchiveInbox, useUnarchiveInbox, useMarkInboxRead } from "./inbox";
import { inboxKeys } from "@/data/queries/inbox";
import { writeFailureDetail } from "@/lib/write-failure";
import { acquireInboxWrite } from "./inbox-optimistic";

const mocks = vi.hoisted(() => ({ client: null as unknown, archive: vi.fn(), restore: vi.fn(), read: vi.fn() }));
vi.mock("@tanstack/react-query", async (original) => ({
  ...await original<typeof import("@tanstack/react-query")>(),
  useQueryClient: () => mocks.client,
  useMutation: (options: unknown) => options,
}));
vi.mock("@/data/api", () => ({ api: { archiveInbox: mocks.archive, unarchiveInbox: mocks.restore, markInboxRead: mocks.read } }));
vi.mock("@/data/workspace-store", () => ({ useWorkspaceStore: (select: (state: { currentWorkspaceId: string }) => unknown) => select({ currentWorkspaceId: "w" }) }));

const row = (id: string, issue = id, archived = false): InboxItem => ({
  id, issue_id: issue, archived, read: false, workspace_id: "w", recipient_type: "member", recipient_id: "m",
  actor_type: "agent", actor_id: "a", type: "new_comment", severity: "info", title: id,
  body: null, issue_status: null, created_at: "2026-11-20T00:00:00Z", details: null,
});
const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
let qc: QueryClient;
const execute = (hook: typeof useArchiveInbox, id: string) => qc.getMutationCache().build(qc,
  hook() as unknown as MutationOptions<void, Error, string, unknown>).execute(id);
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mocks.client = qc;
  vi.clearAllMocks();
});

describe("inbox concurrent triage through actual mutation lifecycle", () => {
  it("failed A archive preserves successful B, newer A read state and loaded rows", async () => {
    const a = deferred();
    mocks.archive.mockImplementation((id) => id === "a" ? a.promise : Promise.resolve());
    const key = inboxKeys.list("w");
    qc.setQueryData(key, [row("a"), row("a2", "a"), row("b")]);
    const failure = execute(useArchiveInbox, "a").catch((error) => error);
    await vi.waitFor(() => expect(mocks.archive).toHaveBeenCalledWith("a"));
    await execute(useArchiveInbox, "b");
    qc.setQueryData<InboxItem[]>(key, (old) => [...old!.map((item) => item.id === "a" ? { ...item, read: true, title: "new" } : item), row("new")]);
    a.reject(new Error("offline")); await failure;
    const rows = qc.getQueryData<InboxItem[]>(key)!;
    expect(rows.map((item) => [item.id, item.archived])).toEqual([["a", false], ["a2", false], ["b", true], ["new", false]]);
    expect(rows[0]).toMatchObject({ read: true, title: "new" });
  });

  it("restore resolves group across pages/filters/lookup; rollback preserves metadata and B", async () => {
    const a = deferred();
    mocks.restore.mockImplementation((id) => id === "a" ? a.promise : Promise.resolve());
    const key = [...inboxKeys.pages("w"), { severity: "info" }];
    const other = [...inboxKeys.pages("w"), { severity: "warning" }];
    const lookup = [...inboxKeys.lookup("w"), "a"];
    const page = (items: InboxItem[], nextCursor: string | null = null): ArchivedInboxPage => ({ items, nextCursor, hasMore: nextCursor !== null });
    qc.setQueryData(key, { pages: [page([row("a", "g", true)], "p2"), page([row("sibling", "g", true), row("b", "b", true)])], pageParams: [null, "p2"] });
    qc.setQueryData(other, { pages: [page([row("filtered-sibling", "g", true)])], pageParams: [null] });
    qc.setQueryData(lookup, page([row("lookup-sibling", "g", true)]));
    const mismatch = [...inboxKeys.archived("w"), "unrelated"];
    const unrelated = { count: 42 }; qc.setQueryData(mismatch, unrelated);
    const failure = execute(useUnarchiveInbox, "a").catch((error) => error);
    await vi.waitFor(() => expect(mocks.restore).toHaveBeenCalledWith("a"));
    expect(qc.getQueryData<InfiniteData<ArchivedInboxPage>>(other)!.pages[0].items[0].archived).toBe(false);
    expect(qc.getQueryData<ArchivedInboxPage>(lookup)!.items[0].archived).toBe(false);
    await execute(useUnarchiveInbox, "b");
    // Intervening fetch/load-more changes both page membership and metadata.
    qc.setQueryData(key, { pages: [page([{ ...row("a", "g"), read: true }], "new-cursor"), page([row("b")], "p3"), page([row("loaded", "loaded", true)])], pageParams: [null, "new-cursor", "p3"] });
    a.reject(new Error("offline")); await failure;
    const data = qc.getQueryData<InfiniteData<ArchivedInboxPage>>(key)!;
    expect(data.pageParams).toEqual([null, "new-cursor", "p3"]);
    expect(data.pages.map((p) => p.nextCursor)).toEqual(["new-cursor", "p3", null]);
    expect(data.pages.flatMap((p) => p.items).map((item) => [item.id, item.archived])).toEqual([["a", true], ["b", false], ["loaded", true]]);
    expect(data.pages[0].items[0].read).toBe(true);
    expect(qc.getQueryData(mismatch)).toEqual(unrelated);
    expect(qc.getQueryData(inboxKeys.list("w"))).toBeUndefined();
  });

  it("blocks same-group siblings across hook instances before API, but permits other groups and later retry", async () => {
    const a = deferred(); mocks.archive.mockImplementation(() => a.promise);
    qc.setQueryData(inboxKeys.list("w"), [row("a", "g"), row("sibling", "g")]);
    const first = execute(useArchiveInbox, "a");
    await vi.waitFor(() => expect(mocks.archive).toHaveBeenCalledTimes(1));
    const error = await execute(useArchiveInbox, "sibling").catch((error) => error);
    expect(error.body.code).toBe("inbox_action_pending");
    expect(mocks.archive).toHaveBeenCalledTimes(1);
    const options = useArchiveInbox() as unknown as { meta: Record<string, unknown> };
    expect(writeFailureDetail(error, { options }, (key) => key)).toBe("inbox.actionPending");
    a.resolve(); await first;
    mocks.archive.mockResolvedValue(undefined);
    await execute(useArchiveInbox, "sibling");
    expect(mocks.archive).toHaveBeenCalledTimes(2);
  });

  it("failed read restores its original read field without undoing an archive", async () => {
    const read = deferred(); mocks.read.mockReturnValue(read.promise); mocks.archive.mockResolvedValue(undefined);
    const key = inboxKeys.list("w"); qc.setQueryData(key, [row("a")]);
    const failure = execute(useMarkInboxRead, "a").catch((error) => error);
    await vi.waitFor(() => expect(mocks.read).toHaveBeenCalled());
    await execute(useArchiveInbox, "a");
    read.reject(new Error("offline")); await failure;
    expect(qc.getQueryData<InboxItem[]>(key)![0]).toMatchObject({ read: false, archived: true });
  });

  it("a failed refresh after a successful request cannot roll it back", async () => {
    mocks.archive.mockResolvedValue(undefined);
    const key = inboxKeys.list("w"); qc.setQueryData(key, [row("a")]);
    vi.spyOn(qc, "invalidateQueries").mockRejectedValue(new Error("refresh failed"));
    await execute(useArchiveInbox, "a");
    expect(qc.getQueryData<InboxItem[]>(key)![0].archived).toBe(true);
    const release = acquireInboxWrite(qc, "w", ["archived:issue:a"]); release();
  });

  it("does not recreate rows removed by refetch and releases locks even when refresh rejects", async () => {
    const a = deferred(); mocks.archive.mockReturnValue(a.promise);
    const key = inboxKeys.list("w"); qc.setQueryData(key, [row("a"), row("b")]);
    const failure = execute(useArchiveInbox, "a").catch((error) => error);
    await vi.waitFor(() => expect(mocks.archive).toHaveBeenCalled());
    qc.setQueryData(key, [row("b")]);
    vi.spyOn(qc, "invalidateQueries").mockRejectedValue(new Error("refresh failed"));
    a.reject(new Error("write failed")); await failure;
    expect(qc.getQueryData<InboxItem[]>(key)!.map((item) => item.id)).toEqual(["b"]);
    const release = acquireInboxWrite(qc, "w", ["archived:issue:a"]); release();
  });
});
