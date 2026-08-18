/**
 * Unit tests for the pure status-options + custom-status helpers (MUL-6243).
 * The hooks wrap these with the live catalog; the group math is what makes
 * picker and filter agree with each other and with the catalog.
 */
import { describe, expect, it } from "vitest";
import type {
  IssueStatusEntry,
} from "@multica/core/types";
import {
  buildStatusOptionGroups,
  isCustomStatus,
} from "./status-options-core";
import {
  ISSUE_STATUS_CATEGORIES,
  buildIssueStatusCatalog,
  statusCategoryOfKey,
} from "./issue-status-catalog";

function entry(
  key: string,
  category: string,
  partial: Partial<IssueStatusEntry> = {},
): IssueStatusEntry {
  return {
    id: `id-${key}`,
    workspace_id: "ws-1",
    key,
    name: partial.name ?? key,
    description: "",
    category: category as IssueStatusEntry["category"],
    color: partial.color ?? "#123456",
    is_system: partial.is_system ?? false,
    position: partial.position ?? 0,
    archived_at: partial.archived_at ?? null,
    created_at: "2026-08-18T00:00:00Z",
    updated_at: "2026-08-18T00:00:00Z",
  };
}

const labelOf = (key: string) => `[${key}]`;

describe("buildStatusOptionGroups", () => {
  it("offers exactly the 7 built-ins when the catalog has no entries", () => {
    const { groups, options, hasCustom } = buildStatusOptionGroups(
      ISSUE_STATUS_CATEGORIES,
      [],
      labelOf,
    );
    expect(groups).toHaveLength(7);
    expect(groups.map((g) => g.options.length)).toEqual([
      1, 1, 1, 1, 1, 1, 1,
    ]);
    expect(options.map((o) => o.key)).toEqual(ISSUE_STATUS_CATEGORIES);
    expect(options.every((o) => o.color === null)).toBe(true);
    expect(hasCustom).toBe(false);
  });

  it("groups custom statuses under their category and colors them", () => {
    const entries = [
      entry("todo", "todo", { is_system: true }),
      entry("qa", "todo", { name: "QA" }),
      entry("human_review", "in_review", { name: "Human Review", color: "#ff0000" }),
    ];
    const { groups, options, hasCustom } = buildStatusOptionGroups(
      ISSUE_STATUS_CATEGORIES,
      entries,
      labelOf,
    );
    const todo = groups.find((g) => g.category === "todo")!;
    expect(todo.options.map((o) => o.key)).toEqual(["todo", "qa"]);
    expect(todo.options.map((o) => o.color)).toEqual([null, "#123456"]);
    const inReview = groups.find((g) => g.category === "in_review")!;
    expect(inReview.options).toEqual([
      expect.objectContaining({ key: "human_review", color: "#ff0000" }),
    ]);
    // The category label resolution is delegated to the caller — the option
    // label is whatever labelOf returns for the key.
    expect(options.find((o) => o.key === "qa")!.label).toBe("[qa]");
    expect(hasCustom).toBe(true);
  });

  it("excludes archived entries (composed with the catalog's activeStatuses)", () => {
    const catalog = buildIssueStatusCatalog([
      entry("todo", "todo", { is_system: true }),
      entry("old", "todo", { archived_at: "2026-01-01T00:00:00Z" }),
    ]);
    const { options, hasCustom } = buildStatusOptionGroups(
      ISSUE_STATUS_CATEGORIES,
      catalog.activeStatuses,
      labelOf,
    );
    expect(options.map((o) => o.key)).not.toContain("old");
    expect(hasCustom).toBe(false);
  });
});

describe("isCustomStatus", () => {
  const categoryOf = statusCategoryOfKey;

  it("is false for a built-in (with and without a catalog entry)", () => {
    expect(isCustomStatus(undefined, "in_progress", categoryOf)).toBe(false);
    expect(isCustomStatus(entry("todo", "todo", { is_system: true }), "todo", categoryOf)).toBe(false);
  });

  it("is true for a custom status with a catalog entry", () => {
    expect(isCustomStatus(entry("qa", "todo", { name: "QA" }), "qa", categoryOf)).toBe(true);
  });

  it("is false when the catalog has not resolved the key yet", () => {
    expect(isCustomStatus(undefined, "qa", categoryOf)).toBe(false);
  });
});