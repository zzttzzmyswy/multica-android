/**
 * The server-cursor "Export all" walk (MYS-2157 / iter 241).
 *
 * Three things are under test, in order of how much they would cost to get
 * wrong:
 *
 *   1. **The request count.** This iteration exists because the client-side
 *      offset walk cost `ceil(total/50)` requests where the server cursor walk
 *      costs `ceil(total/100)`. The count is asserted numerically, not
 *      described — a `fetchPage` seam makes it the walk's own observable.
 *   2. **Fail-closed integrity.** A row set that cannot be proven whole must
 *      throw rather than serialize. Each of the five server-side
 *      contradictions gets its own case, and each is shown to be *load-bearing*
 *      (the same walk passes once the contradiction is removed).
 *   3. **The page limit.** The server 400s at `page.limit > 100` (measured), so
 *      the constant is pinned at the boundary the server accepts.
 */
import { describe, expect, it, vi } from "vitest";
import type { Issue, IssueTableRowsResponse } from "@multica/core/types";
import {
  ISSUE_TABLE_EXPORT_MAX_ROWS,
  ISSUE_TABLE_EXPORT_PAGE_LIMIT,
  IssueTableExportIntegrityError,
  IssueTableExportTooLargeError,
  acceptExportPage,
  buildIssueTableExportQuerySpec,
  collectIssueTableExportRows,
  type IssueTableExportIntegrityFailure,
} from "./issue-table-export-server";

const FINGERPRINT = "sha256:abc123";

/** Minimal `Issue` — the walk only ever reads `id`. */
function issue(id: string): Issue {
  return { id, title: id } as unknown as Issue;
}

/** One page as the server shapes it: `total` is authoritative on page 1 only
 *  and 0 afterwards, which is what the live deployment does. */
function page(
  ids: string[],
  opts: {
    total?: number;
    next_cursor?: string | null;
    fingerprint?: string;
    group_key?: string | null;
    parent_id?: string | null;
  } = {},
): IssueTableRowsResponse {
  return {
    query_fingerprint: opts.fingerprint ?? FINGERPRINT,
    group_key: opts.group_key ?? null,
    parent_id: opts.parent_id ?? null,
    total: opts.total ?? 0,
    rows: ids.map((id) => ({ issue: issue(id), direct_child_count: 0 })),
    branch_total: ids.length,
    next_cursor: opts.next_cursor ?? null,
  } as IssueTableRowsResponse;
}

/** A server that hands out `ids` in pages of `perPage`, counting the requests
 *  it serves — the same shape the real walk drives. */
function server(ids: string[], perPage: number) {
  const calls: (string | null)[] = [];
  const total = ids.length;
  const serve = async (cursor: string | null): Promise<IssueTableRowsResponse> => {
    calls.push(cursor);
    const offset = cursor === null ? 0 : Number(cursor);
    const slice = ids.slice(offset, offset + perPage);
    const next = offset + perPage;
    return page(slice, {
      // First page carries the real total; later pages report 0, like the
      // live endpoint.
      total: cursor === null ? total : 0,
      next_cursor: next < total ? String(next) : null,
    });
  };
  return { serve, calls };
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `issue-${i}`);

describe("ISSUE_TABLE_EXPORT_PAGE_LIMIT", () => {
  it("stays inside the server's accepted range", () => {
    // Measured: page.limit = 101 / 150 / 200 → 400 "page.limit must be
    // between 1 and 100". The constant is the whole client-side contract.
    expect(ISSUE_TABLE_EXPORT_PAGE_LIMIT).toBe(100);
    expect(ISSUE_TABLE_EXPORT_PAGE_LIMIT).toBeLessThanOrEqual(100);
    expect(ISSUE_TABLE_EXPORT_PAGE_LIMIT).toBeGreaterThanOrEqual(1);
  });
});

describe("collectIssueTableExportRows — request count", () => {
  it("fetches ceil(total / limit) pages, not ceil(total / 50)", async () => {
    // The measured workspace: 2077 rows. Mobile's old offset window paged at
    // 50 → 42 requests; this walk must land on 21.
    const { serve, calls } = server(ids(2077), ISSUE_TABLE_EXPORT_PAGE_LIMIT);
    const result = await collectIssueTableExportRows(serve);
    expect(result.requests).toBe(21);
    expect(calls).toHaveLength(21);
    expect(result.total).toBe(2077);
    expect(result.rows).toHaveLength(2077);

    // Stated as the inequality the iteration claims, so a future page-size
    // change that quietly halves the win fails here.
    const oldPath = Math.ceil(2077 / 50);
    expect(result.requests).toBeLessThan(oldPath);
    expect(result.requests).toBe(Math.ceil(2077 / ISSUE_TABLE_EXPORT_PAGE_LIMIT));
  });

  it("walks a result set smaller than one page in a single request", async () => {
    const { serve, calls } = server(ids(7), ISSUE_TABLE_EXPORT_PAGE_LIMIT);
    const result = await collectIssueTableExportRows(serve);
    expect(result.requests).toBe(1);
    expect(calls).toEqual([null]);
    expect(result.rows).toHaveLength(7);
  });

  it("walks an empty result set in one request and accepts it", async () => {
    // An empty workspace is a real answer, not a failure: total 0, no rows.
    const { serve } = server([], ISSUE_TABLE_EXPORT_PAGE_LIMIT);
    const result = await collectIssueTableExportRows(serve);
    expect(result.requests).toBe(1);
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("returns the rows in the order the server sent them", async () => {
    // Row ORDER is part of the CSV. The walk must not sort, group or reorder.
    const { serve } = server(["c", "a", "b"], 2);
    const result = await collectIssueTableExportRows(serve);
    expect(result.rows.map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("uses the first page's total, not a later page's 0", async () => {
    // Measured on the deployment: page.total is 2077 on page 1 and 0 after.
    // A walk that read the LAST page's total would mis-assert 0 == rows.length
    // and reject every multi-page export.
    const { serve } = server(ids(250), ISSUE_TABLE_EXPORT_PAGE_LIMIT);
    const result = await collectIssueTableExportRows(serve);
    expect(result.total).toBe(250);
  });
});

describe("collectIssueTableExportRows — fail-closed integrity", () => {
  /** A two-page walk (100 rows + 2) whose SECOND page is rewritten to inject
   *  one defect. The first page is left untouched on purpose: a defect injected
   *  there would be caught by a different check than the one under test, and
   *  the totals are made self-consistent so the clean walk is genuinely
   *  acceptable rather than accidentally passing. */
  async function walkWithSecondPage(
    patch: (p: IssueTableRowsResponse) => IssueTableRowsResponse,
  ) {
    let call = 0;
    return collectIssueTableExportRows(async () => {
      call += 1;
      if (call === 1) {
        return page(ids(100), { total: 102, next_cursor: "100" });
      }
      return patch(page(["a", "b"], { next_cursor: null }));
    });
  }

  const cases: {
    name: string;
    failure: IssueTableExportIntegrityFailure;
    patch: (p: IssueTableRowsResponse) => IssueTableRowsResponse;
  }[] = [
    {
      name: "an empty fingerprint (the schema fallback's sentinel)",
      failure: "fingerprint_missing",
      patch: (p) => ({ ...p, query_fingerprint: "" }),
    },
    {
      name: "a fingerprint that changed between pages",
      failure: "fingerprint_changed",
      patch: (p) => ({ ...p, query_fingerprint: "sha256:different" }),
    },
    {
      name: "a non-null group_key (the server answered a grouped query)",
      failure: "scope_drift",
      patch: (p) => ({ ...p, group_key: "status:todo" }),
    },
    {
      name: "a non-null parent_id (the server answered a branch query)",
      failure: "scope_drift",
      patch: (p) => ({ ...p, parent_id: "parent-1" }),
    },
    {
      name: "a row the walk already collected",
      failure: "duplicate_row",
      patch: (p) => ({ ...p, rows: [{ issue: issue("issue-0"), direct_child_count: 0 }] }),
    },
  ];

  for (const { name, failure, patch } of cases) {
    it(`refuses ${name}`, async () => {
      await expect(walkWithSecondPage(patch)).rejects.toThrow(
        IssueTableExportIntegrityError,
      );
      await expect(walkWithSecondPage(patch)).rejects.toMatchObject({ failure });
    });
  }

  it("accepts the same walk once the injected defect is removed", async () => {
    // Every case above must be load-bearing: the identical walk passes with an
    // untouched second page, so the rejections are caused by the injection and
    // not by the fixture.
    const result = await walkWithSecondPage((p) => p);
    expect(result.rows).toHaveLength(102);
    expect(result.requests).toBe(2);
  });

  it("refuses a cursor the server already sent", async () => {
    // A self-referential cursor would otherwise spin forever. The second page
    // carries FRESH rows so the loop check is what fires, not `duplicate_row`.
    let call = 0;
    await expect(
      collectIssueTableExportRows(async () => {
        call += 1;
        if (call === 1) return page(["a", "b"], { total: 150, next_cursor: "loop" });
        return page(["c", "d"], { total: 0, next_cursor: "loop" });
      }),
    ).rejects.toMatchObject({ failure: "cursor_loop" });
  });

  it("refuses a row count that does not equal the first page's total", async () => {
    // The whole point: a short collection must never serialize.
    let call = 0;
    await expect(
      collectIssueTableExportRows(async () => {
        call += 1;
        // Claims 150 rows but stops after 102.
        return call === 1
          ? page(ids(100), { total: 150, next_cursor: "100" })
          : page(["a", "b"], { total: 0, next_cursor: null });
      }),
    ).rejects.toMatchObject({ failure: "row_count_mismatch" });
  });

  it("refuses an over-long collection too, not only a short one", async () => {
    // A duplicated-free but too-large set is equally unprovable.
    await expect(
      collectIssueTableExportRows(async () =>
        page(ids(5), { total: 3, next_cursor: null }),
      ),
    ).rejects.toMatchObject({ failure: "row_count_mismatch" });
  });
});

describe("collectIssueTableExportRows — the phone-side ceiling", () => {
  it("refuses a result set past the cap before fetching a second page", async () => {
    const fetchPage = vi.fn(async () =>
      page(ids(100), { total: ISSUE_TABLE_EXPORT_MAX_ROWS + 1, next_cursor: "100" }),
    );
    await expect(collectIssueTableExportRows(fetchPage)).rejects.toThrow(
      IssueTableExportTooLargeError,
    );
    // The refusal is a pre-flight check on the authoritative total: asking for
    // the remaining pages to then discard them would be the drain-era waste.
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("accepts a result set exactly at the cap", async () => {
    // Boundary: the cap is "more than", not "at least".
    const { serve } = server(ids(3), 3);
    const result = await collectIssueTableExportRows(serve, { maxRows: 3 });
    expect(result.rows).toHaveLength(3);
  });

  it("carries the offending total on the error", async () => {
    const err = await collectIssueTableExportRows(
      async () => page(ids(1), { total: 12_345, next_cursor: null }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IssueTableExportTooLargeError);
    expect((err as IssueTableExportTooLargeError).total).toBe(12_345);
  });
});

describe("acceptExportPage", () => {
  it("collects ids into the shared set so a cross-page duplicate is caught", () => {
    const seen = new Set<string>();
    expect(acceptExportPage(page(["a", "b"]), null, seen)).toHaveLength(2);
    // The next page repeating "a" is refused, and the set is not polluted.
    expect(() => acceptExportPage(page(["a"]), FINGERPRINT, seen)).toThrow(
      IssueTableExportIntegrityError,
    );
    expect([...seen].sort()).toEqual(["a", "b"]);
  });

  it("freezes the fingerprint from the first page it accepts", () => {
    const seen = new Set<string>();
    const rows = acceptExportPage(page(["a"], { fingerprint: "sha256:first" }), null, seen);
    expect(rows).toHaveLength(1);
    expect(() =>
      acceptExportPage(page(["b"], { fingerprint: "sha256:second" }), "sha256:first", seen),
    ).toThrow(IssueTableExportIntegrityError);
  });
});

describe("buildIssueTableExportQuerySpec", () => {
  const scope = { kind: "workspace" } as const;
  const sort = { field: "position", direction: "asc" } as const;

  it("reuses the shared count/group projection for the filter bag", () => {
    // One projection for counts, facets and rows — they cannot drift.
    const spec = buildIssueTableExportQuerySpec(
      scope,
      { statuses: ["todo"], include_no_assignee: true, working_issue_ids: [] },
      false,
      sort,
    );
    expect(spec.filters).toEqual({
      statuses: ["todo"],
      include_no_assignee: true,
      // Presence is the signal even when empty — see the count module.
      working_issue_ids: [],
      include_sub_issues: false,
    });
  });

  it("carries the table's live sort, which the count projection pins away", () => {
    const spec = buildIssueTableExportQuerySpec(scope, {}, true, {
      field: "due_date",
      direction: "desc",
    });
    expect(spec.sort).toEqual({ field: "due_date", direction: "desc" });
  });

  it("carries the quick search, which the count projection drops", () => {
    // Without this the export would return the whole workspace under a
    // searched table.
    const spec = buildIssueTableExportQuerySpec(scope, { q: "服务器" }, true, sort);
    expect(spec.search).toBe("服务器");
  });

  it("omits a blank search instead of sending an empty one", () => {
    expect(
      buildIssueTableExportQuerySpec(scope, { q: "   " }, true, sort).search,
    ).toBeUndefined();
    expect(
      buildIssueTableExportQuerySpec(scope, {}, true, sort).search,
    ).toBeUndefined();
  });

  it("does not mutate the window it was given", () => {
    const window = { statuses: ["todo" as const], q: "x" };
    buildIssueTableExportQuerySpec(scope, window, true, sort);
    expect(window).toEqual({ statuses: ["todo"], q: "x" });
  });
});
