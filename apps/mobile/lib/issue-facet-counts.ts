/**
 * Server facet-count bridge for the mobile issue filter panel (iter211).
 *
 * Web renders a "N issues" badge next to every filter option
 * (`packages/views/issues/components/issues-header.tsx`), and the number comes
 * from a disjunctive server facet: `POST /api/issues/table/facets` drops the
 * facet's OWN dimension before counting
 * (`server/internal/handler/issue_table_facets.go:issueTableQueryWithoutFacet`),
 * so the answer is "how many issues would I see if I turned this option on",
 * independent of what is already selected.
 *
 * Mobile segments its loaded window locally, which under-reports on any
 * workspace busier than one page — the same problem
 * `lib/issue-table-group-counts.ts` solves for group headers. Filters are the
 * other face of it, and this module is the bridge: it derives the request spec
 * mobile has to send and reconciles the server's key vocabulary with the one
 * the filter UI looks counts up by.
 *
 * Everything here is pure — the query lives in
 * `data/queries/issue-facets.ts`.
 */
import type {
  IssueTableFacet,
  IssueTableFacetSpec,
  IssueTableFacetsResponse,
  IssueTableQuerySpec,
  IssueTableScope,
} from "@multica/core/types";
import type { IssueCountWindowParams } from "@/data/queries/issue-keys";
import {
  assigneeTypesForScopeTab,
  buildIssueTableGroupQuerySpec,
  myIssueTableScope,
  workspaceIssueTableScope,
} from "./issue-table-group-counts";

/** The server's literal key for "this dimension has no value" — an issue with
 *  no assignee (`issue_table_facets.go:96`) or no project (`:97`). */
export const NO_VALUE_KEY = "__none__";

/**
 * Dimensions the filter panel always shows a count for, matching the six web
 * renders a badge on: status (`issues-header.tsx:1266`), priority (`:1309`),
 * assignee (`:387`), creator (`:1402`), project (`:1429`) and label (`:626`).
 *
 * `property` is deliberately absent — it is requested per definition by the
 * caller, because the server resolves each one against the workspace catalog
 * and rejects an unknown/archived id. `working_agents` is absent too: mobile's
 * "agents working now" is a boolean row with no per-option badge to fill.
 */
export const FACET_DIMENSIONS: readonly IssueTableFacetSpec[] = [
  { kind: "status" },
  { kind: "priority" },
  { kind: "assignee" },
  { kind: "creator" },
  { kind: "project" },
  { kind: "label" },
] as const;

/**
 * The list window mobile passes to `GET /api/issues` → the Table query spec
 * the facet request needs.
 *
 * Reuses the group-count projection so a facet and the list are evaluated
 * against the same filter bag by construction; the two can only drift if that
 * one function changes. The facet's own dimension is deliberately NOT dropped
 * here — disjunction is the server's job, and pre-dropping it client-side
 * would answer a question web does not ask.
 */
export function buildIssueFacetQuerySpec(
  scope: IssueTableScope,
  window: IssueCountWindowParams,
  includeSubIssues = true,
): IssueTableQuerySpec {
  return buildIssueTableGroupQuerySpec(scope, window, includeSubIssues);
}

/**
 * A filter sheet's `scope` route param → the Table scope its counts must be
 * evaluated against.
 *
 * The filter sheet is shared by three surfaces whose local scope vocabularies
 * differ (`all/members/agents` on Issues, `assigned/created/agents/all` on My
 * Issues), so the tab cannot be passed through verbatim — each one maps onto
 * the Table scope that reproduces the SAME row set the list is showing. This
 * is the same mapping the group-count bridge already carries at every call
 * site, lifted here so the filter sheet and its sub-picker cannot disagree
 * about which rows they are counting.
 *
 * The project surface needs the project id alongside the scope; without it
 * the only honest option would be `null` (no counts), because counting
 * against `{kind: "workspace"}` would badge every option with a number from
 * other projects. The sheet carries the id through its `project` route param
 * for exactly this reason, and a missing id stays `null`.
 */
export function facetScopeFor(
  sheetScope: "my" | "all" | "project",
  tab: string | undefined,
  projectId?: string | null,
): IssueTableScope | null {
  switch (sheetScope) {
    case "my":
      // The My Issues tab vocabulary is `assigned/created/agents/all`
      // (`MyIssuesScope`, data/queries/issue-keys.ts:12); the store's default
      // is `assigned`, which is also the fallback for an unrecognized param.
      return myIssueTableScope(
        tab === "created" || tab === "agents" || tab === "all" ? tab : "assigned",
      );
    case "all":
      return workspaceIssueTableScope(
        tab === "members" || tab === "agents" ? tab : "all",
      );
    case "project": {
      if (!projectId) return null;
      const assigneeTypes = assigneeTypesForScopeTab(
        tab === "members" || tab === "agents" ? tab : "all",
      );
      return {
        kind: "project",
        project_id: projectId,
        ...(assigneeTypes ? { assignee_types: assigneeTypes } : {}),
      };
    }
  }
}

/**
 * Whether the server can facet this property type.
 *
 * `issue_table_facets.go:236-247` answers `select`, `multi_select` and
 * `checkbox`, and rejects everything else with `property_type_unsupported` —
 * and that rejection fails the WHOLE batch, so asking for an actor property
 * would cost the six base dimensions their badges too. The filter sheet
 * therefore asks only for the facetable definitions and shows the rest
 * without a count.
 */
export function propertyFacetable(type: string | undefined): boolean {
  return type === "select" || type === "multi_select" || type === "checkbox";
}

/** Per-dimension counts in the vocabulary the filter UI looks up by. */
export interface FacetCounts {
  status: Map<string, number>;
  priority: Map<string, number>;
  assignee: Map<string, number>;
  creator: Map<string, number>;
  project: Map<string, number>;
  label: Map<string, number>;
  /** Definition id → (option key → count). */
  property: Map<string, Map<string, number>>;
}

function emptyFacetCounts(): FacetCounts {
  return {
    status: new Map(),
    priority: new Map(),
    assignee: new Map(),
    creator: new Map(),
    project: new Map(),
    label: new Map(),
    property: new Map(),
  };
}

/** The five base dimensions that map 1:1 onto a `FacetCounts` field. */
function baseDimensionField(
  kind: IssueTableFacet["kind"],
): Exclude<keyof FacetCounts, "property"> | null {
  switch (kind) {
    case "status":
    case "priority":
    case "assignee":
    case "creator":
    case "project":
    case "label":
      return kind;
    default:
      return null;
  }
}

/**
 * A facets response → per-dimension `key → count` maps.
 *
 * Keys are kept exactly as the server sends them (`__none__`,
 * `member:<uuid>`, a label id, an option id) — the call sites already speak
 * those key shapes (`ActorFilterValue` stringifies to `type:id`, label/project
 * filters carry ids). A dimension the response does not cover keeps an EMPTY
 * map rather than `undefined`, so `facetValuesFor` is the single place that
 * decides whether a missing dimension means "loading" or "no options".
 *
 * A repeated key takes the last value: the server groups by value, so a
 * repeat is a malformed response, and summing would invent a number that
 * matches neither row.
 */
export function facetCountsByDimension(
  response: IssueTableFacetsResponse,
): FacetCounts {
  const counts = emptyFacetCounts();
  for (const facet of response.facets) {
    if (facet.kind === "property") {
      if (!facet.property_id) continue;
      let perOption = counts.property.get(facet.property_id);
      if (!perOption) {
        perOption = new Map<string, number>();
        counts.property.set(facet.property_id, perOption);
      }
      for (const value of facet.values) perOption.set(value.key, value.count);
      continue;
    }
    const field = baseDimensionField(facet.kind);
    if (!field) continue;
    const target = counts[field];
    for (const value of facet.values) target.set(value.key, value.count);
  }
  return counts;
}

/**
 * The `key → count` map for one dimension, or `undefined` when the counts are
 * not available yet.
 *
 * `undefined` matters: `issues-header.tsx:1183` renders counts only from the
 * server facet and falls back to `NO_COUNT_ISSUES` when it is inexact, i.e.
 * web shows NO badge rather than a wrong one. Mobile mirrors that — an
 * unresolved or failed request must render no badge at all, never a
 * locally-derived guess that under-reports.
 */
export function facetValuesFor(
  counts: FacetCounts | undefined,
  facet: IssueTableFacetSpec,
): Map<string, number> | undefined {
  if (!counts) return undefined;
  if (facet.kind === "property") {
    return counts.property.get(facet.property_id);
  }
  const field = baseDimensionField(facet.kind);
  return field ? counts[field] : undefined;
}
