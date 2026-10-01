/**
 * `cardPropertyIds` resolution (iteration 189, MYS-1866).
 *
 * The three drop rules that make a configured id produce no chip are the
 * contract: unknown definition, no value on the issue, unrenderable value.
 * Each one is pinned here against web's board-card source.
 */
import { describe, expect, it, vi } from "vitest";

// The resolver renders values through `formatPropertyValue`, which reaches the
// app-locale formatter and its i18n store — same native shims as the sibling
// issue-properties suite so no RN module loads in the Node lane.
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

import type { IssueProperty } from "@multica/core/types";
import {
  CARD_PROPERTY_CHIP_LIMIT,
  cardPropertyChip,
  limitCardPropertyEntries,
  resolveCardPropertyEntries,
} from "./card-properties";
import { formatPropertyValue } from "./issue-properties";

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

const SELECT = property({
  id: "p-sel",
  name: "Stage",
  type: "select",
  config: {
    options: [
      { id: "o1", name: "Todo", color: "#3b82f6" },
      { id: "o2", name: "Done", color: "#22c55e" },
    ],
  },
});
const TEXT = property({ id: "p-text", name: "Notes", type: "text" });

describe("resolveCardPropertyEntries", () => {
  it("resolves in toggle order, not catalog order", () => {
    const entries = resolveCardPropertyEntries(
      ["p-text", "p-sel"],
      [SELECT, TEXT],
      { "p-sel": "o1", "p-text": "hello" },
    );
    expect(entries.map((e) => e.property.id)).toEqual(["p-text", "p-sel"]);
  });

  it("drops an id whose definition is not in the catalog", () => {
    // Web: `workspaceProperties.find(...)` → undefined, `.filter(p => !!p)`.
    const entries = resolveCardPropertyEntries(["p-gone"], [SELECT], {
      "p-gone": "o1",
    });
    expect(entries).toEqual([]);
  });

  it("drops an id the issue has no value for", () => {
    // Web: `.filter(p => issue.properties?.[p.id] !== undefined)`.
    expect(resolveCardPropertyEntries(["p-sel"], [SELECT], {})).toEqual([]);
    // An explicitly-set `false` checkbox IS a value — not `undefined`.
    const checkbox = property({ id: "p-cb", type: "checkbox" });
    expect(
      resolveCardPropertyEntries(["p-cb"], [checkbox], { "p-cb": false }),
    ).toHaveLength(1);
  });

  it("drops a value whose select option was deleted, instead of a raw UUID", () => {
    // Web's CustomPropertyValueDisplay returns the empty label for an unknown
    // option id; mobile's formatPropertyValue returns null → no chip.
    expect(
      resolveCardPropertyEntries(["p-sel"], [SELECT], { "p-sel": "ghost" }),
    ).toEqual([]);
  });

  it("drops an unparseable date rather than rendering garbage", () => {
    const date = property({ id: "p-date", type: "date" });
    expect(
      resolveCardPropertyEntries(["p-date"], [date], { "p-date": "not-a-date" }),
    ).toEqual([]);
    expect(
      resolveCardPropertyEntries(["p-date"], [date], { "p-date": "2026-08-16" }),
    ).toHaveLength(1);
  });

  it("keeps a multi_select with at least one surviving option", () => {
    const multi = property({
      id: "p-multi",
      type: "multi_select",
      config: {
        options: [
          { id: "o1", name: "A", color: "#111111" },
          { id: "o2", name: "B", color: "#222222" },
        ],
      },
    });
    // One id deleted, one alive → still a chip (dropping only the dead one).
    expect(
      resolveCardPropertyEntries(["p-multi"], [multi], { "p-multi": ["gone", "o1"] }),
    ).toHaveLength(1);
    // Every id deleted → no chip at all.
    expect(
      resolveCardPropertyEntries(["p-multi"], [multi], { "p-multi": ["gone"] }),
    ).toEqual([]);
  });

  it("carries the resolved display alongside the definition", () => {
    const entries = resolveCardPropertyEntries(["p-sel"], [SELECT], {
      "p-sel": "o1",
    });
    expect(entries[0].display).toEqual({
      kind: "option",
      option: { id: "o1", name: "Todo", color: "#3b82f6" },
    });
  });

  it("is empty for an empty id list, whatever the issue carries", () => {
    expect(
      resolveCardPropertyEntries([], [SELECT, TEXT], { "p-sel": "o1" }),
    ).toEqual([]);
  });
});

describe("limitCardPropertyEntries", () => {
  it("caps at the phone-height limit and counts the rest", () => {
    const entries = resolveCardPropertyEntries(
      ["p-text", "p-sel", "p-date", "p-cb"],
      [
        TEXT,
        SELECT,
        property({ id: "p-date", type: "date" }),
        property({ id: "p-cb", type: "checkbox" }),
      ],
      {
        "p-text": "hello",
        "p-sel": "o1",
        "p-date": "2026-08-16",
        "p-cb": true,
      },
    );
    expect(entries).toHaveLength(4);
    const { shown, rest } = limitCardPropertyEntries(entries);
    expect(shown).toHaveLength(CARD_PROPERTY_CHIP_LIMIT);
    expect(rest).toBe(1);
  });

  it("reports zero overflow when everything fits", () => {
    const { shown, rest } = limitCardPropertyEntries(
      resolveCardPropertyEntries(["p-text"], [TEXT], { "p-text": "hi" }),
    );
    expect(shown).toHaveLength(1);
    expect(rest).toBe(0);
  });
});

// The chip fold: one line per property on a 272pt card. Web paints a chip per
// multi_select option; mobile folds the tail into "+N" (the divergence is
// documented in lib/card-properties.ts).
describe("cardPropertyChip", () => {
  const t = (key: string) => (key === "properties.value.true" ? "Yes" : "No");

  it("maps a select option to its name + swatch color", () => {
    const display = formatPropertyValue(SELECT, "o2")!;
    expect(cardPropertyChip(display, t)).toEqual({
      text: "Done",
      color: "#22c55e",
    });
  });

  it("folds extra multi_select options into a rest count", () => {
    const multi = property({
      id: "p-multi",
      type: "multi_select",
      config: {
        options: [
          { id: "o1", name: "A", color: "#111111" },
          { id: "o2", name: "B", color: "#222222" },
          { id: "o3", name: "C", color: "#333333" },
        ],
      },
    });
    const display = formatPropertyValue(multi, ["o1", "o2", "o3"])!;
    expect(cardPropertyChip(display, t)).toEqual({
      text: "A",
      color: "#111111",
      rest: 2,
    });
    // A single option carries no rest key at all — the chip renders clean.
    const single = formatPropertyValue(multi, ["o2"])!;
    expect(cardPropertyChip(single, t)).toEqual({
      text: "B",
      color: "#222222",
    });
  });

  it("renders checkbox through the shared locale keys", () => {
    const checkbox = property({ id: "p-cb", type: "checkbox" });
    expect(cardPropertyChip(formatPropertyValue(checkbox, true)!, t)).toEqual({
      text: "Yes",
    });
    expect(cardPropertyChip(formatPropertyValue(checkbox, false)!, t)).toEqual({
      text: "No",
    });
  });

  it("passes date and plain text straight through", () => {
    const date = property({ id: "p-date", type: "date" });
    expect(cardPropertyChip(formatPropertyValue(date, "2026-08-16")!, t).text)
      .toBe("Aug 16");
    expect(cardPropertyChip(formatPropertyValue(TEXT, "hello")!, t)).toEqual({
      text: "hello",
    });
  });
});
