import { describe, expect, it } from "vitest";
import type { IssueProperty } from "@multica/core/types";
import {
  DEFAULT_PROPERTY_OPTION_COLOR,
  PROPERTY_OPTION_COLOR_PRESETS,
  findSelectOption,
  formatPropertyValue,
  isKnownPropertyType,
  propertyOptions,
  propertyTypeHasOptions,
  propertyTypeIcon,
  propertyTypeLabelKey,
  resolveMultiSelectOptions,
} from "./issue-properties";

function property(overrides: Partial<IssueProperty> = {}): IssueProperty {
  return {
    id: "p1",
    workspace_id: "w1",
    name: "Status",
    type: "select",
    description: "",
    icon: "",
    config: { options: [] },
    position: 0,
    archived: false,
    usage_count: 0,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

const options = [
  { id: "o1", name: "Todo", color: "#3b82f6" },
  { id: "o2", name: "Done", color: "#22c55e" },
];

describe("isKnownPropertyType", () => {
  it("accepts every shipped type", () => {
    for (const type of ["text", "number", "select", "multi_select", "date", "checkbox", "url"]) {
      expect(isKnownPropertyType(type)).toBe(true);
    }
  });
  it("rejects unknown types and undefined", () => {
    expect(isKnownPropertyType("actor")).toBe(false);
    expect(isKnownPropertyType("")).toBe(false);
    expect(isKnownPropertyType(undefined)).toBe(false);
  });
});

describe("propertyTypeHasOptions", () => {
  it("only select/multi_select carry options", () => {
    expect(propertyTypeHasOptions("select")).toBe(true);
    expect(propertyTypeHasOptions("multi_select")).toBe(true);
    expect(propertyTypeHasOptions("text")).toBe(false);
    expect(propertyTypeHasOptions(undefined)).toBe(false);
  });
});

describe("propertyTypeLabelKey / propertyTypeIcon", () => {
  it("maps known types to their key and glyph", () => {
    expect(propertyTypeLabelKey("select")).toBe("properties.type.select");
    expect(propertyTypeLabelKey("date")).toBe("properties.type.date");
    expect(propertyTypeIcon("select")).toBe("chevron-down-circle");
    expect(propertyTypeIcon("url")).toBe("link");
  });
  it("falls back for unknown or missing types", () => {
    expect(propertyTypeLabelKey("actor")).toBe("properties.type.unknown");
    expect(propertyTypeLabelKey(undefined)).toBe("properties.type.unknown");
    expect(propertyTypeIcon("actor")).toBe("cube-outline");
    expect(propertyTypeIcon(undefined)).toBe("cube-outline");
  });
});

describe("option resolution", () => {
  it("propertyOptions unwraps the config bag", () => {
    expect(propertyOptions(property({ config: { options } }))).toEqual(options);
    expect(propertyOptions(property())).toEqual([]);
  });
  it("findSelectOption resolves a known id and ignores non-strings", () => {
    const p = property({ config: { options } });
    expect(findSelectOption(p, "o2")).toEqual(options[1]);
    expect(findSelectOption(p, "ghost")).toBeUndefined();
    expect(findSelectOption(p, 3)).toBeUndefined();
    expect(findSelectOption(p, undefined)).toBeUndefined();
  });
  it("resolveMultiSelectOptions keeps only known ids, in catalog order", () => {
    const p = property({ config: { options } });
    expect(resolveMultiSelectOptions(p, ["o2", "o1", "ghost"])).toEqual([
      options[0],
      options[1],
    ]);
    expect(resolveMultiSelectOptions(p, [])).toEqual([]);
    expect(resolveMultiSelectOptions(p, "o2")).toEqual([]);
    expect(resolveMultiSelectOptions(p, undefined)).toEqual([]);
  });
});

describe("formatPropertyValue", () => {
  it("returns null for an unset value", () => {
    const p = property({ config: { options } });
    expect(formatPropertyValue(p, undefined)).toBeNull();
  });

  it("select: resolves to the option, null when the id vanished", () => {
    const p = property({ type: "select", config: { options } });
    expect(formatPropertyValue(p, "o1")).toEqual({
      kind: "option",
      option: options[0],
    });
    expect(formatPropertyValue(p, "ghost")).toBeNull();
  });

  it("multi_select: resolves known options, null when none survive", () => {
    const p = property({ type: "multi_select", config: { options } });
    expect(formatPropertyValue(p, ["o1", "o2"])).toEqual({
      kind: "options",
      options,
    });
    expect(formatPropertyValue(p, ["ghost"])).toBeNull();
    expect(formatPropertyValue(p, "o1")).toBeNull();
  });

  it("checkbox: normalizes to a boolean", () => {
    const p = property({ type: "checkbox" });
    expect(formatPropertyValue(p, true)).toEqual({ kind: "checkbox", value: true });
    expect(formatPropertyValue(p, false)).toEqual({ kind: "checkbox", value: false });
  });

  it("date: formats the day, null when unparseable", () => {
    const p = property({ type: "date" });
    expect(formatPropertyValue(p, "2026-08-16")).toEqual({
      kind: "date",
      text: "Aug 16",
    });
    expect(formatPropertyValue(p, "not-a-date")).toBeNull();
    expect(formatPropertyValue(p, 42)).toBeNull();
  });

  it("plain types stringify raw values (incl. unknown server types)", () => {
    expect(formatPropertyValue(property({ type: "text" }), "hello")).toEqual({
      kind: "plain",
      text: "hello",
    });
    expect(formatPropertyValue(property({ type: "number" }), 42)).toEqual({
      kind: "plain",
      text: "42",
    });
    expect(formatPropertyValue(property({ type: "url" }), "https://a.io")).toEqual({
      kind: "plain",
      text: "https://a.io",
    });
    // Forward-compat: a type this build doesn't know degrades to raw text.
    expect(formatPropertyValue(property({ type: "actor" }), "a-9")).toEqual({
      kind: "plain",
      text: "a-9",
    });
  });
});

describe("palette", () => {
  it("exposes the 10-swatch presets with a deterministic default", () => {
    expect(PROPERTY_OPTION_COLOR_PRESETS.length).toBe(10);
    expect(PROPERTY_OPTION_COLOR_PRESETS).toContain(DEFAULT_PROPERTY_OPTION_COLOR);
  });
});