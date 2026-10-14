/**
 * `issuesByIdsOptions` — the swimlane's batch parent query (MYS-2156).
 *
 * The api method's own chunking is pinned in `data/api-issues-by-ids.test.ts`.
 * What this file covers is the QUERY layer around it: the key (which must be
 * the sorted id list, or the same question re-keys every render), the gate
 * (an empty list must not fire a request), and the map shape the swimlane
 * reads. `@/data/api` is mocked here so these stay query-layer assertions
 * rather than re-testing the transport.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const listIssuesByIds = vi.fn();
vi.mock("@/data/api", () => ({
  api: { listIssuesByIds: (...a: unknown[]) => listIssuesByIds(...a) },
}));

import type { Issue } from "@multica/core/types";
import { issueKeys } from "./issue-keys";
import { issuesByIdsOptions } from "./issues";

function issue(id: string, title = `T-${id}`): Issue {
  return { id, identifier: id.toUpperCase(), title } as unknown as Issue;
}

/** Run the options' queryFn the way TanStack would. */
async function run(
  wsId: string | null,
  ids: readonly string[],
): Promise<Map<string, Issue>> {
  const opts = issuesByIdsOptions(wsId, ids);
  const ctx = { signal: undefined } as never;
  return (await (opts.queryFn as (c: never) => Promise<Map<string, Issue>>)(ctx));
}

beforeEach(() => {
  listIssuesByIds.mockReset();
  listIssuesByIds.mockImplementation((ids: string[]) =>
    Promise.resolve(ids.map((id) => issue(id))),
  );
});

describe("issuesByIdsOptions", () => {
  it("hands the id list to the api and returns an id → Issue map", async () => {
    const map = await run("ws-1", ["a", "b"]);

    expect(listIssuesByIds).toHaveBeenCalledTimes(1);
    expect(listIssuesByIds).toHaveBeenCalledWith(["a", "b"], {
      signal: undefined,
    });
    expect(map.get("a")?.title).toBe("T-a");
    expect(map.get("b")?.identifier).toBe("B");
    expect(map.size).toBe(2);
  });

  it("keys on the id list, so two windows cannot share one entry", () => {
    expect(issueKeys.issuesByIds("ws-1", ["a", "b"])).toEqual([
      ...issueKeys.issuesByIdsAll("ws-1"),
      ["a", "b"],
    ]);
    // Order is part of the key: the caller sorts before calling, so an
    // unsorted list is a different (and wrong) question, not the same one.
    expect(issueKeys.issuesByIds("ws-1", ["a", "b"])).not.toEqual(
      issueKeys.issuesByIds("ws-1", ["b", "a"]),
    );
  });

  it("scopes the key to the workspace", () => {
    expect(issueKeys.issuesByIds("ws-1", ["a"])).not.toEqual(
      issueKeys.issuesByIds("ws-2", ["a"]),
    );
    // The prefix is what a workspace-wide invalidation would match.
    expect(issueKeys.issuesByIdsAll("ws-1")).toEqual([
      ...issueKeys.all("ws-1"),
      "by-ids",
    ]);
  });

  it("is disabled without a workspace or without ids", () => {
    expect(issuesByIdsOptions(null, ["p1"]).enabled).toBe(false);
    expect(issuesByIdsOptions("ws-1", []).enabled).toBe(false);
    expect(issuesByIdsOptions("ws-1", ["p1"]).enabled).toBe(true);
  });

  it("a parent missing from the response is simply absent from the map", async () => {
    // "Not loaded" is what the swimlane reads as "render this child in the
    // pinned orphan lane", so a missing id must not become an entry holding a
    // placeholder — that would promote the lane with a blank title.
    listIssuesByIds.mockResolvedValue([issue("a")]);

    const map = await run("ws-1", ["a", "missing"]);

    expect(map.has("a")).toBe(true);
    expect(map.has("missing")).toBe(false);
    expect(map.size).toBe(1);
  });
});
