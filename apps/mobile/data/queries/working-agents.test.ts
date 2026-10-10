/**
 * Wire-contract tests for the two working-agents reads.
 *
 * The rest of the mobile suite mocks `@/data/api`, which cannot see the query
 * KEY or the exact request the endpoint receives. Both matter here, and both
 * are load-bearing rather than incidental:
 *
 *   - the header chip's key must not move when the toggle flips, or the number
 *     the chip is labelling flickers at the moment the user clicks it;
 *   - the sub-issues read must send `parent`, never `scope`, because the
 *     server rejects the two together (400) and a silently-broken request
 *     would render as "nobody is working" rather than as an error.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const listIssueTableFacets = vi.fn();
const getWorkspaceWorkingAgents = vi.fn();

vi.mock("@/data/api", () => ({
  api: {
    listIssueTableFacets: (...args: unknown[]) => listIssueTableFacets(...args),
    getWorkspaceWorkingAgents: (...args: unknown[]) =>
      getWorkspaceWorkingAgents(...args),
  },
}));

import {
  subIssuesWorkingAgentsOptions,
  workingAgentsFacetOptions,
  workingAgentsKeys,
} from "./working-agents";

const WORKSPACE_SCOPE = { kind: "workspace" as const };

beforeEach(() => {
  vi.clearAllMocks();
  listIssueTableFacets.mockResolvedValue({
    query_fingerprint: "",
    total: 0,
    facets: [
      { kind: "working_agents", values: [{ key: "agent-1", count: 2 }] },
    ],
  });
  getWorkspaceWorkingAgents.mockResolvedValue([]);
});

describe("the header chip reads the surface's own working_agents facet", () => {
  it("asks only for that facet, without the total scan", async () => {
    const opts = workingAgentsFacetOptions("ws-1", {
      scope: WORKSPACE_SCOPE,
      window: {},
      includeSubIssues: true,
    });
    await opts.queryFn!({
      signal: new AbortController().signal,
    } as never);

    const [request] = listIssueTableFacets.mock.calls[0] as [
      { query: unknown; facets: unknown; include_total?: boolean },
    ];
    expect(request.facets).toEqual([{ kind: "working_agents" }]);
    // Count-only: the extra scan would cost a page of rows nothing reads.
    expect(request.include_total).toBe(false);
  });

  it("decodes the facet into summaries the chip can render", async () => {
    const opts = workingAgentsFacetOptions("ws-1", {
      scope: WORKSPACE_SCOPE,
      window: {},
      includeSubIssues: true,
    });
    const result = await opts.queryFn!({
      signal: new AbortController().signal,
    } as never);
    expect(result).toEqual([{ id: "agent-1", running_task_count: 2 }]);
  });

  it("returns undefined when the deployment omits the facet", async () => {
    listIssueTableFacets.mockResolvedValue({
      query_fingerprint: "",
      total: 0,
      facets: [],
    });
    const opts = workingAgentsFacetOptions("ws-1", {
      scope: WORKSPACE_SCOPE,
      window: {},
      includeSubIssues: true,
    });
    expect(
      await opts.queryFn!({ signal: new AbortController().signal } as never),
    ).toBeUndefined();
  });

  it("strips working_issue_ids so the key survives the toggle", () => {
    // The number must not flicker when you click the chip it labels. The
    // server drops this dimension for this facet anyway, so stripping it
    // changes only the query IDENTITY — which is exactly the point. Without
    // this, turning the filter on would re-key and refetch the count.
    const base = {
      scope: WORKSPACE_SCOPE,
      includeSubIssues: true,
    };
    const off = workingAgentsFacetOptions("ws-1", {
      ...base,
      window: { statuses: ["todo"] },
    });
    const on = workingAgentsFacetOptions("ws-1", {
      ...base,
      window: { statuses: ["todo"], working_issue_ids: ["i1", "i2"] },
    });
    expect(on.queryKey).toEqual(off.queryKey);
  });

  it("still re-keys when a real filter changes", () => {
    // The previous test must not be satisfied by a key that ignores the window
    // entirely — then the count would never follow the filters it claims to
    // have applied.
    const base = { scope: WORKSPACE_SCOPE, includeSubIssues: true };
    const todo = workingAgentsFacetOptions("ws-1", {
      ...base,
      window: { statuses: ["todo"] },
    });
    const done = workingAgentsFacetOptions("ws-1", {
      ...base,
      window: { statuses: ["done"] },
    });
    expect(todo.queryKey).not.toEqual(done.queryKey);
  });
});

describe("the sub-issues chip narrows by parent", () => {
  it("sends type=issue with the parent id, and no scope", async () => {
    const opts = subIssuesWorkingAgentsOptions("ws-1", "parent-1");
    await opts.queryFn!({ signal: new AbortController().signal } as never);
    const args = getWorkspaceWorkingAgents.mock.calls[0] as unknown[];
    expect(args[0]).toBe("issue");
    // Scope must stay undefined: passing both is a 400 server-side, and a
    // rejected request would read as "nobody is working" instead of as a bug.
    expect(args[1]).toBeUndefined();
    expect(args[2]).toBe("parent-1");
  });

  it("is disabled without a parent id", () => {
    expect(subIssuesWorkingAgentsOptions("ws-1", null).enabled).toBe(false);
    expect(subIssuesWorkingAgentsOptions("ws-1", undefined).enabled).toBe(false);
    expect(subIssuesWorkingAgentsOptions("ws-1", "parent-1").enabled).toBe(true);
  });

  it("keys per parent so two open issues cannot collide", () => {
    expect(workingAgentsKeys.subIssues("ws-1", "p1")).not.toEqual(
      workingAgentsKeys.subIssues("ws-1", "p2"),
    );
  });
});
