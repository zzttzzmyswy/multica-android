/**
 * Centralised TanStack Query keys for issue-domain queries on mobile.
 *
 * Prefix shape mirrors web's `packages/core/issues/queries.ts` so the same
 * WS invalidation surface (e.g. `invalidateQueries({ queryKey: issueKeys.myAll(wsId) })`)
 * eventually drives both clients. Keys are workspace-scoped — switching
 * workspace flips wsId and the cache moves automatically (root CLAUDE.md
 * "Workspace-scoped queries must key on wsId").
 */
import type {
  ListIssuesParams,
  WorkspaceWakeupFilters,
} from "@multica/core/types";

export type MyIssuesScope = "all" | "assigned" | "created" | "agents";

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
 *  bag. See `stableKeyValue`. Takes any object so callers can key on shapes
 *  other than `ListIssuesParams` (e.g. the Table query spec's filter bag). */
export function issueParamsKey(params: object): string {
  const entries = Object.entries(params)
    .map(([k, v]) => [k, stableKeyValue(v)] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));
  return JSON.stringify(entries);
}

/** The additional window params the mobile issue lists pass through to
 *  `GET /api/issues` — every filter/sort dimension the view stores expose.
 *
 *  `ids` and `top_level_only` are the two dimensions the ROW window carries
 *  that the count window reads about (MYS-2066). Both are row-level narrowings
 *  web sends on the very query that feeds its list rows
 *  (`use-issue-surface-controller.ts:441-444`), and both were previously
 *  client-only predicates on mobile — so the list filtered the loaded page
 *  while web filtered the complete result set:
 *
 *   - `ids` — 「智能体工作中」 (web `working_issue_ids`). Sending it is what
 *     makes the switch mean "issues an agent is working on" rather than
 *     "…among the first 100 rows", which measured empty on every workspace
 *     whose running issues are not the newest.
 *   - `top_level_only` — 「显示子任务」 off (web `include_sub_issues: false`).
 *     The server's equivalent of the same predicate.
 *
 *  Both are carried ONLY while active, and that is a query-IDENTITY rule, not
 *  a size optimisation:
 *
 *   - `ids` carries a set that moves second-to-second. Web gates it the same
 *     way (`agentRunningFilter ? {…} : {}`), so a task starting cannot re-key
 *     a list whose rows cannot change while the switch is off.
 *   - `top_level_only` has a default-on switch, so emitting it in the default
 *     state would put a key on every list for no narrowing.
 *
 *  An explicit EMPTY `ids` list is NOT the same as omitting it: presence means
 *  "restrict to these", and empty means nothing matches — the truthful answer
 *  when the switch is on and no agent is running. See `lib/issue-row-narrowing.ts`
 *  for the builder and the `undefined`-vs-empty rule. */
export type IssueListWindowParams = Pick<
  ListIssuesParams,
  | "q"
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
  | "ids"
  | "top_level_only"
>;

/** The window the server COUNT channels read — the list window plus the one
 *  dimension only they carry.
 *
 *  `working_issue_ids` is the COUNT channel's spelling of the row window's
 *  `ids`: the Table query spec names it `working_issue_ids`
 *  (`IssueTableFilters`, packages/core/types/api.ts:269-271), where the list
 *  API names the same restriction `ids`. Both helpings are kept because they
 *  are different transports with different type contracts — and because
 *  `lib/issue-table-group-counts.ts` must project a count window onto a spec.
 *
 *  Note what is NO LONGER true here: this type used to be the only place a
 *  working dimension could live, with `IssueListWindowParams` deliberately
 *  free of it. MYS-2066 changed that on purpose — the ROW window now carries
 *  the same restriction (as `ids`), because narrowing only the counts left the
 *  list itself showing a page-scoped answer. See `IssueListWindowParams`.
 *
 *  The count endpoints (`POST /api/issues/table/groups` and `/facets`) have no
 *  list semantics to disturb: their query is a spec, not a page, so the extra
 *  dimension only narrows the number they return. */
export type IssueCountWindowParams = IssueListWindowParams & {
  /** Hard-restrict the counted set to these issue ids. An explicit EMPTY list
   *  is meaningful and counts nothing (server: `FALSE`), which is the truthful
   *  answer when the filter is on and no agent is running. */
  working_issue_ids?: string[];
};

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
  // Wakeup rules waiting on this issue (MYS-2023). Keyed under `all(wsId)` so a
  // workspace-wide invalidation reaches them, and under their own segment so
  // they refetch independently of the detail/timeline caches.
  wakeups: (wsId: string | null, id: string) =>
    [...issueKeys.all(wsId), "wakeups", id] as const,
  // The platform's own rules (the child-done rule) on this issue. A separate
  // key from `wakeups`: they come from a different endpoint, carry different
  // fields, and the header chip reads both.
  systemWakeups: (wsId: string | null, id: string) =>
    [...issueKeys.all(wsId), "system-wakeups", id] as const,
  // One rule's trigger history — fetched only when the reader opens that row.
  wakeupRuns: (wsId: string | null, id: string, wakeupId: string) =>
    [...issueKeys.wakeups(wsId, id), "runs", wakeupId] as const,
  // The WORKSPACE-wide rule table (MYS-2043) — every issue's rules on one page,
  // behind web's 自动化 → 任务唤醒 tab. Keyed under its own `workspaceWakeups`
  // prefix rather than under `all(wsId)`: this is a paginated, filtered query
  // whose key carries the whole filter bag, and prefixing it onto the issue
  // keys would make every workspace-wide issue invalidation refetch a table the
  // change cannot have affected.
  workspaceWakeupsAll: (wsId: string | null) =>
    ["workspace-wakeups", wsId] as const,
  workspaceWakeups: (
    wsId: string | null,
    filters: WorkspaceWakeupFilters,
  ) =>
    [
      ...issueKeys.workspaceWakeupsAll(wsId),
      issueParamsKey(filters),
    ] as const,
  // The workspace DEFAULTS of the platform's rules, for 设置 → 唤醒 (MYS-2043).
  // A separate root from the table above: different endpoint, different shape
  // (a default is not a rule with an issue), and the two are invalidated
  // together but read independently.
  workspaceSystemWakeups: (wsId: string | null) =>
    ["workspace-system-wakeups", wsId] as const,
};
