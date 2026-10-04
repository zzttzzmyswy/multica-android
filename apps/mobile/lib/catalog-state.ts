/**
 * The four states a *remote directory* read can be in, resolved once so every
 * surface that renders one tells the same truth.
 *
 * The bug this exists to prevent (MYS-1892, generalised in MYS-1907): callers
 * wrote `const { data: rows = [] } = useQuery(...)` and then branched on
 * `rows.length === 0`. That default folds three genuinely different
 * situations — still loading, request failed, workspace really has none — into
 * the single "empty" branch, so a 30s timeout painted 「该工作区还没有自定义属
 * 性」 over a workspace whose `Severity` property demonstrably existed, and
 * 「此工作区暂无项目。请在网页端创建。」 over a project list that had merely not
 * arrived. The second sentence sends the user to the web UI to create something
 * they already have.
 *
 * A "directory" here is any workspace-scoped list a picker is built from:
 * members, agents, squads, projects, labels, custom properties. They all share
 * one defect shape because they all share one read shape.
 *
 * Resolution order, and why each step sits where it does:
 *
 *   1. Items present → `ready`/`empty` by length. This comes first so a
 *      refetch that fails on top of a cached directory stays usable data
 *      rather than blocking the surface — the same rule `buildIssueStatusCatalog`
 *      uses for a failed refresh over an existing list. It also keeps a
 *      genuinely-empty workspace from flapping into an error state on a
 *      background refetch hiccup.
 *   2. `isError` → `error`, before `isPending`. Measured against the pinned
 *      `@tanstack/query-core` 5.96 a failure never reports `isPending` at the
 *      same time (during the automatic retry pass and during a manual refetch
 *      after a failure the observer reports `isPending: false, isError: true`
 *      with `data: undefined`), so the two are not actually competing — the
 *      order is defensive, so that a future version which does pair them still
 *      reads as failed rather than sending the user back to a spinner.
 *   3. `isPending` → `loading`. The honest "nothing has resolved yet".
 *   4. Otherwise `empty` — settled, no error, and still no rows. That covers a
 *      success payload that carried nothing, and it is still the only path
 *      allowed to claim the workspace has none.
 *
 * Kept DOM-free and framework-free so the decision is unit-testable in the
 * Node vitest lane, where there is no RN renderer to exercise branches through.
 */

export type CatalogState = "loading" | "error" | "empty" | "ready";

export interface CatalogQueryInput<T> {
  /** Rows the query resolved, or `undefined` when it has none yet. */
  items: T[] | undefined;
  /** React Query's `isPending` — no data and no error so far. */
  isPending: boolean;
  /** React Query's `isError`. */
  isError: boolean;
}

export function resolveCatalogState<T>({
  items,
  isPending,
  isError,
}: CatalogQueryInput<T>): CatalogState {
  if (items !== undefined) {
    return items.length > 0 ? "ready" : "empty";
  }
  if (isError) return "error";
  if (isPending) return "loading";
  return "empty";
}

/** True only for the states where the directory can be trusted to be complete —
 *  the request settled and the resulting list is the whole answer. Callers
 *  that resolve one row out of the directory and then treat "not in the list"
 *  as a fact (a picker naming its definition, an editor saying "not found")
 *  gate on this instead of branching on `length === 0`. */
export function isCatalogResolved(state: CatalogState): boolean {
  return state === "ready" || state === "empty";
}

/** The four states a *single record* read can be in, on a page that resolves
 *  one row (a detail or edit route) rather than painting a list.
 *
 *  Same vocabulary and the same defect as `resolveCatalogState`, one level up.
 *  A record page wrote `if (q.isLoading) …; if (!record) → "does not exist"`,
 *  and `isLoading` only covers the *first* attempt: once a request fails,
 *  `isLoading` is false and `record` is undefined, so `!record` rendered
 *  "not found" over a record that was merely unreachable. The sentences this
 *  produced were all assertions of fact — 「还没有智能体」, 「还没有小队」, and
 *  worst of all 「该工作区已不可用。」, which also pushed the user out to the
 *  workspace switcher. A 30s timeout (api.ts) times two (query-client retry)
 *  was enough to trigger every one of them.
 *
 *  `sources` is every read the record is resolved out of, because a page may
 *  look a row up in more than one catalog. The fold is deliberately
 *  pessimistic in the direction that matters: absent-from-one read is not
 *  evidence of absent overall, so *any* source still loading or failed keeps
 *  the page off the "missing" branch. Claiming a record does not exist is
 *  allowed only once every source settled and none of them had it.
 *
 *  `empty` is reused as "settled, and the record is genuinely not there" — the
 *  same meaning it has for a directory, so `CatalogStatus` can paint this
 *  state too and the not-found copy stays the caller's `emptyMessage`. */
export function resolveRecordState<T>(
  record: T | null | undefined,
  sources: readonly { isPending: boolean; isError: boolean }[],
): CatalogState {
  if (record != null) return "ready";
  if (sources.some((source) => source.isError)) return "error";
  if (sources.some((source) => source.isPending)) return "loading";
  return "empty";
}

/** Why a picker may not yet state an absence, over ALL the directories it
 *  reads: `"error"` if any of them failed, `"loading"` if any of the rest are
 *  still arriving, `null` once every one settled — the only case where
 *  "nothing here" is a fact rather than a guess.
 *
 *  Failure outranks loading on purpose: a spinner over a request that already
 *  failed hides both the failure and its retry.
 *
 *  Note the deliberate asymmetry with the *rendering* decision: one directory
 *  arriving is enough to render rows (hiding working data behind another
 *  directory's failure would be a new way to lose information), but it is not
 *  enough to claim the union is empty. */
export function unsettledCatalogStatus(
  states: CatalogState[],
): "loading" | "error" | null {
  if (states.every(isCatalogResolved)) return null;
  return states.some((state) => state === "error") ? "error" : "loading";
}

/** What a picker's empty slot is allowed to say, once its directories'
 *  states and the current search text are known.
 *
 *   - `status`  → paint the load state (spinner, or failure + retry) and claim
 *                 nothing about the data.
 *   - `no-match` → a settled directory matched the search text zero times.
 *   - `empty`   → every directory settled and there is genuinely none. */
export type CatalogEmptyVerdict =
  | { kind: "status"; status: "loading" | "error" }
  | { kind: "no-match" }
  | { kind: "empty" };

export function resolveCatalogEmpty(
  states: CatalogState[],
  hasQuery: boolean,
): CatalogEmptyVerdict {
  const unsettled = unsettledCatalogStatus(states);
  if (unsettled) return { kind: "status", status: unsettled };
  return hasQuery ? { kind: "no-match" } : { kind: "empty" };
}
