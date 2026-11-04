/**
 * "All views" directory — the data half of web's `AllViewsPage`
 * (`packages/views/issue-views/all-views-page.tsx`).
 *
 * Web reaches every view the caller can open through one cross-scope list
 * (`scope_type=all`) and classifies each row four ways. Mobile had neither
 * the page nor the cross-scope query, so a view hidden from the bar, or one
 * shared from another scope, was unreachable — the bar's "manage" panel only
 * ever lists the scope it is mounted on.
 *
 * The predicates live here rather than in the screen so the classification
 * and counting rules are testable in the Node lane (no RN, no query client).
 * Every rule below is transcribed from the upstream implementation named in
 * its comment; where mobile cannot model a dimension the rule still counts
 * it, because the number on the row has to match what web shows for the same
 * view.
 */
import type { IssueView } from "@multica/core/api/schemas";

/** The four buckets the directory can show, in web's order
 *  (`all-views-page.tsx:SCOPES`). */
export type DirectoryScope = "all" | "builtin" | "mine" | "shared";
export const ALL_VIEWS_SCOPES: readonly DirectoryScope[] = [
  "all",
  "builtin",
  "mine",
  "shared",
];

/**
 * Whether a saved view belongs in the given bucket.
 *
 * `mine` and `shared` are INDEPENDENT predicates, not a partition — web tests
 * `owner_id === userId` for one and `visibility === "workspace"` for the
 * other (`all-views-page.tsx` counts + shownViews). Keeping them independent
 * is what makes a mobile count equal web's for the same data; a row I own and
 * shared legitimately appears under both.
 *
 * A view owned by someone else and private is reachable only through a
 * project scope the caller belongs to. It belongs to no narrower bucket, so
 * it renders under `all` alone.
 */
export function viewInDirectoryScope(
  scope: DirectoryScope,
  view: Pick<IssueView, "owner_id" | "visibility">,
  userId: string | null | undefined,
): boolean {
  if (scope === "all") return true;
  if (scope === "builtin") return false;
  if (scope === "mine") return !!userId && view.owner_id === userId;
  return view.visibility === "workspace";
}

/**
 * How many filter dimensions a saved `query` constrains — web's
 * `issueViewFilterCount` (`packages/core/issue-views/baseline.ts:183`).
 *
 * Dimensions, not values: three selected statuses are one filter. That is
 * what makes the number on a mobile row equal the number web shows for the
 * same view.
 *
 * Four dimensions below are ones mobile's own view store cannot edit
 * (`projectStatusFilters`, `relationFilters`, `dueDateFilters`,
 * `unreadFilter`). They are counted anyway: the row describes the VIEW, and a
 * view written by web legitimately carries them. Reporting 0 for a
 * 3-condition view would be a false statement about what opening it shows.
 *
 * `negatedFilters` is deliberately absent — web stores and serializes it, but
 * its counter does not list it (`baseline.ts:183-202`). Counting it here
 * would make the mobile number disagree with web's for the same view, which
 * is the drift this page exists to avoid. The omission is pinned by a test.
 */
export function countViewFilters(query: Record<string, unknown>): number {
  const dimensions = [
    stringArray(query.statusFilters).length,
    stringArray(query.priorityFilters).length,
    stringArray(query.assigneeFilters).length > 0 ||
      query.includeNoAssignee === true,
    stringArray(query.creatorFilters).length,
    stringArray(query.projectFilters).length > 0 ||
      query.includeNoProject === true,
    stringArray(query.projectStatusFilters).length,
    stringArray(query.labelFilters).length,
    stringArray(query.relationFilters).length,
    stringArray(query.dueDateFilters).length,
    query.agentRunningFilter === true,
    query.unreadFilter === true,
  ].filter(Boolean).length;

  return (
    dimensions +
    Object.keys(propertyFilters(query.propertyFilters)).length +
    countAdvancedConditions(query.advancedFilter)
  );
}

/**
 * Leaf conditions in an advanced-filter tree — web's
 * `countAdvancedConditions` (`packages/core/issues/stores/filter-tree.ts:242`).
 *
 * A condition with no values is not a condition: inside an "any" group it
 * would match everything, so counting it would overstate the view. Groups
 * themselves never count.
 *
 * Typed structurally rather than against the upstream type so this module
 * stays importable from the Node test lane without pulling the filter-tree
 * runtime.
 */
export function countAdvancedConditions(group: unknown): number {
  if (!group || typeof group !== "object") return 0;
  const node = group as { type?: unknown; children?: unknown };
  if (!Array.isArray(node.children)) return 0;

  let count = 0;
  for (const child of node.children) {
    if (!child || typeof child !== "object") continue;
    const entry = child as { type?: unknown; children?: unknown; values?: unknown };
    if (entry.type === "group") {
      count += countAdvancedConditions(entry);
    } else if (Array.isArray(entry.values) && entry.values.length > 0) {
      count += 1;
    }
  }
  return count;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function propertyFilters(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string[]> = {};
  for (const [id, selected] of Object.entries(value as Record<string, unknown>)) {
    const values = stringArray(selected);
    // An empty selection is not a filter — same rule as the codec's
    // `stringRecord`, so a view saved with an emptied property does not
    // inflate the count.
    if (values.length > 0) out[id] = values;
  }
  return out;
}

export interface LocationLabels {
  myIssues: string;
  allIssues: string;
  /** Used when the project is gone or not in the page's project read. */
  project: string;
}

/**
 * Where a saved view opens — web's `location()` in `all-views-page.tsx`.
 *
 * A project-scoped view whose project cannot be resolved renders the generic
 * "Project" label rather than a blank: the view still lives somewhere, and
 * an empty cell would read as "nowhere".
 */
export function locationOf(
  view: Pick<IssueView, "scope_type" | "scope_id">,
  projectTitles: ReadonlyMap<string, string>,
  labels: LocationLabels,
): string {
  if (view.scope_type === "project") {
    return projectTitles.get(view.scope_id ?? "") ?? labels.project;
  }
  return view.scope_type === "my" ? labels.myIssues : labels.allIssues;
}

/** A built-in view row (never stored on the server). */
export interface BuiltinRowInput {
  key: string;
  name: string;
  rowId: string;
}

export interface DirectoryRow {
  rowId: string;
  kind: "builtin" | "view";
  name: string;
  /** Only saved views have a location. */
  location: string | null;
  /** Dimensions the view constrains; 0 for built-ins. */
  filterCount: number;
  /** The saved view, absent on built-in rows. */
  view: IssueView | null;
}

/**
 * The rows one bucket shows. Saved views sort by name with
 * `localeCompare` — web's `sortedViews` — so the directory reads
 * alphabetically regardless of creation order.
 */
export function filterDirectoryRows(
  scope: DirectoryScope,
  builtins: readonly BuiltinRowInput[],
  views: readonly IssueView[],
  userId: string | null | undefined,
): DirectoryRow[] {
  const shownBuiltins = scope === "all" || scope === "builtin" ? builtins : [];
  const shownViews =
    scope === "builtin"
      ? []
      : [...views]
          .filter((view) => viewInDirectoryScope(scope, view, userId))
          .sort((a, b) => a.name.localeCompare(b.name));

  return [
    ...shownBuiltins.map(
      (builtin): DirectoryRow => ({
        rowId: builtin.rowId,
        kind: "builtin",
        name: builtin.name,
        location: null,
        filterCount: 0,
        view: null,
      }),
    ),
    ...shownViews.map(
      (view): DirectoryRow => ({
        rowId: `view:${view.id}`,
        kind: "view",
        name: view.name,
        location: null,
        filterCount: 0,
        view,
      }),
    ),
  ];
}

/**
 * The per-bucket totals web prints beside each scope option.
 *
 * `all` is built-ins + every view; `builtin` is the built-in count; `mine`
 * and `shared` count the predicates independently (web's `counts`), which
 * means a view I own and shared increments both. That is deliberate and
 * matches the sidebar-style counters upstream — the buckets are "views you
 * would find here", not a partition.
 */
export function directoryScopeCounts(
  builtinCount: number,
  views: readonly IssueView[],
  userId: string | null | undefined,
): Record<DirectoryScope, number> {
  return {
    all: builtinCount + views.length,
    builtin: builtinCount,
    mine: views.filter((view) => view.owner_id === userId && !!userId).length,
    shared: views.filter((view) => view.visibility === "workspace").length,
  };
}

/**
 * `filterDirectoryRows` plus the derived cells the screen renders. Kept
 * separate from the filter so the bucket predicates stay a pure function of
 * (scope, views) and the display enrichment is one pass.
 */
export function buildAllViewsRows(
  builtins: readonly BuiltinRowInput[],
  views: readonly IssueView[],
  projectTitles: ReadonlyMap<string, string>,
  labels: LocationLabels,
  scope: DirectoryScope = "all",
  userId: string | null | undefined = undefined,
): DirectoryRow[] {
  return filterDirectoryRows(scope, builtins, views, userId).map((row) =>
    row.kind === "view" && row.view
      ? {
          ...row,
          location: locationOf(row.view, projectTitles, labels),
          filterCount: countViewFilters(row.view.query ?? {}),
        }
      : row,
  );
}
