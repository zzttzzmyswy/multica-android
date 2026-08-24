/**
 * Centralised TanStack Query keys for issue-domain queries on mobile.
 *
 * Prefix shape mirrors web's `packages/core/issues/queries.ts` so the same
 * WS invalidation surface (e.g. `invalidateQueries({ queryKey: issueKeys.myAll(wsId) })`)
 * eventually drives both clients. Keys are workspace-scoped — switching
 * workspace flips wsId and the cache moves automatically (root CLAUDE.md
 * "Workspace-scoped queries must key on wsId").
 */
import type { ListIssuesParams } from "@multica/core/types";

export type MyIssuesScope = "assigned" | "created" | "agents";

export type MyIssuesFilter = Pick<
  ListIssuesParams,
  "assignee_id" | "assignee_ids" | "creator_id" | "involves_user_id"
>;

/** Stable, order-insensitive string form of a params value for query-key
 *  inclusion. Arrays are order-insensitive comparisons in the UI (filters
 *  are sets) and objects (custom-property bags) are inserted with an
 *  unspecified key order, so both are normalized before stringifying to
 *  avoid pointless refetches. */
function stableKeyValue(v: unknown): unknown {
  if (Array.isArray(v)) {
    return v
      .map(stableKeyValue)
      .sort(
        (a, b) =>
          (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1),
      );
  }
  if (v !== null && typeof v === "object") {
    return Object.entries(v as Record<string, unknown>)
      .sort(([ka], [kb]) => ka.localeCompare(kb))
      .map(([k, val]) => [k, stableKeyValue(val)]);
  }
  return v;
}

/** Stable string form of a params bag for query-key inclusion — the cache
 *  must refetch when a filter/sort changes, so the key carries the full
 *  bag. See `stableKeyValue`. */
export function issueParamsKey(params: ListIssuesParams): string {
  const entries = Object.entries(params)
    .map(([k, v]) => [k, stableKeyValue(v)] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));
  return JSON.stringify(entries);
}

/** The additional window params the mobile issue lists pass through to
 *  `GET /api/issues` — every filter/sort dimension the view stores expose. */
export type IssueListWindowParams = Pick<
  ListIssuesParams,
  | "statuses"
  | "priorities"
  | "assignee_filters"
  | "include_no_assignee"
  | "creator_filters"
  | "project_ids"
  | "include_no_project"
  | "label_ids"
  | "properties"
  | "date_field"
  | "date_start"
  | "date_end"
  | "sort_by"
  | "sort_direction"
>;

export const issueKeys = {
  all: (wsId: string | null) => ["issues", wsId] as const,
  list: (wsId: string | null) => [...issueKeys.all(wsId), "list"] as const,
  /** Filtered workspace-wide list window. Keyed under `list(wsId)` so the
   *  shared WS updaters (which prefix-match `list(wsId)`) reach every
   *  filter variant with one `setQueriesData` call. */
  listFiltered: (wsId: string | null, params: IssueListWindowParams) =>
    [...issueKeys.list(wsId), "filtered", issueParamsKey(params)] as const,
  myAll: (wsId: string | null) => [...issueKeys.all(wsId), "my"] as const,
  myList: (
    wsId: string | null,
    scope: MyIssuesScope,
    filter: MyIssuesFilter,
  ) => [...issueKeys.myAll(wsId), scope, filter] as const,
  // Actor-scoped issue list — member/agent detail "Issues" panel (web
  // `common/actor-issues-panel.tsx`). Keyed under its own `actorAll(wsId)`
  // prefix so a WS handler can invalidate every actor panel with one call.
  actorAll: (wsId: string | null) =>
    [...issueKeys.all(wsId), "actor"] as const,
  actorList: (
    wsId: string | null,
    actorType: "member" | "agent",
    actorId: string,
    relation: "assigned" | "created",
  ) => [...issueKeys.actorAll(wsId), actorType, actorId, relation] as const,
  detail: (wsId: string | null, id: string) =>
    [...issueKeys.all(wsId), "detail", id] as const,
  timeline: (wsId: string | null, id: string) =>
    [...issueKeys.all(wsId), "timeline", id] as const,
  // Direct sub-issues (children) of a parent issue. Drives the sub-issue
  // section in the issue detail header. Prefix mirrors core's
  // `children(wsId, id)` key so the same WS invalidation surface eventually
  // drives both clients.
  children: (wsId: string | null, id: string) =>
    [...issueKeys.all(wsId), "children", id] as const,
  // Workspace-wide parent→(done/total) child-progress map (MYS-493). Drives
  // the nested-progress ring on sub-issue rows; mirrors core's
  // `issueKeys.childProgress(wsId)`.
  childProgress: (wsId: string | null) =>
    [...issueKeys.all(wsId), "child-progress"] as const,
  // Currently-running tasks for an issue (queued/dispatched/running). Drives
  // the "Working" state of the AgentActivityRow inside IssueHeaderCard.
  activeTasks: (wsId: string | null, id: string) =>
    [...issueKeys.all(wsId), "active-tasks", id] as const,
  // All tasks (any status) for an issue — drives the Runs history sheet.
  tasks: (wsId: string | null, id: string) =>
    [...issueKeys.all(wsId), "tasks", id] as const,
  // File attachments hooked to an issue (and its comments). Used by the
  // markdown renderer to resolve `mc://file/<id>` URIs to download_url.
  attachments: (wsId: string | null, id: string) =>
    [...issueKeys.all(wsId), "attachments", id] as const,
  // Who is subscribed to an issue and why — drives the Subscribe control in
  // the issue detail Activity header (web issue-detail.tsx).
  subscribersAll: (wsId: string | null) =>
    [...issueKeys.all(wsId), "subscribers"] as const,
  subscribers: (wsId: string | null, id: string) =>
    [...issueKeys.subscribersAll(wsId), id] as const,
};
