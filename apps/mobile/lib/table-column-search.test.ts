import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  normalizeColumnQuery,
  searchTableColumns,
  type SearchableColumn,
  type SearchableProperty,
} from "./table-column-search";

const COLUMNS: SearchableColumn[] = [
  { key: "title", label: "标题" },
  { key: "identifier", label: "编号" },
  { key: "status", label: "状态" },
  { key: "start_date", label: "开始日期" },
  { key: "due_date", label: "截止日期" },
  { key: "created_at", label: "创建时间" },
];

const PROPERTIES: SearchableProperty[] = [
  { id: "p1", name: "客户" },
  { id: "p2", name: "Severity" },
  { id: "p3", name: "发布日期" },
];

describe("normalizeColumnQuery", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeColumnQuery("  日期  ")).toBe("日期");
  });

  it("folds case so an English property matches typed either way", () => {
    expect(normalizeColumnQuery("SEVERITY")).toBe("severity");
  });

  it("treats whitespace-only as empty", () => {
    expect(normalizeColumnQuery("   ")).toBe("");
  });
});

describe("locale parity with web", () => {
  // Web folds with `toLocaleLowerCase()` (`table-view.tsx:501`), not
  // `toLowerCase()`. Under the CI's default (English) locale the two produce
  // identical output, so no behavioural assertion can tell them apart here —
  // the difference only appears on a device whose default locale is Turkish
  // or Azerbaijani (`I` → `ı`). This is therefore a SOURCE guard, and it is
  // labelled as one rather than dressed up as a behavioural test.
  it("normalizes with toLocaleLowerCase, as web does", () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "table-column-search.ts"),
      "utf8",
    );
    expect(source).toMatch(/\.toLocaleLowerCase\(\)/);
    expect(source).not.toMatch(/\.toLowerCase\(\)/);
  });
});

describe("searchTableColumns", () => {
  it("returns everything for an empty query", () => {
    const result = searchTableColumns(COLUMNS, PROPERTIES, "");
    expect(result.columns).toHaveLength(COLUMNS.length);
    expect(result.properties).toHaveLength(PROPERTIES.length);
    expect(result.empty).toBe(false);
  });

  it("returns everything for a whitespace-only query", () => {
    const result = searchTableColumns(COLUMNS, PROPERTIES, " \t ");
    expect(result.columns).toHaveLength(COLUMNS.length);
    expect(result.properties).toHaveLength(PROPERTIES.length);
  });

  it("matches BOTH system columns and properties on one query", () => {
    // "日期" hits three system columns and one property name. Filtering only
    // one section (the half-port this module exists to prevent) would drop
    // either the columns or the property here.
    const result = searchTableColumns(COLUMNS, PROPERTIES, "日期");
    expect(result.columns.map((c) => c.key)).toEqual([
      "start_date",
      "due_date",
    ]);
    expect(result.properties.map((p) => p.id)).toEqual(["p3"]);
  });

  it("matches a property name case-insensitively", () => {
    const lower = searchTableColumns(COLUMNS, PROPERTIES, "severity");
    const upper = searchTableColumns(COLUMNS, PROPERTIES, "SEVERITY");
    expect(lower.properties.map((p) => p.id)).toEqual(["p2"]);
    expect(upper.properties.map((p) => p.id)).toEqual(["p2"]);
  });

  it("matches a substring, not just a prefix", () => {
    const result = searchTableColumns(COLUMNS, PROPERTIES, "止日");
    expect(result.columns.map((c) => c.key)).toEqual(["due_date"]);
  });

  it("reports empty when neither section matches", () => {
    const result = searchTableColumns(COLUMNS, PROPERTIES, "zzz-nothing");
    expect(result.columns).toEqual([]);
    expect(result.properties).toEqual([]);
    expect(result.empty).toBe(true);
  });

  it("does not report empty when only one section matches", () => {
    // "状态" hits a system column and no property. The sheet must render the
    // system section and simply omit the property section — not show the
    // "nothing matched" note.
    const result = searchTableColumns(COLUMNS, PROPERTIES, "状态");
    expect(result.columns.map((c) => c.key)).toEqual(["status"]);
    expect(result.properties).toEqual([]);
    expect(result.empty).toBe(false);
  });

  it("never mutates its inputs", () => {
    const columns = [...COLUMNS];
    const properties = [...PROPERTIES];
    searchTableColumns(columns, properties, "日期");
    expect(columns).toEqual(COLUMNS);
    expect(properties).toEqual(PROPERTIES);
  });

  it("handles a workspace with no custom properties", () => {
    const result = searchTableColumns(COLUMNS, [], "日期");
    expect(result.columns.map((c) => c.key)).toEqual([
      "start_date",
      "due_date",
    ]);
    expect(result.properties).toEqual([]);
    expect(result.empty).toBe(false);
  });

  it("handles an empty catalog on both sides", () => {
    expect(searchTableColumns([], [], "").empty).toBe(true);
    expect(searchTableColumns([], [], "x").empty).toBe(true);
  });
});
