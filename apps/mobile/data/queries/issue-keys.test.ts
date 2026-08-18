/**
 * Query-key stability for the filtered issue lists (MYS-419). The key
 * carries the full window params bag — including the custom-property
 * record and the date band — so equality must be insensitive to the
 * insertion order of object keys and the order of array elements, or the
 * cache would refetch on every render.
 */
import { describe, expect, it } from "vitest";
import type { IssueStatus } from "@multica/core/types";
import { issueKeys, issueParamsKey } from "./issue-keys";

describe("issueParamsKey", () => {
  it("ignores array element order", () => {
    const a = {
      label_ids: ["x", "y"],
      statuses: ["todo"] as IssueStatus[],
    };
    const b = {
      statuses: ["todo"] as IssueStatus[],
      label_ids: ["y", "x"],
    };
    expect(issueParamsKey(a)).toBe(issueParamsKey(b));
  });

  it("normalizes object values (custom-property bags) by sorted keys", () => {
    const a = { properties: { "def-2": ["b"], "def-1": ["a", "c"] } };
    const b = { properties: { "def-2": ["b"], "def-1": ["c", "a"] } };
    expect(issueParamsKey(a)).toBe(issueParamsKey(b));
  });

  it("different property bags produce different keys", () => {
    const a = { properties: { "def-1": ["a"] } };
    const b = { properties: { "def-1": ["b"] } };
    expect(issueParamsKey(a)).not.toBe(issueParamsKey(b));
  });

  it("date band params stringify deterministically", () => {
    const band = {
      date_field: "created_at" as const,
      date_start: "2026-08-01T00:00:00.000Z",
      date_end: "2026-08-02T00:00:00.000Z",
    };
    expect(issueParamsKey(band)).toBe(
      issueParamsKey({ ...band, date_start: "2026-08-01T00:00:00.000Z" }),
    );
  });
});

describe("issueKeys.listFiltered", () => {
  it("keys differ when a custom-property filter is added", () => {
    const base = issueKeys.listFiltered("ws-1", { label_ids: ["l1"] });
    const withProp = issueKeys.listFiltered("ws-1", {
      label_ids: ["l1"],
      properties: { "def-1": ["a"] },
    });
    expect(base).not.toEqual(withProp);
  });

  it("stays stable across property-bag ordering", () => {
    const a = issueKeys.listFiltered("ws-1", {
      properties: { "def-2": ["b"], "def-1": ["a"] },
    });
    const b = issueKeys.listFiltered("ws-1", {
      properties: { "def-1": ["a"], "def-2": ["b"] },
    });
    expect(a).toEqual(b);
  });
});