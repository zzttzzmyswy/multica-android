/**
 * `columnCreateDefaults` — what a board lane's "+" pre-fills. Web parity
 * target: `BoardColumnGroup.createData` (board-column.tsx:75-88, built in
 * board-view.tsx at :83 and :120-136), consumed by
 * `onCreateIssue(group.createData)` at board-column.tsx:226-246.
 *
 * The bug this guards against is a column whose "+" opens a plain new-issue
 * form: the user tapped a specific lane and the issue must land in it.
 */
import { describe, expect, it } from "vitest";
import { columnCreateDefaults, type IssueGroupSection } from "./filter-issues";

function section(partial: Partial<IssueGroupSection>): IssueGroupSection {
  return {
    key: partial.key ?? "k",
    data: [],
    unassigned: partial.unassigned ?? false,
    ...partial,
  };
}

describe("columnCreateDefaults", () => {
  it("seeds the status for a status lane", () => {
    expect(
      columnCreateDefaults(section({ key: "status:in_progress", status: "in_progress" })),
    ).toEqual({ status: "in_progress" });
  });

  it("seeds the assignee for an assignee lane", () => {
    expect(
      columnCreateDefaults(
        section({
          key: "assignee:agent:ag-1",
          assigneeType: "agent",
          assigneeId: "ag-1",
        }),
      ),
    ).toEqual({ assignee: { type: "agent", id: "ag-1" } });
  });

  it("seeds member and squad lanes the same way", () => {
    expect(
      columnCreateDefaults(
        section({ assigneeType: "member", assigneeId: "u-1" }),
      ),
    ).toEqual({ assignee: { type: "member", id: "u-1" } });
    expect(
      columnCreateDefaults(section({ assigneeType: "squad", assigneeId: "s-1" })),
    ).toEqual({ assignee: { type: "squad", id: "s-1" } });
  });

  it("returns null for the 'No assignee' lane", () => {
    // The lane cannot express an assignee, so it must not pin one — web
    // sends `{assignee_type: null, assignee_id: null}` here, which the create
    // API reads as "unassigned"; the draft store already defaults to null.
    expect(columnCreateDefaults(section({ key: "none", unassigned: true }))).toBe(
      null,
    );
  });

  it("returns null when the lane carries neither axis", () => {
    expect(columnCreateDefaults(section({}))).toBe(null);
  });

  it("prefers the status when a section somehow carries both", () => {
    // Status and assignee lanes are separate groupings, so this cannot arise
    // from groupIssues — but a half-typed section must resolve
    // deterministically rather than by object key order.
    expect(
      columnCreateDefaults(
        section({
          status: "todo",
          assigneeType: "agent",
          assigneeId: "ag-1",
        }),
      ),
    ).toEqual({ status: "todo" });
  });

  it("ignores a half-formed assignee (type without id)", () => {
    // An id-less lane would otherwise create an issue assigned to nobody
    // while claiming to be seeded from a lane.
    expect(
      columnCreateDefaults(section({ assigneeType: "agent" })),
    ).toBe(null);
  });
});
