import { describe, expect, it } from "vitest";
import type { IssueProperty } from "@multica/core/types";
import {
  MAX_ACTIVE_PROPERTIES,
  filterPropertyCatalog,
  propertyHasOptions,
  propertyOptionChips,
} from "./property-catalog";

const TYPE_SELECT = "select";
const TYPE_TEXT = "text";

function p(overrides: Partial<IssueProperty> = {}): IssueProperty {
  return {
    id: "p1",
    workspace_id: "w1",
    name: "Severity",
    type: TYPE_SELECT,
    config: { options: [] },
    position: 0,
    archived: false,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

const options = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `o${i}`,
    name: `Option ${i}`,
    color: `#${i}23456`,
  }));

describe("propertyHasOptions", () => {
  it("is true only for select / multi_select", () => {
    expect(propertyHasOptions(p())).toBe(true);
    expect(propertyHasOptions(p({ type: "multi_select" }))).toBe(true);
    expect(propertyHasOptions(p({ type: TYPE_TEXT }))).toBe(false);
    expect(propertyHasOptions(p({ type: "date" }))).toBe(false);
  });
});

describe("filterPropertyCatalog", () => {
  const list = [
    p({ id: "a", name: "Severity", archived: false }),
    p({ id: "b", name: "Environment", archived: true }),
    p({ id: "c", name: "severity-tier", archived: false }),
  ];

  it("counts active (non-archived) properties regardless of filters", () => {
    expect(filterPropertyCatalog(list, { query: "", showArchived: true }).activeCount).toBe(2);
    expect(filterPropertyCatalog(list, { query: "severity", showArchived: false }).activeCount).toBe(2);
  });

  it("hides archived unless showArchived", () => {
    const hidden = filterPropertyCatalog(list, { query: "", showArchived: false });
    expect(hidden.visible.map((i) => i.id).sort()).toEqual(["a", "c"]);
    const shown = filterPropertyCatalog(list, { query: "", showArchived: true });
    expect(shown.visible).toHaveLength(3);
  });

  it("filters by case-insensitive trimmed name substring", () => {
    const r = filterPropertyCatalog(list, { query: "  SeVeRiTy ", showArchived: true });
    expect(r.visible.map((i) => i.id).sort()).toEqual(["a", "c"]);
    const none = filterPropertyCatalog(list, { query: "zzz", showArchived: true });
    expect(none.visible).toHaveLength(0);
  });
});

describe("propertyOptionChips", () => {
  it("returns up to the 6-chip cap with overflow count", () => {
    const r = propertyOptionChips(p({ config: { options: options(8) } }));
    expect(r.chips).toHaveLength(6);
    expect(r.rest).toBe(2);
  });

  it("no overflow when at or under the cap", () => {
    const r = propertyOptionChips(p({ config: { options: options(6) } }));
    expect(r.chips).toHaveLength(6);
    expect(r.rest).toBe(0);
  });

  it("empty for optionless properties and missing config", () => {
    expect(propertyOptionChips(p({ config: { options: [] } })).chips).toHaveLength(0);
    expect(propertyOptionChips(p({ type: TYPE_TEXT })).rest).toBe(0);
  });
});

describe("MAX_ACTIVE_PROPERTIES", () => {
  it("matches web cap of 20", () => {
    expect(MAX_ACTIVE_PROPERTIES).toBe(20);
  });
});