/**
 * Actor Issues 面板纯函数 —— 移植 web `common/actor-issues-panel.tsx` 语义：
 * 以 member/agent 视角拉取/过滤/排序 issue。数据层用 listIssues 的
 * assignee_filters / creator_filters（序列化 `type:id`，见 data/api.ts），
 * 这里只做参数构造 + 客户端搜索过滤 + 稳定排序。
 */
import { describe, expect, it } from "vitest";
import type { Issue } from "@multica/core/types";
import {
  buildActorIssuesFilter,
  filterActorIssues,
  sortActorIssues,
} from "./actor-issues";

let n = 0;
function issue(partial: Partial<Issue> = {}): Issue {
  n += 1;
  return {
    id: `iss_${n}`,
    workspace_id: "ws_1",
    number: n,
    identifier: `MYS-${1000 + n}`,
    title: `Issue ${n}`,
    description: null,
    status: "todo",
    priority: "none",
    assignee_type: null,
    assignee_id: null,
    creator_type: "member",
    creator_id: "u_1",
    parent_issue_id: null,
    project_id: null,
    position: 0,
    stage: null,
    start_date: null,
    due_date: null,
    metadata: {},
    properties: {},
    created_at: "2026-08-20T00:00:00.000Z",
    updated_at: "2026-08-20T00:00:00.000Z",
    ...partial,
  } as Issue;
}

describe("buildActorIssuesFilter", () => {
  it("maps assigned relation to assignee_filters with type:id", () => {
    expect(buildActorIssuesFilter("agent", "ag_123", "assigned")).toEqual({
      assignee_filters: [{ type: "agent", id: "ag_123" }],
    });
  });

  it("maps member assigned to assignee_filters", () => {
    expect(buildActorIssuesFilter("member", "u_9", "assigned")).toEqual({
      assignee_filters: [{ type: "member", id: "u_9" }],
    });
  });

  it("maps created relation to creator_filters", () => {
    expect(buildActorIssuesFilter("member", "u_9", "created")).toEqual({
      creator_filters: [{ type: "member", id: "u_9" }],
    });
  });
});

describe("filterActorIssues", () => {
  it("returns all issues for an empty (trimmed) search", () => {
    const issues = [issue({ title: "Alpha" }), issue({ title: "Beta" })];
    expect(filterActorIssues(issues, "   ")).toHaveLength(2);
  });

  it("matches identifier case-insensitively", () => {
    const issues = [
      issue({ identifier: "MYS-1001" }),
      issue({ identifier: "PROJ-22" }),
    ];
    const hit = filterActorIssues(issues, "mys-1001");
    expect(hit.map((i) => i.identifier)).toEqual(["MYS-1001"]);
  });

  it("matches title case-insensitively and trims the query", () => {
    const issues = [
      issue({ title: "Fix login screen" }),
      issue({ title: "Ship PWA milestone" }),
    ];
    expect(filterActorIssues(issues, "  fix LOGIN ").map((i) => i.title)).toEqual([
      "Fix login screen",
    ]);
  });

  it("returns empty array when nothing matches", () => {
    const issues = [issue({ title: "Alpha" })];
    expect(filterActorIssues(issues, "zzz")).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const issues = [issue(), issue()];
    filterActorIssues(issues, "MYS");
    expect(issues).toHaveLength(2);
  });
});

describe("sortActorIssues", () => {
  it("sorts by created_at descending (newest first)", () => {
    const older = issue({ created_at: "2026-08-01T00:00:00.000Z" });
    const newer = issue({ created_at: "2026-08-24T00:00:00.000Z" });
    const mid = issue({ created_at: "2026-08-10T00:00:00.000Z" });
    expect(sortActorIssues([older, newer, mid]).map((i) => i.id)).toEqual([
      newer.id,
      mid.id,
      older.id,
    ]);
  });

  it("is stable for equal created_at", () => {
    const a = issue({ id: "a", created_at: "2026-08-10T00:00:00.000Z" });
    const b = issue({ id: "b", created_at: "2026-08-10T00:00:00.000Z" });
    expect(sortActorIssues([a, b]).map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("returns a new array and handles empty input", () => {
    const issues = [issue()];
    const out = sortActorIssues(issues);
    expect(out).not.toBe(issues);
    expect(sortActorIssues([])).toEqual([]);
  });
});