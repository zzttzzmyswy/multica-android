/**
 * Actor Issues 列表查询 —— web `common/actor-issues-panel.tsx` 的移动端数据层。
 * 复用 listIssues 的 assignee_filters / creator_filters（type:id），按 actor
 * type/id/relation 独立 cache key（actorAll 前缀），scope 切换自动 refetch。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockListIssues } = vi.hoisted(() => ({
  mockListIssues: vi.fn(),
}));

vi.mock("@/data/api", () => ({
  api: { listIssues: mockListIssues },
}));

import { actorIssuesListOptions } from "./actor-issues";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("actorIssuesListOptions", () => {
  it("keys per actor type/id/relation under the actorAll(wsId) prefix", () => {
    expect(
      actorIssuesListOptions("ws-1", "agent", "ag_1", "assigned").queryKey,
    ).toEqual(["issues", "ws-1", "actor", "agent", "ag_1", "assigned"]);
    expect(
      actorIssuesListOptions("ws-1", "member", "u_9", "created").queryKey,
    ).toEqual(["issues", "ws-1", "actor", "member", "u_9", "created"]);
  });

  it("switching relation changes the cache key (no refetch overlap)", () => {
    const assigned = actorIssuesListOptions("ws-1", "agent", "ag_1", "assigned");
    const created = actorIssuesListOptions("ws-1", "agent", "ag_1", "created");
    expect(assigned.queryKey).not.toEqual(created.queryKey);
  });

  it("stays disabled without a workspace", () => {
    expect(
      actorIssuesListOptions(null, "agent", "ag_1", "assigned").enabled,
    ).toBe(false);
    expect(
      actorIssuesListOptions("ws-1", "agent", "ag_1", "assigned").enabled,
    ).toBe(true);
  });

  it("sets a 30s stale time like the other issue lists", () => {
    expect(
      actorIssuesListOptions("ws-1", "agent", "ag_1", "assigned").staleTime,
    ).toBe(30_000);
  });

  it("queryFn delegates to api.listIssues with the actor filter and returns rows", async () => {
    const rows = [{ id: "iss_1" }, { id: "iss_2" }];
    mockListIssues.mockResolvedValue({ issues: rows });
    const opts = actorIssuesListOptions("ws-1", "member", "u_9", "created");
    const out = await opts.queryFn!({ signal: undefined } as never);
    expect(mockListIssues).toHaveBeenCalledWith(
      { creator_filters: [{ type: "member", id: "u_9" }] },
      { signal: undefined },
    );
    expect(out).toEqual(rows);
  });

  it("assigned relation serializes assignee_filters", async () => {
    mockListIssues.mockResolvedValue({ issues: [] });
    const opts = actorIssuesListOptions("ws-1", "agent", "ag_1", "assigned");
    await opts.queryFn!({ signal: undefined } as never);
    expect(mockListIssues).toHaveBeenCalledWith(
      { assignee_filters: [{ type: "agent", id: "ag_1" }] },
      { signal: undefined },
    );
  });
});