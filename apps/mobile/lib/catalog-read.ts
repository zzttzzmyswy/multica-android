/**
 * One workspace directory read, wrapped so its load state survives to the
 * surface that renders it.
 *
 * Every picker in this app is built from a workspace-scoped list — members,
 * agents, squads, projects, labels, custom properties. They all had the same
 * read shape (`const { data: rows = [] } = useQuery(...)`) and therefore the
 * same defect: `rows.length === 0` cannot distinguish "still loading", "the
 * request failed" and "this workspace has none", so a failed read rendered the
 * *empty* sentence. 「此工作区暂无项目。请在网页端创建。」 told a user to go create
 * a project they already had (MYS-1907, same root as MYS-1892).
 *
 * `catalogRead` keeps the state next to the rows, so the surface can branch on
 * what actually happened. The `items: []` fallback stays, but it is never the
 * basis for an absence claim: pair it with `state` (or `isResolved`) whenever
 * "there is nothing here" is being said out loud.
 *
 * Takes the query object rather than the query options on purpose — every
 * option builder in `data/queries/` returns a different concrete type, and
 * re-deriving one here would mean re-stating each builder's generics at every
 * call site for no benefit.
 */
import type { UseQueryResult } from "@tanstack/react-query";
import {
  isCatalogResolved,
  resolveCatalogState,
  resolveRecordState,
  type CatalogState,
} from "@/lib/catalog-state";

/** A directory read with its load state intact. */
export interface CatalogRead<T> {
  /** Rows the query resolved. `[]` in every non-`ready` state — render the
   *  state, never this length, when the distinction matters. */
  items: T[];
  state: CatalogState;
  /** The request settled, so `items` is the whole answer and something
   *  missing from it is genuinely missing. */
  isResolved: boolean;
  /** Re-runs the request. Wire this to the retry affordance in `error`. */
  retry: () => void;
}

export function catalogRead<T>(query: UseQueryResult<T[]>): CatalogRead<T> {
  const state = resolveCatalogState({
    items: query.data,
    isPending: query.isPending,
    isError: query.isError,
  });

  return {
    items: query.data ?? [],
    state,
    isResolved: isCatalogResolved(state),
    retry: query.refetch,
  };
}

/** Re-runs every read a multi-directory picker is showing. Wired to the one
 *  retry affordance those pickers have, since a user who taps "retry" after a
 *  failure wants the picker usable, not one of its three directories. */
export function retryCatalogs(...reads: { retry: () => void }[]): void {
  for (const read of reads) read.retry();
}

/** A *record* read with its load state intact — the page-level twin of
 *  `CatalogRead`, for detail and edit routes that resolve one row out of a
 *  directory instead of painting a list.
 *
 *  Those pages collapsed the same three situations one level up: `if
 *  (isLoading) …; if (!record) → "does not exist"`. `isLoading` is only ever
 *  true for the *first* attempt, so a failed read left `record` undefined with
 *  `isLoading` false and the page asserted the record was gone (MYS-1908).
 *
 *  `record` is the row the caller looked up, but it is only meaningful in the
 *  `ready` state — a page must branch on `state` (or `isResolved`) before
 *  saying the record does not exist. `recordRead` exists so those pages keep
 *  the same read-and-state shape the pickers already use, rather than each
 *  re-deriving it. */
export interface RecordRead<T> {
  /** The row the caller resolved, or `null`. Only trustworthy when `ready`. */
  record: T | null;
  state: CatalogState;
  /** Every source settled — so `record === null` means "genuinely gone",
   *  not "we could not find out". Gate the not-found branch on this. */
  isResolved: boolean;
  /** Re-runs every source. Wire this to the retry affordance in `error`. */
  retry: () => void;
}

export function recordRead<T>(
  record: T | null | undefined,
  sources: UseQueryResult<unknown>[],
): RecordRead<T> {
  const state = resolveRecordState(record, sources);

  return {
    record: record ?? null,
    state,
    isResolved: isCatalogResolved(state),
    // A record page has exactly one retry affordance and the user wants the
    // page usable, not one particular source re-fetched — same reasoning as
    // `retryCatalogs`.
    retry: () => {
      for (const source of sources) void source.refetch();
    },
  };
}
