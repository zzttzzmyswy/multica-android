import { describe, expect, it } from "vitest";
import type { InfiniteData } from "@tanstack/react-query";
import type { Issue } from "@multica/core/types";
import { makeIssuePage, type IssuePage } from "@/lib/issue-pagination";
import {
  mapIssueRows,
  readIssueRows,
  upsertIssueRow,
  type IssueListCache,
} from "./issue-list-cache";

function issue(id: string): Issue {
  return { id, title: id } as unknown as Issue;
}

function paginated(pages: IssuePage[]): InfiniteData<IssuePage, unknown> {
  return { pages, pageParams: pages.map((_, i) => i * 50) };
}

const TWO_PAGES = () =>
  paginated([
    makeIssuePage([issue("a"), issue("b")], 4),
    makeIssuePage([issue("c"), issue("d")], 4),
  ]);

describe("readIssueRows", () => {
  it("returns a flat cache as-is", () => {
    const flat = [issue("a")];
    expect(readIssueRows(flat)).toBe(flat);
  });

  it("flattens a paginated cache", () => {
    expect(readIssueRows(TWO_PAGES()).map((i) => i.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("is empty for an absent cache", () => {
    expect(readIssueRows(undefined)).toEqual([]);
  });
});

describe("mapIssueRows", () => {
  it("applies the transform to a flat cache", () => {
    const out = mapIssueRows([issue("a"), issue("b")], (rows) =>
      rows.filter((i) => i.id !== "a"),
    );
    expect((out as Issue[]).map((i) => i.id)).toEqual(["b"]);
  });

  it("applies the transform within each page of a paginated cache", () => {
    const out = mapIssueRows(TWO_PAGES(), (rows) =>
      rows.map((i) => ({ ...i, title: "x" })),
    ) as InfiniteData<IssuePage, unknown>;
    expect(out.pages.map((p) => p.issues.map((i) => i.title))).toEqual([
      ["x", "x"],
      ["x", "x"],
    ]);
  });

  it("leaves `fetched` alone — offsets must not follow a local row change", () => {
    const out = mapIssueRows(TWO_PAGES(), (rows) => [
      issue("new"),
      ...rows,
    ]) as InfiniteData<IssuePage, unknown>;
    expect(out.pages.map((p) => p.fetched)).toEqual([2, 2]);
  });

  it("returns undefined for an absent cache", () => {
    expect(mapIssueRows(undefined, (rows) => rows)).toBeUndefined();
  });
});

describe("upsertIssueRow", () => {
  it("prepends a row that is nowhere in the cache to the FIRST page only", () => {
    // The bug this guards: a per-page insert sees "not present" on every page
    // and adds the row to all of them. Dedupe hides it at render time, but the
    // cache carries N copies.
    const out = upsertIssueRow(TWO_PAGES(), issue("new"), "prepend") as
      InfiniteData<IssuePage, unknown>;
    expect(out.pages.map((p) => p.issues.map((i) => i.id))).toEqual([
      ["new", "a", "b"],
      ["c", "d"],
    ]);
  });

  it("appends a row that is nowhere in the cache to the FIRST page only", () => {
    const out = upsertIssueRow(TWO_PAGES(), issue("new"), "append") as
      InfiniteData<IssuePage, unknown>;
    expect(out.pages.map((p) => p.issues.map((i) => i.id))).toEqual([
      ["a", "b", "new"],
      ["c", "d"],
    ]);
  });

  it("replaces in place when the row already sits on a later page", () => {
    const out = upsertIssueRow(
      TWO_PAGES(),
      { id: "d", title: "updated" } as unknown as Issue,
      "append",
    ) as InfiniteData<IssuePage, unknown>;
    expect(out.pages.map((p) => p.issues.map((i) => i.title))).toEqual([
      ["a", "b"],
      ["c", "updated"],
    ]);
    // Not appended a second time.
    expect(out.pages[0].issues.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("handles a flat cache the same way", () => {
    const prepended = upsertIssueRow([issue("a")], issue("new"), "prepend");
    expect((prepended as Issue[]).map((i) => i.id)).toEqual(["new", "a"]);
    const replaced = upsertIssueRow(
      [issue("a")],
      { id: "a", title: "updated" } as unknown as Issue,
      "prepend",
    );
    expect((replaced as Issue[]).map((i) => i.title)).toEqual(["updated"]);
  });

  it("leaves `fetched` alone so pagination offsets stay on the server window", () => {
    const out = upsertIssueRow(TWO_PAGES(), issue("new"), "prepend") as
      InfiniteData<IssuePage, unknown>;
    expect(out.pages.map((p) => p.fetched)).toEqual([2, 2]);
    expect(out.pageParams).toEqual([0, 50]);
  });

  it("does nothing to an absent cache", () => {
    expect(upsertIssueRow(undefined, issue("new"), "prepend")).toBeUndefined();
  });
});
