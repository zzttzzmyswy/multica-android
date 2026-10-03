/**
 * The four states a workspace property-catalog read can be in, resolved once
 * so every surface that renders the catalog tells the same truth.
 *
 * The bug this exists to prevent (MYS-1892): callers wrote
 * `const { data: properties = [] } = useQuery(...)` and then branched on
 * `properties.length === 0`. That default folds three genuinely different
 * situations — still loading, request failed, workspace really has none —
 * into the single "empty" branch, so a 30s timeout painted 「该工作区还没有自
 * 定义属性」 over a workspace whose `Severity` property demonstrably existed.
 * The same collapse made 「没有可添加的属性」 and 「未找到该属性」 appear for a
 * property that was merely unreachable.
 *
 * Resolution order, and why each step sits where it does:
 *
 *   1. Definitions present → `ready`/`empty` by length. This comes first so a
 *      refetch that fails on top of a cached catalog stays usable data rather
 *      than blocking the surface — the same rule `buildIssueStatusCatalog`
 *      uses for a failed refresh over an existing list. It also keeps a
 *      genuinely-empty workspace from flapping into an error state on a
 *      background refetch hiccup.
 *   2. `isError` → `error`. Checked before `isPending` because React Query
 *      reports pending again on the retry pass; a failed read with nothing
 *      behind it must read as failed, not send the user back to a spinner.
 *   3. `isPending` → `loading`. The honest "nothing has resolved yet".
 *   4. Otherwise `empty` — settled, no error, and still no definitions. That
 *      covers a success payload that carried no catalog, and it is still the
 *      only path allowed to claim the workspace has no properties.
 *
 * Kept DOM-free and framework-free so the decision is unit-testable in the
 * Node vitest lane, where there is no RN renderer to exercise branches through.
 */
import type { IssueProperty } from "@multica/core/types";

export type PropertyCatalogState = "loading" | "error" | "empty" | "ready";

export interface PropertyCatalogQueryInput {
  /** Definitions the query resolved, or `undefined` when it has none yet. */
  definitions: IssueProperty[] | undefined;
  /** React Query's `isPending` — no data and no error so far. */
  isPending: boolean;
  /** React Query's `isError`. */
  isError: boolean;
}

export function resolvePropertyCatalogState({
  definitions,
  isPending,
  isError,
}: PropertyCatalogQueryInput): PropertyCatalogState {
  if (definitions !== undefined) {
    return definitions.length > 0 ? "ready" : "empty";
  }
  if (isError) return "error";
  if (isPending) return "loading";
  return "empty";
}

/** True only for the states where the catalog can be trusted to be complete —
 *  the request settled and the resulting list is the whole answer. Callers
 *  that resolve one definition out of the catalog and then treat "not in the
 *  list" as a fact (a picker naming its definition, an editor saying "not
 *  found") gate on this instead of branching on `length === 0`. */
export function isPropertyCatalogResolved(
  state: PropertyCatalogState,
): boolean {
  return state === "ready" || state === "empty";
}
