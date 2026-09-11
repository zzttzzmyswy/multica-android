/**
 * Gantt canvas data source — paged scheduled-issue fetch + query options.
 *
 * The server caps GET /api/issues at 100 rows/page (server/internal/
 * handler/issue.go), so fetchGanttIssues must walk (limit, offset) all the
 * way to `total` — a page-size above the server cap (the old 500) made
 * `length < pageLimit` break after the FIRST page and silently truncate
 * every workspace with >100 scheduled issues.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchGanttIssues, ganttIssuesOptions } from "./issues";

const { mockListIssues } = vi.hoisted(() => ({
  mockListIssues: vi.fn(),
}));

vi.mock("@/data/api", () => ({
  api: { listIssues: mockListIssues },
}));

function fakeIssue(id: number) {
  return { id: `issue-${id}` } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchGanttIssues", () => {
  it("walks (limit, offset) pages until total is reached", async () => {
    mockListIssues
      .mockResolvedValueOnce({
        issues: Array.from({ length: 100 }, (_, i) => fakeIssue(i)),
        total: 250,
      })
      .mockResolvedValueOnce({
        issues: Array.from({ length: 100 }, (_, i) => fakeIssue(100 + i)),
        total: 250,
      })
      .mockResolvedValueOnce({
        issues: Array.from({ length: 50 }, (_, i) => fakeIssue(200 + i)),
        total: 250,
      });

    const issues = await fetchGanttIssues("ws-1");

    expect(issues).toHaveLength(250);
    expect(mockListIssues).toHaveBeenCalledTimes(3);
    expect(mockListIssues.mock.calls[0][0]).toMatchObject({
      scheduled: true,
      limit: 100,
      offset: 0,
    });
    expect(mockListIssues.mock.calls[1][0]).toMatchObject({ offset: 100 });
    expect(mockListIssues.mock.calls[2][0]).toMatchObject({ offset: 200 });
  });

  it("stops at the first short page", async () => {
    mockListIssues.mockResolvedValue({ issues: [fakeIssue(0)], total: 1 });

    const issues = await fetchGanttIssues("ws-1");

    expect(issues).toHaveLength(1);
    expect(mockListIssues).toHaveBeenCalledTimes(1);
  });

  it("does not stop early when total is 0 (unset/unknown)", async () => {
    mockListIssues
      .mockResolvedValueOnce({
        issues: Array.from({ length: 100 }, (_, i) => fakeIssue(i)),
        total: 0,
      })
      .mockResolvedValueOnce({ issues: [], total: 0 });

    const issues = await fetchGanttIssues("ws-1");

    expect(issues).toHaveLength(100);
    expect(mockListIssues).toHaveBeenCalledTimes(2);
  });

  it("passes the optional scope filter into every page request", async () => {
    mockListIssues.mockResolvedValue({ issues: [], total: 0 });

    await fetchGanttIssues("ws-1", { assignee_id: "user-1" });

    expect(mockListIssues).toHaveBeenCalledWith(
      expect.objectContaining({ scheduled: true, assignee_id: "user-1" }),
    );
  });
});

describe("ganttIssuesOptions", () => {
  it("keys under the list(wsId) prefix so WS invalidation reaches it", () => {
    expect(ganttIssuesOptions("ws-1", true).queryKey).toEqual([
      "issues",
      "ws-1",
      "list",
      "gantt",
    ]);
  });

  it("gates on workspace + enabled flag", () => {
    expect(ganttIssuesOptions("ws-1", true).enabled).toBe(true);
    expect(ganttIssuesOptions("ws-1", false).enabled).toBe(false);
    expect(ganttIssuesOptions(null, true).enabled).toBe(false);
  });

  it("scopes the cache key by filter so my-issues scopes stay separate", () => {
    const assigned = ganttIssuesOptions("ws-1", true, { assignee_id: "u1" });
    const created = ganttIssuesOptions("ws-1", true, { creator_id: "u1" });
    expect(assigned.queryKey).not.toEqual(created.queryKey);
    expect(assigned.queryKey).toContainEqual({ assignee_id: "u1" });
  });

  it("queryFn delegates to the paged fetch with the filter", async () => {
    const opts = ganttIssuesOptions("ws-1", true, { involves_user_id: "u1" });
    mockListIssues.mockResolvedValue({ issues: [], total: 0 });

    await opts.queryFn!({} as never);

    expect(mockListIssues).toHaveBeenCalledWith(
      expect.objectContaining({ involves_user_id: "u1" }),
    );
  });
});
