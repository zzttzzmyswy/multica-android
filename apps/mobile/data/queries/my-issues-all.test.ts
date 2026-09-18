/**
 * `myIssuesAllOptions` — the "all" scope's scatter-gather union. The list API
 * ANDs its params, so the union of assigned / created / involved is assembled
 * from one page per leg. These tests pin the two things that can silently go
 * wrong: the dedupe across overlapping legs, and the `fetched`/`total`
 * accounting that drives infinite-scroll termination (it must stay a sum of
 * SERVER row counts, because the next offset indexes each leg's own window).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const listIssues = vi.fn();
vi.mock("@/data/api", () => ({ api: { listIssues: (...a: unknown[]) => listIssues(...a) } }));

import type { Issue } from "@multica/core/types";
import { myIssuesAllOptions } from "./my-issues";
import { flattenIssuePages, nextIssuePageParam, type IssuePage } from "@/lib/issue-pagination";

function issue(id: string): Issue {
  return { id, identifier: id.toUpperCase() } as unknown as Issue;
}

function page(ids: string[], total: number) {
  return { issues: ids.map(issue), total };
}

/** Run the options' queryFn the way TanStack would, then hand back the page. */
async function runQuery(
  wsId: string | null,
  userId: string | null,
  pageParam = 0,
  window: Record<string, unknown> = {},
): Promise<IssuePage> {
  const opts = myIssuesAllOptions(wsId, userId, window);
  const ctx = { pageParam, signal: undefined } as never;
  return (await (opts.queryFn as (c: never) => Promise<IssuePage>)(ctx));
}

beforeEach(() => {
  listIssues.mockReset();
});

describe("myIssuesAllOptions", () => {
  it("queries all three legs with the user's id and the same window", async () => {
    listIssues.mockResolvedValue(page([], 0));
    await runQuery("ws-1", "user-1", 0, { sort_by: "updated_at" });
    expect(listIssues).toHaveBeenCalledTimes(3);
    const bodies = listIssues.mock.calls.map((c) => c[0]);
    expect(bodies).toEqual([
      { assignee_id: "user-1", sort_by: "updated_at", limit: 50, offset: 0 },
      { creator_id: "user-1", sort_by: "updated_at", limit: 50, offset: 0 },
      { involves_user_id: "user-1", sort_by: "updated_at", limit: 50, offset: 0 },
    ]);
  });

  it("merges the legs in order and dedupes an issue claimed by two legs", async () => {
    listIssues
      .mockResolvedValueOnce(page(["a", "b"], 2)) // assigned
      .mockResolvedValueOnce(page(["b", "c"], 2)) // created — b overlaps
      .mockResolvedValueOnce(page(["d"], 1)); // involved
    const result = await runQuery("ws-1", "user-1");
    expect(result.issues.map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("sums the legs' SERVER row counts for `fetched`, not the deduped length", async () => {
    listIssues
      .mockResolvedValueOnce(page(["a", "b"], 2))
      .mockResolvedValueOnce(page(["b", "c"], 2))
      .mockResolvedValueOnce(page(["d"], 1));
    const result = await runQuery("ws-1", "user-1");
    expect(result.issues).toHaveLength(4);
    expect(result.fetched).toBe(5);
  });

  it("sums the legs' totals as the (overlap-inflated) bound", async () => {
    listIssues
      .mockResolvedValueOnce(page(["a"], 3))
      .mockResolvedValueOnce(page(["b"], 12))
      .mockResolvedValueOnce(page(["c"], 942));
    const result = await runQuery("ws-1", "user-1");
    expect(result.total).toBe(957);
  });

  it("keeps paging while any leg still has rows", async () => {
    // assigned is exhausted (1 of 1), involved is not (50 of 942).
    listIssues
      .mockResolvedValueOnce(page(["a"], 1))
      .mockResolvedValueOnce(page([], 0))
      .mockResolvedValueOnce(page(Array.from({ length: 50 }, (_, i) => `i${i}`), 942));
    const first = await runQuery("ws-1", "user-1", 0);
    expect(nextIssuePageParam([first])).toBe(51);
  });

  it("stops when every leg runs dry", async () => {
    listIssues
      .mockResolvedValueOnce(page(["a"], 1))
      .mockResolvedValueOnce(page(["b"], 1))
      .mockResolvedValueOnce(page(["c"], 1));
    const first = await runQuery("ws-1", "user-1", 0);
    expect(nextIssuePageParam([first])).toBeUndefined();
  });

  it("stops on an all-empty page even when the totals say otherwise", async () => {
    // The empty page is the only trustworthy "server has no more" signal.
    listIssues.mockResolvedValue(page([], 900));
    const first = await runQuery("ws-1", "user-1", 0);
    expect(nextIssuePageParam([first])).toBeUndefined();
  });

  it("dedupes across pages too, so overlapping windows never duplicate a row", async () => {
    listIssues
      .mockResolvedValueOnce(page(["a", "b"], 4))
      .mockResolvedValueOnce(page([], 0))
      .mockResolvedValueOnce(page([], 0));
    const first = await runQuery("ws-1", "user-1", 0);
    listIssues.mockReset();
    listIssues
      .mockResolvedValueOnce(page(["b", "c"], 4))
      .mockResolvedValueOnce(page([], 0))
      .mockResolvedValueOnce(page([], 0));
    const second = await runQuery("ws-1", "user-1", 2);
    expect(flattenIssuePages([first, second]).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("is disabled until both the workspace and the user are known", () => {
    expect(myIssuesAllOptions(null, "user-1").enabled).toBe(false);
    expect(myIssuesAllOptions("ws-1", null).enabled).toBe(false);
    expect(myIssuesAllOptions("ws-1", "user-1").enabled).toBe(true);
  });
});
