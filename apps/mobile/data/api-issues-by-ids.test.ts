/**
 * `api.listIssuesByIds` — the swimlane's batch parent resolution (MYS-2156).
 *
 * The behaviour under test is a REQUEST COUNT, not a returned value: the
 * swimlane used to resolve its parent lanes with one `GET /api/issues/:id` per
 * distinct parent (`useQueries` over `issueDetailOptions`), so a window naming
 * N parents cost N requests. Each case counts what actually reaches the
 * network — via the `fetch` seam every api method goes through — because a
 * regression that reintroduced the fan-out would still return correct data.
 *
 * The divisor is the SERVER's `limit` clamp (100), not the `/api/issues/
 * children` parent cap (200): `ListIssues` clamps `limit` to 100
 * (server/internal/handler/issue.go:945), so one request can return at most
 * 100 rows no matter what is asked for, and every id past that would be
 * resolved to nothing.
 *
 * `ids` goes out through `listIssues`, which routes any request carrying `ids`
 * to the POST twin (`/api/issues/query`) — the id list can exceed a request
 * line. These tests assert against that real routing rather than a stub.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

process.env.EXPO_PUBLIC_API_URL = "https://api.test";

vi.mock("expo-file-system", () => ({
  File: class {
    uri = "file:///mock";
    exists = false;
  },
  Paths: { document: { uri: "file:///doc" } },
}));

vi.mock("expo-file-system/legacy", () => ({
  createDownloadResumable: vi.fn(),
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

// `data/api.ts` reads `EXPO_PUBLIC_API_URL` at import time and throws without
// it, and a static import is hoisted above the assignment below — so both the
// client and the chunk constant come in dynamically, the same way
// `data/api-batch.test.ts` boots the module.
let api: typeof import("./api").api;
let ISSUES_BY_IDS_CHUNK_SIZE: number;

/** A row that passes `IssueSchema` (mirrored from a real `GET /api/issues`
 *  row). The responses below go through `listIssues`' own `parseWithFallback`,
 *  so a bare `{ id }` would fail validation and degrade the whole chunk to the
 *  empty fallback — the test would then be measuring the schema, not the
 *  chunking. */
function row(id: string) {
  return {
    id,
    workspace_id: "ws-1",
    number: 1,
    identifier: id.toUpperCase(),
    title: `T-${id}`,
    description: null,
    status: "todo",
    priority: "none",
    assignee_type: null,
    assignee_id: null,
    creator_type: "member",
    creator_id: "u1",
    parent_issue_id: null,
    project_id: null,
    position: 0,
    stage: null,
    start_date: null,
    due_date: null,
    metadata: {},
    properties: {},
    created_at: "2026-10-14T00:00:00Z",
    updated_at: "2026-10-14T00:00:00Z",
  };
}
/** Spy on the client's private `fetch`, typed to the real signature so the
 *  mocked implementations below can read the request body. */
type FetchFn = (path: string, init: RequestInit) => Promise<unknown>;

const fetchSpy = () =>
  vi.spyOn(
    api as unknown as { fetch: FetchFn },
    "fetch",
  ) as unknown as MockInstance<FetchFn>;

/** The `ids` list of each request, parsed out of the POST body. */
function idsSent(spy: ReturnType<typeof fetchSpy>): string[][] {
  return spy.mock.calls.map((call) => {
    const init = call[1] as { body: string };
    return JSON.parse(init.body).ids.split(",");
  });
}

/** `limit` of each request, parsed out of the POST body. */
function limitsSent(spy: ReturnType<typeof fetchSpy>): string[] {
  return spy.mock.calls.map((call) => {
    const init = call[1] as { body: string };
    return JSON.parse(init.body).limit;
  });
}

beforeAll(async () => {
  ({ api, ISSUES_BY_IDS_CHUNK_SIZE } = await import("./api"));
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("ISSUES_BY_IDS_CHUNK_SIZE", () => {
  it("is the list endpoint's row clamp, so a chunk cannot be truncated", () => {
    expect(ISSUES_BY_IDS_CHUNK_SIZE).toBe(100);
  });
});

describe("api.listIssuesByIds", () => {
  it("resolves N ids with ONE request (the fan-out is gone)", async () => {
    const spy = fetchSpy().mockImplementation((_path: string, init: RequestInit) =>
      Promise.resolve({
        issues: JSON.parse(init.body as string).ids
          .split(",")
          .map((id: string) => row(id)),
        total: 25,
      }),
    );
    const ids = Array.from({ length: 25 }, (_, i) => `p${i}`);

    const out = await api.listIssuesByIds(ids);

    // The acceptance criterion: one request, not one per parent.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(idsSent(spy)[0]).toEqual(ids);
    expect(out).toHaveLength(25);
  });

  it("chunks at 100, sending every id exactly once", async () => {
    const spy = fetchSpy().mockImplementation((_path: string, init: RequestInit) => {
      const ids = JSON.parse(init.body as string).ids.split(",");
      return Promise.resolve({ issues: ids.map((id: string) => row(id)), total: ids.length });
    });
    const ids = Array.from({ length: 250 }, (_, i) => `p${i}`);

    const out = await api.listIssuesByIds(ids);

    // ceil(250/100) — a request per chunk, never one per id.
    expect(spy).toHaveBeenCalledTimes(3);
    const sent = idsSent(spy);
    expect(sent.map((c) => c.length)).toEqual([100, 100, 50]);
    // Exactly the requested set, in order, with no id lost or repeated.
    expect(sent.flat()).toEqual(ids);
    expect(out.map((i) => i.id)).toEqual(ids);
    // Each request must ask for as many rows as it names ids, or the tail of
    // every full chunk would come back truncated by the server clamp.
    expect(limitsSent(spy)).toEqual(["100", "100", "100"]);
  });

  it("sends ONE request at the exact boundary", async () => {
    const spy = fetchSpy().mockResolvedValue({ issues: [], total: 0 });
    await api.listIssuesByIds(Array.from({ length: 100 }, (_, i) => `p${i}`));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("sends nothing for an empty id list", async () => {
    const spy = fetchSpy().mockResolvedValue({ issues: [], total: 0 });

    const out = await api.listIssuesByIds([]);

    // An empty `ids=` is meaningful to the server ("match nothing"), so this
    // must not reach the wire at all.
    expect(spy).not.toHaveBeenCalled();
    expect(out).toEqual([]);
  });

  it("spends no row budget on duplicate ids", async () => {
    const spy = fetchSpy().mockImplementation((_path: string, init: RequestInit) => {
      const ids = JSON.parse(init.body as string).ids.split(",");
      return Promise.resolve({ issues: ids.map((id: string) => row(id)), total: ids.length });
    });

    const out = await api.listIssuesByIds(["a", "b", "a", "c", "b"]);

    // Deduped before chunking: 5 ids collapse to 3, so a caller passing
    // repeats cannot push a real row off the end of the 100-row window.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(idsSent(spy)[0]).toEqual(["a", "b", "c"]);
    expect(out).toHaveLength(3);
  });

  it("keeps a failed chunk from taking the whole batch down", async () => {
    let call = 0;
    const spy = fetchSpy().mockImplementation((_path: string, init: RequestInit) => {
      call += 1;
      if (call === 2) return Promise.reject(new Error("network"));
      const ids = JSON.parse(init.body as string).ids.split(",");
      return Promise.resolve({ issues: ids.map((id: string) => row(id)), total: ids.length });
    });

    const out = await api.listIssuesByIds(
      Array.from({ length: 150 }, (_, i) => `p${i}`),
    );

    // Chunk 1 still resolved; only the failed chunk's parents are missing,
    // which renders them in the orphan lane for that frame — the same blast
    // radius one failed per-id request had.
    expect(spy).toHaveBeenCalledTimes(2);
    expect(out).toHaveLength(100);
    expect(out.some((i) => i.id === "p0")).toBe(true);
    expect(out.some((i) => i.id === "p100")).toBe(false);
  });

  it("routes through the POST twin, not the GET list", async () => {
    const spy = fetchSpy().mockResolvedValue({ issues: [], total: 0 });

    await api.listIssuesByIds(["a"]);

    // The id list can exceed a request line, so `listIssues`' own `ids`
    // routing must stay on the path.
    expect(spy).toHaveBeenCalledWith(
      "/api/issues/query",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
