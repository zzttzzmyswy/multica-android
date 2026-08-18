/**
 * Unit tests for the pure issue-status catalog layer (MUL-6243):
 * category resolution, catalog building and category-folded grouping.
 *
 * This module deliberately imports NO i18n/expo so the suite stays in the
 * "pure helper" lane (see vitest.config.ts) — the i18n-aware label lookup
 * lives in the status-options hook (Task 4).
 */
import { describe, expect, it } from "vitest";
import type {
  Issue,
  IssueStatus,
  IssueStatusCategory,
  IssueStatusEntry,
} from "@multica/core/types";
import {
  ISSUE_STATUS_CATEGORIES,
  buildIssueStatusCatalog,
  compareIssueStatusEntries,
  isIssueStatusCategory,
  issueStatusCategoryOfIssue,
  normalizeStatusPatch,
  statusCategoryOfKey,
  type IssueStatusCatalog,
} from "./issue-status-catalog";
import { groupIssues } from "./filter-issues";

const BOARD_STATUSES: IssueStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
];

function entry(
  key: string,
  category: string,
  name = key,
  archivedAt: string | null = null,
  isSystem = false,
): IssueStatusEntry {
  return {
    id: key,
    workspace_id: "ws-1",
    key,
    name,
    description: "",
    category: category as IssueStatusCategory,
    color: "#123456",
    is_system: isSystem,
    position: 0,
    archived_at: archivedAt,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function issue(partial: Partial<Issue>): Issue {
  const { id = "x" } = partial;
  return {
    id,
    title: partial.title ?? `Issue ${id}`,
    identifier: partial.identifier ?? `MYS-${id}`,
    number: partial.number ?? 1,
    status: partial.status ?? "todo",
    priority: partial.priority ?? "none",
    position: partial.position ?? 0,
    created_at: partial.created_at ?? "2026-01-01T00:00:00Z",
    updated_at: partial.updated_at ?? "2026-01-01T00:00:00Z",
    assignee_type: partial.assignee_type ?? null,
    assignee_id: partial.assignee_id ?? null,
    creator_type: partial.creator_type ?? "member",
    creator_id: partial.creator_id ?? "me",
    status_category: partial.status_category,
    project_id: partial.project_id ?? null,
    labels: partial.labels ?? [],
    properties: partial.properties ?? {},
  } as Issue;
}

describe("category helpers", () => {
  it("classifies the 7 built-in keys as categories", () => {
    for (const key of ISSUE_STATUS_CATEGORIES) {
      expect(isIssueStatusCategory(key)).toBe(true);
      expect(statusCategoryOfKey(key)).toBe(key);
    }
    expect(isIssueStatusCategory("custom_key")).toBe(false);
    expect(isIssueStatusCategory("")).toBe(false);
  });

  it("falls a custom status key back to todo for presentation", () => {
    expect(statusCategoryOfKey("human_review")).toBe("todo");
  });

  it("resolves an issue's category from status_category, then built-in key", () => {
    // Server backfill wins when present and sane.
    expect(
      issueStatusCategoryOfIssue({ status: "qa_done", status_category: "done" }),
    ).toBe("done");
    // A valid status_category overrides even a built-in status.
    expect(
      issueStatusCategoryOfIssue({ status: "todo", status_category: "in_review" }),
    ).toBe("in_review");
    // No status_category → a built-in key is its own category.
    expect(issueStatusCategoryOfIssue({ status: "in_progress" })).toBe("in_progress");
    // Stale status_category that is not a category is ignored.
    expect(
      issueStatusCategoryOfIssue({
        status: "todo",
        status_category: "not-a-category" as never,
      }),
    ).toBe("todo");
    // Unresolvable custom key → null.
    expect(issueStatusCategoryOfIssue({ status: "qa_custom" })).toBeNull();
  });

  it("normalizes status_category on a status change", () => {
    expect(normalizeStatusPatch({})).toEqual({});
    expect(normalizeStatusPatch({ title: "x" })).toEqual({ title: "x" });
    expect(normalizeStatusPatch({ status: "done" })).toEqual({
      status: "done",
      status_category: "done",
    });
    // Custom key with a patch-declared category keeps it; without one the
    // inherited value is dropped rather than trusted.
    expect(
      normalizeStatusPatch({ status: "qa_custom", status_category: "todo" }),
    ).toEqual({ status: "qa_custom", status_category: "todo" });
    expect(
      normalizeStatusPatch({ status: "qa_custom" }),
    ).toEqual({ status: "qa_custom", status_category: undefined });
  });
});

describe("buildIssueStatusCatalog", () => {
  it("resolves every built-in with no catalog loaded", () => {
    const c = buildIssueStatusCatalog(undefined);
    expect(c.isLoaded).toBe(false);
    expect(c.isPending).toBe(true);
    expect(c.hasCustomStatuses).toBe(false);
    expect(c.statuses).toEqual([]);
    expect(c.activeStatuses).toEqual([]);
    for (const key of ISSUE_STATUS_CATEGORIES) {
      expect(c.categoryOf(key)).toBe(key);
      expect(c.labelOf(key)).toBeDefined();
    }
    expect(c.labelOf("in_review")).toBe("In Review");
    expect(c.labelOf("unknown_custom")).toBe("unknown_custom");
    expect(c.categoryOf("unknown_custom")).toBe("todo");
    expect(c.entryOf("backlog")).toBeUndefined();
  });

  it("maps a custom status to its category, name and color", () => {
    const c = buildIssueStatusCatalog([entry("human_review", "in_review", "Human Review")]);
    expect(c.categoryOf("human_review")).toBe("in_review");
    expect(c.labelOf("human_review")).toBe("Human Review");
    expect(c.entryOf("human_review")?.color).toBe("#123456");
    expect(c.isLoaded).toBe(true);
    expect(c.hasCustomStatuses).toBe(true);
  });

  it("excludes archived statuses from activeStatuses but keeps them in statuses", () => {
    const archived = entry("obsolete", "todo", "Obsolete", "2026-01-01T00:00:00Z", false);
    const c = buildIssueStatusCatalog([archived, entry("live", "todo", "Live")]);
    expect(c.statuses.map((s) => s.key)).toEqual(["obsolete", "live"]);
    expect(c.activeStatuses.map((s) => s.key)).toEqual(["live"]);
    expect(c.inCategory("todo").map((s) => s.key)).toEqual(["live"]);
    // An issue still on the archived status keeps its real name/category.
    expect(c.categoryOf("obsolete")).toBe("todo");
    expect(c.labelOf("obsolete")).toBe("Obsolete");
  });

  it("isError only when the request failed with no snapshot behind it", () => {
    const failed = buildIssueStatusCatalog(undefined, { isPending: false, isError: true });
    expect(failed.isError).toBe(true);
    // A background refetch failure with entries behind it is stale-data, not blocking.
    const stale = buildIssueStatusCatalog([entry("todo", "todo")], { isError: true });
    expect(stale.isError).toBe(false);
  });

  it("treats a loaded catalog with only system entries as having no custom statuses", () => {
    const c = buildIssueStatusCatalog([
      entry("todo", "todo", "Todo", null, true),
      entry("done", "done", "Done", null, true),
    ]);
    expect(c.hasCustomStatuses).toBe(false);
  });

  it("sorts entries by category rank, then position, then key", () => {
    const entries = [
      entry("zz_banana", "done", "B"),
      entry("todo_old", "todo", "A"),
      entry("aa_prefix", "done", "A"),
      entry("in_progress_x", "in_progress", "C"),
    ];
    const sorted = [...entries].sort(compareIssueStatusEntries);
    expect(sorted.map((e) => e.key)).toEqual([
      "todo_old", // todo ranks before in_progress
      "in_progress_x",
      "aa_prefix", // done: position ties → key asc
      "zz_banana",
    ]);
  });

  it("builds catalog from an empty list as loaded with no custom statuses", () => {
    const c = buildIssueStatusCatalog([]);
    expect(c.isLoaded).toBe(true);
    expect(c.hasCustomStatuses).toBe(false);
    expect(c.categoryOf("todo")).toBe("todo");
    // An empty-but-loaded catalog still cannot resolve a custom key.
    expect(c.categoryOf("qa_thing")).toBe("todo");
  });
});

describe("groupIssues category folding", () => {
  it("is byte-identical to key grouping when there are no custom statuses", () => {
    const issues = [
      issue({ id: "a", status: "done" }),
      issue({ id: "b", status: "todo" }),
      issue({ id: "c", status: "done" }),
    ];
    const plain = groupIssues(issues, "status", BOARD_STATUSES);
    expect(plain.map((s) => s.key)).toEqual(["todo", "done"]);
    expect(plain.map((s) => s.data.map((i) => i.id))).toEqual([["b"], ["a", "c"]]);
    expect(plain.map((s) => s.status)).toEqual(["todo", "done"]);
  });

  it("folds issues on a custom status into their category column", () => {
    const qa = issue({ id: "q", status: "qa", status_category: "todo" });
    const normalTodo = issue({ id: "t", status: "todo", status_category: "todo" });
    // Board keeps empty columns.
    const sections = groupIssues(
      [qa, normalTodo],
      "status",
      BOARD_STATUSES,
      true,
      issueStatusCategoryOfIssue,
    );
    const todoSection = sections.find((s) => s.key === "todo")!;
    expect(todoSection.data.map((i) => i.id)).toEqual(["q", "t"]);
    // A custom status never creates its own column when the catalog resolves it.
    expect(sections.some((s) => s.key === "qa")).toBe(false);
  });

  it("keeps an unresolved custom status out of the fixed columns", () => {
    const orphan = issue({ id: "o", status: "qa_custom" });
    const sections = groupIssues(
      [orphan],
      "status",
      BOARD_STATUSES,
      false,
      issueStatusCategoryOfIssue,
    );
    // Pre-catalog contract: unknown keys never gain a column, so the orphan
    // renders in no section (board/list only show the fixed statusOrder).
    expect(sections).toEqual([]);
    // Same for board mode with includeEmpty — still only the 6 fixed columns.
    const board = groupIssues(
      [orphan],
      "status",
      BOARD_STATUSES,
      true,
      issueStatusCategoryOfIssue,
    );
    expect(board).toHaveLength(BOARD_STATUSES.length);
    expect(board.some((s) => s.key === "qa_custom")).toBe(false);
  });

  it("excludes cancelled from board status order (unchanged column contract)", () => {
    const cancelled = issue({ id: "c", status: "cancelled", status_category: "cancelled" });
    const sections = groupIssues([cancelled], "status", BOARD_STATUSES);
    expect(sections).toEqual([]);
  });
});