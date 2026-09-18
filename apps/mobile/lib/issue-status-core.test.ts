/**
 * Guards the issue list / board / swimlane column order against web's source
 * of truth.
 *
 * `lib/issue-status-core.ts` is a MIRROR of
 * `packages/core/issues/config/status.ts` — mobile keeps its own copy so it
 * does not pull web's Tailwind colour tokens into the RN bundle. A mirror
 * drifts unless something compares it, so this suite imports BOTH sides and
 * asserts they are equal. Web adding or removing a lifecycle status fails
 * here instead of silently dropping those issues out of mobile's surfaces.
 *
 * The surfaces themselves are covered too: an order that is correct as data
 * but never reaches `groupIssues` / `buildSwimlaneLanes` would still hide the
 * column, which is the failure this whole file exists to catch.
 */
import { describe, expect, it } from "vitest";
import type { Issue } from "@multica/core/types";
import { STATUS_ORDER } from "@multica/core/issues/config/status";
import { BOARD_STATUSES } from "./issue-status-core";
import { ISSUE_STATUS_CATEGORIES } from "./issue-status-catalog";
import { groupIssues } from "./filter-issues";
import { buildSwimlaneLanes } from "./swimlane";

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
    creator_type: partial.creator_type,
    creator_id: partial.creator_id,
    parent_issue_id: partial.parent_issue_id ?? null,
    project_id: partial.project_id ?? null,
    labels: partial.labels,
    properties: partial.properties,
    start_date: partial.start_date,
    due_date: partial.due_date,
  } as Issue;
}

const cancelled = () =>
  issue({ id: "c", status: "cancelled", status_category: "cancelled" });

describe("BOARD_STATUSES mirrors web's canonical status order", () => {
  it("equals packages/core's STATUS_ORDER, cancelled included", () => {
    expect(BOARD_STATUSES).toEqual(STATUS_ORDER);
  });

  it("orders cancelled last, where web puts it", () => {
    expect(BOARD_STATUSES[BOARD_STATUSES.length - 1]).toBe("cancelled");
  });

  it("covers every category the catalog can resolve an issue into", () => {
    expect([...BOARD_STATUSES].sort()).toEqual(
      [...ISSUE_STATUS_CATEGORIES].sort(),
    );
  });
});

describe("cancelled renders in every status-grouped surface", () => {
  it("groupIssues gives a cancelled issue a section of its own", () => {
    const sections = groupIssues([cancelled()], "status", BOARD_STATUSES);
    expect(sections.map((s) => s.key)).toEqual(["cancelled"]);
    expect(sections[0]!.data.map((i) => i.id)).toEqual(["c"]);

    const filtered = groupIssues(
      [cancelled(), issue({ id: "t", status: "todo" })],
      "status",
      BOARD_STATUSES,
    );
    expect(filtered.map((s) => s.key)).toEqual(["todo", "cancelled"]);
  });

  it("board mode keeps cancelled as the trailing column", () => {
    const columns = groupIssues([], "status", BOARD_STATUSES, true);
    expect(columns.map((c) => c.key)).toEqual([...BOARD_STATUSES]);
    expect(columns[columns.length - 1]!.key).toBe("cancelled");
  });

  it("buildSwimlaneLanes keeps cancelled issues instead of dropping them", () => {
    const lanes = buildSwimlaneLanes({
      issues: [cancelled()],
      grouping: "assignee",
      statusOrder: BOARD_STATUSES,
    });
    const total = lanes.reduce((n, l) => n + l.total, 0);
    expect(total).toBe(1);
    const cell = lanes
      .flatMap((l) => l.cells)
      .find((c) => c.status === "cancelled");
    expect(cell?.issues.map((i) => i.id)).toEqual(["c"]);
  });
});
