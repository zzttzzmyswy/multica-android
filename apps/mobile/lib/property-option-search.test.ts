import { describe, expect, it, vi } from "vitest";

// `issue-properties` (imported transitively) formats dates through the
// app-locale formatter, which pulls in the i18n store — the same shims the
// other locale-touching suites use so the native modules never load.
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

import type { IssueProperty, IssuePropertyOption } from "@multica/core/types";
import {
  PROPERTY_OPTION_SEARCH_THRESHOLD,
  filterPropertyOptions,
  hasNoPropertyOptionMatch,
  shouldSearchPropertyOptions,
} from "./property-option-search";

const option = (id: string, name: string): IssuePropertyOption =>
  ({ id, name, color: "#888888" }) as IssuePropertyOption;

const options = (...names: string[]): IssuePropertyOption[] =>
  names.map((name, i) => option(`opt-${i}`, name));

const propertyWith = (
  type: string,
  opts: IssuePropertyOption[],
): IssueProperty =>
  ({
    id: "prop-1",
    workspace_id: "ws-1",
    name: "Stage",
    type,
    config: { options: opts },
    created_at: "",
    updated_at: "",
  }) as unknown as IssueProperty;

describe("shouldSearchPropertyOptions", () => {
  it("uses web's literal threshold: more than 7 options", () => {
    // Web: `searchable={options.length > 7}` on both the select and
    // multi_select branches. Pinned as an exact number so a future edit has to
    // state a reason rather than drift a boundary.
    expect(PROPERTY_OPTION_SEARCH_THRESHOLD).toBe(7);
  });

  it("hides the field at exactly the threshold", () => {
    expect(
      shouldSearchPropertyOptions(propertyWith("select", options(...Array(7).fill("a")))),
    ).toBe(false);
  });

  it("shows the field one past the threshold", () => {
    expect(
      shouldSearchPropertyOptions(propertyWith("select", options(...Array(8).fill("a")))),
    ).toBe(true);
  });

  it("reads the options out of the property config, not a caller argument", () => {
    // A signature that took the list would let one branch pass the unfiltered
    // set and another the filtered one, so the two shapes disagree about when
    // the field appears.
    expect(
      shouldSearchPropertyOptions(propertyWith("multi_select", options(...Array(9).fill("x")))),
    ).toBe(true);
  });

  it("says no for a property with no options at all", () => {
    expect(shouldSearchPropertyOptions(propertyWith("select", []))).toBe(false);
  });
});

describe("filterPropertyOptions", () => {
  const list = options("Backend", "Frontend", "Design", "后端", "前端");

  it("returns everything for an empty query", () => {
    expect(filterPropertyOptions(list, "")).toHaveLength(list.length);
  });

  it("treats a whitespace-only query as empty rather than matching nothing", () => {
    // A stray space from the keyboard must not blank the picker — the same
    // rule the table column picker follows.
    expect(filterPropertyOptions(list, "   ")).toHaveLength(list.length);
  });

  it("matches a case-insensitive substring of the name", () => {
    const got = filterPropertyOptions(list, "end");
    expect(got.map((o) => o.name)).toEqual(["Backend", "Frontend"]);
  });

  it("matches pinyin initials for a Chinese option name", () => {
    // `matchesNameOrPinyin` is the shared name predicate; using a bare
    // `toLowerCase().includes()` here would force Chinese users to type the
    // exact characters.
    const got = filterPropertyOptions(list, "hd");
    expect(got.map((o) => o.name)).toEqual(["后端"]);
  });

  it("matches the literal Chinese text too", () => {
    expect(filterPropertyOptions(list, "前端").map((o) => o.name)).toEqual([
      "前端",
    ]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterPropertyOptions(list, "zzzz")).toEqual([]);
  });

  it("does not match against the option id", () => {
    // Ids are opaque (`opt-0` …); matching them would surface rows whose
    // visible text has nothing to do with what was typed.
    expect(filterPropertyOptions(list, "opt-1")).toEqual([]);
  });

  it("does not mutate the input", () => {
    const before = list.map((o) => o.id);
    filterPropertyOptions(list, "end");
    expect(list.map((o) => o.id)).toEqual(before);
  });
});

describe("hasNoPropertyOptionMatch", () => {
  it("flags an empty result", () => {
    expect(hasNoPropertyOptionMatch(0)).toBe(true);
  });

  it("does not flag a populated result", () => {
    expect(hasNoPropertyOptionMatch(1)).toBe(false);
  });
});
