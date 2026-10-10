/**
 * The two reads behind the issue surfaces' "agents working" affordances.
 *
 * Web answers both from the SAME projection but through two different
 * channels, and mobile mirrors that split because the two questions are
 * genuinely different:
 *
 *   1. **The Issues / My Issues header chip** asks "how many agents are working
 *      inside the rows THIS surface would show" — a claim about a scope, so
 *      the server owns both the scope and the arithmetic. Web reads it from
 *      the `working_agents` facet of `POST /api/issues/table/facets`, compiled
 *      from the surface's own Table query spec
 *      (`use-issue-surface-controller.ts:523-548`), NOT from a second
 *      workspace-wide `/api/working-agents` read: that older shape advertised
 *      agents working nowhere near the surface and could open an empty list
 *      (MUL-5525). Verified against the deployment — the facet answers agent
 *      ids with running-task counts, identical to the workspace projection.
 *
 *   2. **The sub-issues header chip on issue detail** asks "how many agents
 *      are on THIS parent's direct children right now". Web reads
 *      `GET /api/working-agents?type=issue&parent=<uuid>`
 *      (`sub-issues-agent-working-chip.tsx:45`), whose SQL is
 *      `child.parent_issue_id = $5`. That is deliberately the same projection,
 *      narrowed — a header count must not be re-derived client-side from the
 *      task snapshot, or the count and the drill-down would each carry their
 *      own definition of "working".
 *
 * Both are read-only GETs/POSTs and both are invalidated by the task lifecycle
 * events the presence layer already subscribes to, so neither adds polling.
 */
import { queryOptions } from "@tanstack/react-query";
import type {
  IssueTableScope,
  WorkingAgentSummary,
} from "@multica/core/types";
import { api } from "@/data/api";
import type { IssueFacetCountQuery } from "@/data/queries/issue-facets";
import { buildIssueFacetQuerySpec } from "@/lib/issue-facet-counts";
import { issueKeys, issueParamsKey } from "@/data/queries/issue-keys";
import { workingAgentsFromFacets } from "@/lib/working-agents-chip";

/**
 * Key space for the workspace working-agents projection. `list` carries the
 * narrowing so the parent-scoped read and the workspace-wide one cannot
 * collide; `all` is the prefix the realtime layer invalidates on task
 * lifecycle transitions.
 */
export const workingAgentsKeys = {
  all: (wsId: string | null) => ["working-agents", wsId] as const,
  subIssues: (wsId: string | null, parentIssueId: string) =>
    [...workingAgentsKeys.all(wsId), "sub-issues", parentIssueId] as const,
  headerFacet: (
    wsId: string | null,
    scope: IssueTableScope,
    paramsKey: string,
  ) =>
    [
      ...issueKeys.all(wsId),
      "working-agents-facet",
      JSON.stringify(scope),
      paramsKey,
    ] as const,
};

/** How long a working-agents answer stays fresh. Task lifecycle events are the
 *  primary freshness signal (they invalidate on arrival); this is only the
 *  reconnect / missed-event safety net. Same 30s web uses
 *  (`core/agents/queries.ts:83`). */
const WORKING_AGENTS_STALE_MS = 30 * 1000;

/**
 * Face 1 — the header chip's count, from the surface's own `working_agents`
 * facet.
 *
 * The spec is built from the surface's OWN scope + window, so the number is
 * the answer to "how many agents would I see if I turned this filter on" —
 * which stays true whether the filter is currently on or off, because the
 * server drops the facet's own dimension before counting
 * (`issue_table_facets.go:69-77`).
 *
 * `working_issue_ids` is stripped from the window first. The server ignores it
 * for this facet anyway, so this is purely about query IDENTITY: without the
 * strip, flipping the toggle would re-key the request and the number the chip
 * is labelling would flicker as it labelled it (web does the same — see
 * `workingAgentsQuerySpec` in the controller).
 */
export function workingAgentsFacetOptions(
  wsId: string | null,
  query: IssueFacetCountQuery,
) {
  const { working_issue_ids: _running, ...unfiltered } = query.window;
  const spec = buildIssueFacetQuerySpec(
    query.scope,
    unfiltered,
    query.includeSubIssues,
  );
  return queryOptions({
    queryKey: workingAgentsKeys.headerFacet(
      wsId,
      query.scope,
      issueParamsKey(spec.filters),
    ),
    queryFn: async ({ signal }): Promise<WorkingAgentSummary[] | undefined> => {
      const res = await api.listIssueTableFacets(
        { query: spec, facets: [{ kind: "working_agents" }], include_total: false },
        { signal },
      );
      // A deployment without the facet answers without it — stay
      // indeterminate rather than claiming zero (see the decoder).
      return workingAgentsFromFacets(res.facets);
    },
    staleTime: WORKING_AGENTS_STALE_MS,
    // A failed facet is a missing number, never a wrong one; the next filter
    // change re-asks anyway. Matches `issueFacetCountsOptions`.
    retry: false,
  });
}

/**
 * Face 2 — the parent's direct children, from `GET /api/working-agents`.
 *
 * `type: "issue"` because a parent's children can only be worked by issue
 * tasks; the endpoint's own precedence (chat > autopilot > issue) is what
 * keeps a multi-purpose agent's OTHER work out of this count, which is the
 * behaviour web relies on too.
 *
 * `parentIssueId` must be a UUID — the route may carry a human-readable id and
 * the server answers 400 for a non-UUID (verified against the deployment).
 * Callers pass `issue.id`, never a route param.
 */
export function subIssuesWorkingAgentsOptions(
  wsId: string | null,
  parentIssueId: string | null | undefined,
) {
  return queryOptions({
    queryKey: workingAgentsKeys.subIssues(wsId, parentIssueId ?? ""),
    queryFn: ({ signal }) =>
      api.getWorkspaceWorkingAgents("issue", undefined, parentIssueId!, {
        signal,
      }),
    staleTime: WORKING_AGENTS_STALE_MS,
    enabled: !!wsId && !!parentIssueId,
  });
}
