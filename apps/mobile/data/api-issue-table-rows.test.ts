/**
 * `api.listIssueTableRows` — the transport the export walk drives (MYS-2157).
 *
 * The walk's own request count is covered by `issue-table-export-server.test.ts`.
 * What is covered here is the half that test cannot see: that the client method
 * actually POSTs the right path with the flat-result-set body, and that a
 * drifted response falls back to the EMPTY response whose empty fingerprint the
 * walk refuses — the two halves of "fail closed" joined at the seam.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

import type { IssueTableRowsRequest } from "@multica/core/types";
import {
  IssueTableExportIntegrityError,
  acceptExportPage,
} from "@/lib/issue-table-export-server";

type ApiClient = typeof import("./api").api;
let api: ApiClient;

/** Spy on the client's private `fetch`, typed to the real signature so the
 *  mocked implementations can read the request body (the
 *  `api-issues-by-ids.test.ts` convention). */
type FetchFn = (path: string, init: RequestInit) => Promise<unknown>;

const fetchSpy = () =>
  vi.spyOn(api as unknown as { fetch: FetchFn }, "fetch");

beforeAll(async () => {
  ({ api } = await import("./api"));
});

beforeEach(() => {
  vi.restoreAllMocks();
});

const REQUEST: IssueTableRowsRequest = {
  query: {
    scope: { kind: "workspace" },
    filters: { include_sub_issues: true },
    sort: { field: "position", direction: "asc" },
  },
  group: { kind: "none" },
  group_key: null,
  hierarchy: { enabled: false },
  parent_id: null,
  page: { limit: 100, cursor: null },
};
/** A row that passes `IssueSchema` (mirrored from a real `GET /api/issues`
 *  row). Responses below go through this method's own `parseWithFallback`, so a
 *  bare `{ id }` would fail validation and degrade the whole page to the EMPTY
 *  fallback — the test would then be measuring the schema, not the transport. */
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

const RESPONSE = {
  query_fingerprint: "sha256:abc",
  group_key: null,
  parent_id: null,
  total: 2,
  rows: [
    { issue: row("i1"), direct_child_count: 0 },
    { issue: row("i2"), direct_child_count: 0 },
  ],
  branch_total: 2,
  next_cursor: null,
};

describe("api.listIssueTableRows", () => {
  it("POSTs the flat-result-set body to /api/issues/table/rows", async () => {
    const spy = fetchSpy().mockResolvedValue(RESPONSE);
    const res = await api.listIssueTableRows(REQUEST);
    expect(spy).toHaveBeenCalledWith(
      "/api/issues/table/rows",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(REQUEST),
      }),
    );
    expect(res.rows).toHaveLength(2);
    expect(res.query_fingerprint).toBe("sha256:abc");
  });

  it("passes the cursor through untouched", async () => {
    // The cursor is opaque — the walk must round-trip the server's own token.
    const spy = fetchSpy().mockResolvedValue({ ...RESPONSE, next_cursor: "next" });
    await api.listIssueTableRows({
      ...REQUEST,
      page: { limit: 100, cursor: "eyJ2Ijox" },
    });
    const body = JSON.parse(
      (spy.mock.calls[0][1] as { body: string }).body,
    ) as IssueTableRowsRequest;
    expect(body.page).toEqual({ limit: 100, cursor: "eyJ2Ijox" });
  });
});

describe("drift fails the export closed, not open", () => {
  it("falls back to the EMPTY response on a drifted body, whose empty fingerprint the walk refuses", async () => {
    // parseWithFallback never throws into the UI — it substitutes the EMPTY
    // response. That response must therefore be *refusable*, or a drifted page
    // would read as "0 rows, complete" and serialize an empty CSV.
    fetchSpy().mockResolvedValue({ rows: "not-an-array" });
    const res = await api.listIssueTableRows(REQUEST);
    expect(res.query_fingerprint).toBe("");
    expect(res.rows).toEqual([]);

    expect(() => acceptExportPage(res, null, new Set())).toThrow(
      IssueTableExportIntegrityError,
    );
  });
});
