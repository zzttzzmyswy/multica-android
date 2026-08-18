/**
 * View-bar preference query layer (iteration-67). Mirrors web
 * `packages/core/issue-views/preferences.ts` on the phone: a whole-document
 * prefs blob (`{hidden: [], order: []}`) per (workspace, scope), keyed like
 * the other issue-view keys so invalidation surfaces reach both clients.
 *
 * Value vocabulary matches web: bar items are addressed as `view:<id>` so an
 * order/hidden entry survives a rename and a deleted view's stale id is simply
 * ignored (and dropped on the next write — see savePrefs in issue-view-bar).
 */
import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";
import type { IssueViewScope } from "@/data/queries/issue-views";

export interface ViewBarPrefs {
  hidden: string[];
  order: string[];
}

export const EMPTY_VIEW_BAR_PREFS: ViewBarPrefs = { hidden: [], order: [] };

export const issueViewPrefKeys = {
  all: (wsId: string | null) => ["issue-view-prefs", wsId] as const,
  scope: (wsId: string | null, scope: IssueViewScope) =>
    [
      ...issueViewPrefKeys.all(wsId),
      scope.scope_type,
      scope.scope_id ?? null,
    ] as const,
};

export function issueViewPreferenceOptions(
  wsId: string | null,
  scope: IssueViewScope,
) {
  return queryOptions({
    queryKey: issueViewPrefKeys.scope(wsId, scope),
    queryFn: () => api.getIssueViewPreference(scope),
    enabled: !!wsId,
  });
}

/**
 * Compose the view bar: apply the user's order, drop hidden items. Unknown
 * ids in prefs (deleted views) are ignored; items absent from `order` append
 * in their natural position. There is no built-in anchor on mobile (the "+"
 * create affordance is always present), so `anchorId` is exposed for parity
 * with web and defaults to empty.
 */
export function applyViewBarPrefs<T extends { barItemId: string }>(
  items: T[],
  prefs: ViewBarPrefs | undefined,
  anchorId = "",
): { visible: T[]; hiddenSet: Set<string>; ordered: T[] } {
  const order = prefs?.order ?? [];
  const hiddenSet = new Set(prefs?.hidden ?? []);
  if (anchorId) hiddenSet.delete(anchorId);

  const byId = new Map(items.map((item) => [item.barItemId, item]));
  const ordered: T[] = [];
  for (const id of order) {
    const item = byId.get(id);
    if (item) {
      ordered.push(item);
      byId.delete(id);
    }
  }
  for (const item of items) {
    if (byId.has(item.barItemId)) ordered.push(item);
  }

  return {
    ordered,
    hiddenSet,
    visible: ordered.filter((item) => !hiddenSet.has(item.barItemId)),
  };
}

/** Bar-item id vocabulary for saved views — mirrors web `view:<id>`. */
export const viewBarItemId = (viewId: string) => `view:${viewId}`;

/** Drop stale ids (deleted views / renamed builtins) before persisting —
 *  mirrors web view-bar.tsx:305-317. Runs on every prefs write so a deleted
 *  view's entry is cleaned at the next toggle/reorder, and the apply
 *  function is authoritative on an un-cleaned doc anyway. */
export function sanitizeViewBarPrefs(
  prefs: ViewBarPrefs,
  knownIds: readonly string[],
): ViewBarPrefs {
  const known = new Set(knownIds);
  return {
    hidden: prefs.hidden.filter((id) => known.has(id)),
    order: prefs.order.filter((id) => known.has(id)),
  };
}