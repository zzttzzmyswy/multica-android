/**
 * Parent/child hierarchy derivation for the mobile issue table (MYS-1149).
 * Web receives `depth` / `hasChildren` / `collapsed` as server branch fields;
 * mobile derives them from `parent_issue_id` over the loaded window, so the
 * interesting cases are the ones the server used to guarantee: a chain that
 * leaves the window, a collapsed ancestor pruning a whole subtree, and
 * corrupted parent links that must not hang the render.
 */
import { describe, expect, it } from "vitest";
import type { Issue } from "@multica/core/types";
import { MAX_DEPTH, buildIssueTableRows } from "./issue-table-hierarchy";

function issue(id: string, parentId: string | null = null): Issue {
  return {
    id,
    identifier: `MYS-${id.toUpperCase()}`,
    title: `issue ${id}`,
    status: "todo",
    priority: "medium",
    assignee_type: null,
    assignee_id: null,
    parent_issue_id: parentId,
  } as Issue;
}

/** Compact assertion view of the projection: "id@depth" per visible row. */
function shape(issues: readonly Issue[], collapsed: string[] = []): string[] {
  return buildIssueTableRows(issues, new Set(collapsed)).map(
    (row) => `${row.issue.id}@${row.depth}${row.hasChildren ? "*" : ""}${row.collapsed ? "-" : ""}`,
  );
}

describe("buildIssueTableRows", () => {
  it("leaves a flat list at depth 0 with no chevrons", () => {
    expect(shape([issue("a"), issue("b")])).toEqual(["a@0", "b@0"]);
  });

  it("indents each parent hop and flags rows that have loaded children", () => {
    expect(shape([issue("parent"), issue("child", "parent")])).toEqual([
      "parent@0*",
      "child@1",
    ]);
  });

  it("counts depth across a grandchild chain", () => {
    expect(
      shape([
        issue("root"),
        issue("mid", "root"),
        issue("leaf", "mid"),
      ]),
    ).toEqual(["root@0*", "mid@1*", "leaf@2"]);
  });

  it("treats a row whose parent is outside the loaded window as a root", () => {
    // `child`'s parent never loaded, so there is nothing to indent against —
    // and the absent parent must not be reported as having children.
    expect(shape([issue("child", "missing")])).toEqual(["child@0"]);
  });

  it("preserves the surface's sort order instead of re-nesting", () => {
    expect(
      shape([issue("child", "parent"), issue("parent")]),
    ).toEqual(["child@1", "parent@0*"]);
  });

  it("prunes the whole subtree under a collapsed row", () => {
    const tree = [
      issue("root"),
      issue("mid", "root"),
      issue("leaf", "mid"),
      issue("other"),
    ];
    expect(shape(tree, ["root"])).toEqual(["root@0*-", "other@0"]);
    // Collapsing only the middle row hides the leaf but keeps the root.
    expect(shape(tree, ["mid"])).toEqual(["root@0*", "mid@1*-", "other@0"]);
  });

  it("ignores a collapsed id that is not a loaded row", () => {
    expect(shape([issue("a")], ["ghost"])).toEqual(["a@0"]);
  });

  it("does not hide a row whose collapsed ancestor is itself hidden", () => {
    // `mid` is collapsed AND pruned by `root`; `leaf` must not resurrect.
    const tree = [issue("root"), issue("mid", "root"), issue("leaf", "mid")];
    expect(shape(tree, ["root", "mid"])).toEqual(["root@0*-"]);
  });

  it("survives a two-node parent cycle without hanging", () => {
    expect(shape([issue("a", "b"), issue("b", "a")])).toEqual(["a@0*", "b@0*"]);
  });

  it("survives a self-parent row", () => {
    const rows = buildIssueTableRows([issue("a", "a")], new Set());
    expect(rows.map((r) => r.depth)).toEqual([0]);
  });

  it("caps runaway depth so a long chain cannot indent off-screen", () => {
    const chain = [issue("n0")];
    for (let i = 1; i <= MAX_DEPTH + 3; i += 1) {
      chain.push(issue(`n${i}`, `n${i - 1}`));
    }
    const depths = buildIssueTableRows(chain, new Set()).map((r) => r.depth);
    expect(Math.max(...depths)).toBe(MAX_DEPTH);
  });

  it("returns an empty list for no issues", () => {
    expect(buildIssueTableRows([], new Set())).toEqual([]);
  });
});
