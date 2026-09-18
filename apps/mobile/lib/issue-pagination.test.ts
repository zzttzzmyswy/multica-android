import { describe, expect, it } from "vitest";
import type { Issue } from "@multica/core/types";
import {
  ISSUE_PAGE_SIZE,
  PAGINATED_THRESHOLD,
  flattenIssuePages,
  hasMoreIssues,
  issueListTotal,
  makeIssuePage,
  nextIssuePageParam,
  showNoMoreIssues,
  type IssuePage,
} from "./issue-pagination";

/** Minimal Issue fixture — only `id` is load-bearing for these functions. */
function issue(id: string): Issue {
  return { id, title: id } as unknown as Issue;
}

function page(ids: string[], total: number): IssuePage {
  return makeIssuePage(ids.map(issue), total);
}

/** A page whose `issues` have since been locally patched (WS insert/remove):
 *  `fetched` stays at the count the server actually returned. */
function patchedPage(
  ids: string[],
  total: number,
  fetched: number,
): IssuePage {
  return { issues: ids.map(issue), total, fetched };
}

/** A full page of `n` synthetic ids prefixed so pages don't collide. */
function ids(prefix: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`);
}

describe("flattenIssuePages", () => {
  it("concatenates pages in order", () => {
    const rows = flattenIssuePages([page(["a", "b"], 4), page(["c", "d"], 4)]);
    expect(rows.map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("drops rows that reappear on a later page (offset window slid between fetches)", () => {
    // An issue created between page 1 and page 2 shifts the offset window, so
    // "b" is served twice. Rendering it twice would duplicate the FlatList key.
    const rows = flattenIssuePages([page(["a", "b"], 5), page(["b", "c"], 5)]);
    expect(rows.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps the first occurrence when a row is repeated within one page", () => {
    const rows = flattenIssuePages([page(["a", "a"], 1)]);
    expect(rows.map((i) => i.id)).toEqual(["a"]);
  });

  it("returns an empty list for no pages", () => {
    expect(flattenIssuePages([])).toEqual([]);
  });
});

describe("issueListTotal", () => {
  it("reads the server's whole-window count off the last page", () => {
    expect(issueListTotal([page(ids("a", 50), 512), page(ids("b", 50), 512)])).toBe(
      512,
    );
  });

  it("is 0 with no pages", () => {
    expect(issueListTotal([])).toBe(0);
  });
});

describe("nextIssuePageParam", () => {
  it("advances by the raw fetched row count, not the deduped count", () => {
    // Offsets index into the SERVER's window, so a duplicate served twice must
    // still advance the offset by two — otherwise the next fetch re-reads the
    // same rows forever.
    const pages = [page(["a", "b"], 5), page(["b", "c"], 5)];
    expect(nextIssuePageParam(pages)).toBe(4);
  });

  it("ignores rows a WS event inserted locally", () => {
    // Page 1 came back with 50 rows; a teammate then filed an issue and the WS
    // prepend patched page 0 to 51 rows. Advancing by 51 would make the next
    // request skip server row 50 — a row nobody ever fetched — and the raw
    // count would then reach `total`, printing "no more" over the gap.
    const pages = [
      patchedPage(ids("a", 51), 130, 50),
      page(ids("b", 50), 130),
    ];
    expect(nextIssuePageParam(pages)).toBe(100);
  });

  it("ignores rows a WS event removed locally", () => {
    // Counterpart: a delete shrinks `issues` but must not rewind the offset,
    // or the next page re-serves rows already on screen.
    const pages = [patchedPage(ids("a", 49), 130, 50)];
    expect(nextIssuePageParam(pages)).toBe(50);
  });

  it("stops once the fetched count reaches the server total", () => {
    expect(nextIssuePageParam([page(ids("a", 50), 50)])).toBeUndefined();
  });

  it("keeps going while the fetched count is below the server total", () => {
    expect(nextIssuePageParam([page(ids("a", 50), 120)])).toBe(50);
    expect(
      nextIssuePageParam([page(ids("a", 50), 120), page(ids("b", 50), 120)]),
    ).toBe(100);
  });

  it("keeps going on a full page even when a later page would exceed the total", () => {
    // Last page overshoots only when rows vanish server-side mid-scroll; the
    // walk must still terminate rather than ask for an offset past the end.
    expect(
      nextIssuePageParam([page(ids("a", 50), 60), page(ids("b", 50), 60)]),
    ).toBeUndefined();
  });

  it("terminates on an empty page even when the total says otherwise", () => {
    // An empty page is the only trustworthy "nothing left" signal — trusting a
    // stale total here would loop forever asking for rows that never arrive.
    expect(nextIssuePageParam([page([], 120)])).toBeUndefined();
  });

  it("stops on a short page when the server total is missing (schema falls back to 0)", () => {
    expect(nextIssuePageParam([page(ids("a", 10), 0)])).toBeUndefined();
  });

  it("keeps going on a full page when the server total is missing", () => {
    // total 0 must NOT read as "already complete" — the gantt walk guards this
    // the same way (fetchGanttIssues), otherwise a busy workspace truncates
    // after the first page.
    expect(nextIssuePageParam([page(ids("a", ISSUE_PAGE_SIZE), 0)])).toBe(
      ISSUE_PAGE_SIZE,
    );
  });

  it("is undefined with no pages", () => {
    expect(nextIssuePageParam([])).toBeUndefined();
  });
});

describe("hasMoreIssues", () => {
  it("is true while another page is reachable", () => {
    expect(hasMoreIssues([page(ids("a", 50), 120)])).toBe(true);
  });

  it("is false once the walk is done", () => {
    expect(hasMoreIssues([page(ids("a", 50), 50)])).toBe(false);
  });

  it("is false before the first page lands", () => {
    expect(hasMoreIssues([])).toBe(false);
  });
});

describe("showNoMoreIssues", () => {
  it("marks the end only for a list that actually paginated", () => {
    expect(
      showNoMoreIssues([page(ids("a", 50), 100), page(ids("b", 50), 100)]),
    ).toBe(true);
  });

  it("stays silent for a short list that fits in one page", () => {
    // A 12-row list is self-evidently complete; an "end of list" marker there
    // is noise. Threshold matches web's PAGINATED_THRESHOLD.
    expect(showNoMoreIssues([page(ids("a", 12), 12)])).toBe(false);
    expect(PAGINATED_THRESHOLD).toBe(50);
  });

  it("stays silent exactly at the threshold", () => {
    expect(showNoMoreIssues([page(ids("a", 50), 50)])).toBe(false);
  });

  it("stays silent while more pages remain", () => {
    expect(showNoMoreIssues([page(ids("a", 50), 120)])).toBe(false);
  });

  it("stays silent before the first page lands", () => {
    expect(showNoMoreIssues([])).toBe(false);
  });
});
