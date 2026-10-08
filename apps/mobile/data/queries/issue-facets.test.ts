/**
 * Facet-count query layer (iter211). The interesting behaviour is the
 * "exact or nothing" rule: an unresolved or failed facet must yield
 * `undefined` so the filter panel renders NO badge, matching web's
 * `facetCountsExact ? scopedIssues : NO_COUNT_ISSUES`
 * (`issues-header.tsx:1183`) — a locally-derived number would under-report on
 * any workspace busier than one page.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockListIssueTableFacets } = vi.hoisted(() => ({
  mockListIssueTableFacets: vi.fn(),
}));

vi.mock("@/data/api", () => ({
  api: { listIssueTableFacets: mockListIssueTableFacets },
}));

import { issueFacetCountsOptions } from "./issue-facets";
import { FACET_DIMENSIONS, NO_VALUE_KEY } from "@/lib/issue-facet-counts";

const workspaceScope = { kind: "workspace" } as const;

function query(overrides: Partial<Parameters<typeof issueFacetCountsOptions>[1]> = {}) {
  return {
    scope: workspaceScope,
    window: {},
    includeSubIssues: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("issueFacetCountsOptions", () => {
  it("keys under the workspace issue prefix and namespaces the facet query", () => {
    const opts = issueFacetCountsOptions("ws-1", query());
    expect(opts.queryKey.slice(0, 3)).toEqual(["issues", "ws-1", "table-facets"]);
  });

  it("omits sort from the key, because counts are sort-invariant", () => {
    // Re-sorting the list must not refetch counts that cannot have changed.
    const asc = issueFacetCountsOptions(
      "ws-1",
      query({ window: { sort_by: "priority", sort_direction: "asc" } }),
    );
    const desc = issueFacetCountsOptions(
      "ws-1",
      query({ window: { sort_by: "priority", sort_direction: "desc" } }),
    );
    expect(asc.queryKey).toEqual(desc.queryKey);
  });

  it("changes the key when a filter dimension changes", () => {
    const none = issueFacetCountsOptions("ws-1", query());
    const filtered = issueFacetCountsOptions(
      "ws-1",
      query({ window: { statuses: ["todo"] } }),
    );
    expect(none.queryKey).not.toEqual(filtered.queryKey);
  });

  it("keys the property set order-insensitively", () => {
    const ab = issueFacetCountsOptions("ws-1", query({ propertyIds: ["a", "b"] }));
    const ba = issueFacetCountsOptions("ws-1", query({ propertyIds: ["b", "a"] }));
    expect(ab.queryKey).toEqual(ba.queryKey);
  });

  it("distinguishes a request with properties from one without", () => {
    const bare = issueFacetCountsOptions("ws-1", query());
    const withProps = issueFacetCountsOptions("ws-1", query({ propertyIds: ["a"] }));
    expect(bare.queryKey).not.toEqual(withProps.queryKey);
  });

  it("asks for the six base dimensions plus one facet per property", async () => {
    mockListIssueTableFacets.mockResolvedValue({
      query_fingerprint: "fp",
      total: 0,
      facets: [],
    });
    const opts = issueFacetCountsOptions("ws-1", query({ propertyIds: ["p1"] }));
    await opts.queryFn!({ signal: undefined } as never);

    const [request] = mockListIssueTableFacets.mock.calls[0]!;
    expect(request.facets).toEqual([
      ...FACET_DIMENSIONS,
      { kind: "property", property_id: "p1" },
    ]);
  });

  it("drops the facet's own dimension nowhere — disjunction is the server's job", async () => {
    mockListIssueTableFacets.mockResolvedValue({
      query_fingerprint: "fp",
      total: 0,
      facets: [],
    });
    const opts = issueFacetCountsOptions(
      "ws-1",
      query({ window: { statuses: ["todo", "done"] } }),
    );
    await opts.queryFn!({ signal: undefined } as never);

    const [request] = mockListIssueTableFacets.mock.calls[0]!;
    expect(request.query.filters.statuses).toEqual(["todo", "done"]);
  });

  it("reduces the response to per-dimension maps", async () => {
    mockListIssueTableFacets.mockResolvedValue({
      query_fingerprint: "fp",
      total: 0,
      facets: [
        {
          kind: "status",
          values: [{ key: "todo", count: 12 }],
        },
        {
          kind: "assignee",
          values: [{ key: NO_VALUE_KEY, count: 3 }],
        },
      ],
    });
    const opts = issueFacetCountsOptions("ws-1", query());
    const out = await opts.queryFn!({ signal: undefined } as never);
    expect(out.status.get("todo")).toBe(12);
    expect(out.assignee.get(NO_VALUE_KEY)).toBe(3);
  });

  it("never retries — a missing badge must not become a retry loop", () => {
    expect(issueFacetCountsOptions("ws-1", query()).retry).toBe(false);
  });

  it("treats every mount as stale, because counts move with any issue", () => {
    expect(issueFacetCountsOptions("ws-1", query()).staleTime).toBe(0);
  });
});
