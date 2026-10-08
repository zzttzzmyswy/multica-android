/**
 * Disjunctive facet counts for the mobile issue filter panel (iter211).
 *
 * One `POST /api/issues/table/facets` per (scope, window, requested
 * dimensions), reduced to per-dimension `key → count` maps the filter sheet
 * and its sub-picker bodies look badges up in. Web reads the same endpoint
 * through `issueTableFacetsOptions` (`packages/core/issues/queries.ts:316`) and
 * gates the badge on `facetCountsExact` (`issues-header.tsx:1183`): when the
 * counts are not exact, web renders none. Mobile keeps that rule — the hook
 * returns `undefined` until a response lands, and a failed request is a
 * permanent `undefined` rather than a locally-derived guess.
 *
 * Pure spec/key logic lives in `lib/issue-facet-counts.ts`.
 */
import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import type {
  IssueTableFacetSpec,
  IssueTableScope,
} from "@multica/core/types";
import { api } from "@/data/api";
import {
  FACET_DIMENSIONS,
  buildIssueFacetQuerySpec,
  facetCountsByDimension,
  facetScopeFor,
  type FacetCounts,
} from "@/lib/issue-facet-counts";
import {
  issueKeys,
  issueParamsKey,
  type IssueListWindowParams,
} from "./issue-keys";

/** The scope + filter window a filter surface is showing. Both are already on
 *  hand at every call site (the view stores carry them). */
export interface IssueFacetCountQuery {
  scope: IssueTableScope;
  window: IssueListWindowParams;
  /** The surface's "show sub-issues" toggle. */
  includeSubIssues: boolean;
  /**
   * Extra per-definition dimensions to ask for, beyond
   * {@link FACET_DIMENSIONS}. The filter sheet adds one per custom property it
   * renders a count for; the server rejects an unknown or archived id, so the
   * caller only passes definitions it already resolved from the catalog.
   */
  propertyIds?: readonly string[];
}

function requestedFacets(
  propertyIds: readonly string[] | undefined,
): IssueTableFacetSpec[] {
  const specs: IssueTableFacetSpec[] = [...FACET_DIMENSIONS];
  for (const propertyId of propertyIds ?? []) {
    specs.push({ kind: "property", property_id: propertyId });
  }
  return specs;
}

export function issueFacetCountsOptions(
  wsId: string | null,
  query: IssueFacetCountQuery,
) {
  // Sort is not part of the key nor the spec: facet counts are sort-invariant,
  // so re-sorting the list must not refetch them. `propertyIds` is sorted into
  // the key because the request is a set, not a sequence.
  const spec = buildIssueFacetQuerySpec(
    query.scope,
    query.window,
    query.includeSubIssues,
  );
  const propertyIds = [...(query.propertyIds ?? [])].sort();
  return queryOptions({
    queryKey: [
      ...issueKeys.all(wsId),
      "table-facets",
      JSON.stringify(query.scope),
      issueParamsKey(spec.filters),
      propertyIds.join(","),
    ] as const,
    queryFn: async ({ signal }): Promise<FacetCounts> => {
      const res = await api.listIssueTableFacets(
        { query: spec, facets: requestedFacets(propertyIds) },
        { signal },
      );
      return facetCountsByDimension(res);
    },
    // Counts move whenever any issue does, so every mount is stale.
    staleTime: 0,
    // Keep the previous response on screen while a filter change refetches —
    // the maps are keyed by the same server vocabulary, so a stale entry can
    // never be read as a live one for a different option.
    placeholderData: keepPreviousData,
    // A failed facet is a missing badge, never a wrong one; retrying in a
    // loop would not change that. The next filter change re-asks anyway.
    retry: false,
  });
}

/**
 * Per-dimension counts for a filter surface, or `undefined` while the first
 * response is in flight (and after a failure).
 *
 * Callers must render a badge only when this resolves — `undefined` means
 * "unknown", and showing "0" there would state something the server never
 * said. See the module header for the web rule this mirrors.
 */
export function useIssueFacetCounts(
  wsId: string | null,
  query: IssueFacetCountQuery | null | undefined,
): FacetCounts | undefined {
  const { data } = useQuery({
    ...issueFacetCountsOptions(
      wsId,
      query ?? {
        scope: { kind: "workspace" },
        window: {},
        includeSubIssues: true,
      },
    ),
    enabled: !!wsId && !!query,
  });
  return data;
}

/**
 * The counts a filter-sheet route should render, resolved from its `scope`
 * route param alone.
 *
 * The panel and its sub-picker are separate routes but must badge the SAME
 * numbers, so the scope→table-scope mapping and the window derivation live
 * here rather than being repeated at both call sites. `projectId` is only
 * meaningful for the project surface, and its absence yields `null` — no
 * counts, rather than counts from other projects (see `facetScopeFor`).
 *
 * Reads live in `lib/issue-facet-counts.ts` (pure) so this file stays thin.
 */
export function useFilterSheetFacetCounts(args: {
  wsId: string | null;
  sheetScope: "my" | "all" | "project";
  /** The surface's scope tab (`all/members/agents` or the My Issues set). */
  tab: string | undefined;
  window: IssueListWindowParams;
  includeSubIssues: boolean;
  projectId?: string | null;
  propertyIds?: readonly string[];
}): FacetCounts | undefined {
  const scope = facetScopeFor(args.sheetScope, args.tab, args.projectId);
  return useIssueFacetCounts(
    args.wsId,
    scope
      ? {
          scope,
          window: args.window,
          includeSubIssues: args.includeSubIssues,
          propertyIds: args.propertyIds,
        }
      : null,
  );
}
