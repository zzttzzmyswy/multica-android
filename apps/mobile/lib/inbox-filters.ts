/**
 * Archived-inbox filter state, and the pure helpers that read it.
 *
 * Mirrors web's `packages/core/inbox/filter-store.ts` (the same four
 * dimensions, the same `InboxFilters` shape, the same normalization) so a
 * filter set means the same thing on both clients — mobile cannot import
 * core's runtime, so this is a local re-implementation, not an import.
 *
 * The division of labour is deliberate and load-bearing:
 *
 *   - **The server filters.** `statuses` / `priorities` / `actors` /
 *     `unread_only` travel as request params on the paged endpoint, so a
 *     selection narrows the *fetched* set rather than only what is drawn. The
 *     archive grows without end; filtering it client-side would mean either
 *     fetching everything (which this screen exists to avoid) or filtering
 *     just the page in hand and reporting "12 results" about 910 rows.
 *   - **The client filters too**, over the pages already fetched, via
 *     `filterInboxItems`. Not belt-and-suspenders: it is what makes an
 *     optimistic unarchive disappear on the next paint without a round trip,
 *     and what keeps a row the user just acted on from lingering while the
 *     next page settles.
 *
 * The state lives in a workspace-keyed zustand store rather than in the
 * screen, because the inbox tab and the archived sub-view are different
 * renders of one screen but the filter must survive a trip into a
 * notification and back.
 */
import { create } from "zustand";
import type {
  InboxItem,
  IssuePriority,
  IssueStatus,
} from "@multica/core/types";

export interface InboxFilters {
  readonly statuses: readonly IssueStatus[];
  readonly priorities: readonly IssuePriority[];
  /** Actor keys — see `inboxActorKey`. */
  readonly actors: readonly string[];
  readonly unreadOnly: boolean;
  /** Only issues no agent is running or queued on. Active inbox only. */
  readonly idleOnly: boolean;
}

/**
 * The dimensions the server-filtered archive understands.
 *
 * It has no idle dimension — the backend answers no such parameter — so
 * `idleOnly` never reaches its endpoints or its query keys. Typing that
 * boundary is what keeps a selection made in the main inbox from silently
 * narrowing a paged request that cannot honour it.
 */
export type ArchivedInboxFilters = Omit<InboxFilters, "idleOnly">;

/**
 * Stable identity for "who this notification came from", used as the value of
 * the `actors` dimension.
 *
 * Members and agents key on their id. `system` has no id — the backend writes
 * an invalid UUID that serializes to null — so it keys on the type alone and
 * every system notification collapses into one bucket. Returns null when the
 * row carries no usable attribution; such a row can never match an actor
 * selection, exactly as a row without an issue can never match a status one.
 *
 * The `type:id` form is the wire format the facets endpoint returns actor keys
 * in, so this function is also the decoder ring between a row and its count.
 */
export function inboxActorKey(item: InboxItem): string | null {
  const type = item.actor_type;
  if (!type) return null;
  if (type === "system") return "system";
  return item.actor_id ? `${type}:${item.actor_id}` : null;
}

/** Inverse of `inboxActorKey`, for resolving a selection back to a directory. */
export function inboxActorKeyParts(key: string): { type: string; id: string } {
  const separator = key.indexOf(":");
  if (separator === -1) return { type: key, id: "" };
  return { type: key.slice(0, separator), id: key.slice(separator + 1) };
}

export const EMPTY_INBOX_FILTERS: InboxFilters = Object.freeze({
  statuses: Object.freeze([]) as readonly IssueStatus[],
  priorities: Object.freeze([]) as readonly IssuePriority[],
  actors: Object.freeze([]) as readonly string[],
  unreadOnly: false,
  idleOnly: false,
});

/**
 * The order the priority section renders in: the empty value first, then
 * severity descending. Mirrors `PRIORITY_DISPLAY_ORDER`
 * (packages/core/issues/config/priority.ts) — mobile re-states it rather than
 * importing core's runtime, the same way `lib/filter-issues.ts` re-states the
 * sort rank. Leading with "none" follows every other picker in the app: the
 * first row is always the empty value, so "clear this dimension" is in the
 * same place regardless of which filter was opened.
 */
export const INBOX_PRIORITY_FILTER_ORDER: readonly IssuePriority[] = [
  "none",
  "urgent",
  "high",
  "medium",
  "low",
];

/**
 * Sorted, so the same selection always produces the same cache key.
 *
 * Without this, selecting urgent then high and selecting high then urgent
 * would be two different query keys over identical results: two cache
 * entries, two in-flight requests, and a filter that appears to reload when
 * the user toggles a second box. The server sorts its params the same way
 * (web's `archivedInboxParams`), so this is the client agreeing with the wire
 * format rather than inventing one.
 *
 * The four archived dimensions are listed EXPLICITLY, and the return type is
 * `ArchivedInboxFilters`. That is the whole point of the type: `idleOnly`
 * carried in from the active inbox must not reach the archive's key or its
 * request, and a spread (`{...filters}`) would have carried it. Web does the
 * same thing by hand in `packages/core/inbox/queries.ts`'s
 * `normalizedInboxFilters` — a dropped field is the bug the shape prevents.
 */
export function normalizeInboxFilters(
  filters: InboxFilters | ArchivedInboxFilters,
): ArchivedInboxFilters {
  return {
    statuses: [...filters.statuses].sort(),
    priorities: [...filters.priorities].sort(),
    actors: [...filters.actors].sort(),
    unreadOnly: filters.unreadOnly,
  };
}

/** True when nothing is selected in any dimension. */
export function isEmptyInboxFilters(filters: InboxFilters): boolean {
  return inboxFilterCount(filters) === 0;
}

/** Number of active selections across every dimension — the filter badge. */
export function inboxFilterCount(filters: InboxFilters): number {
  return (
    filters.statuses.length +
    filters.priorities.length +
    filters.actors.length +
    (filters.unreadOnly ? 1 : 0) +
    (filters.idleOnly ? 1 : 0)
  );
}

const EMPTY_ISSUE_IDS: ReadonlySet<string> = new Set();

/**
 * Page state `filterInboxItems` needs beyond the selected filters.
 *
 * `activeIssueIds` is `undefined` when the task snapshot has not resolved yet,
 * and that is NOT the same as an empty set: see `filterInboxItems`.
 */
export interface InboxFilterContext {
  /** Issues an agent is running or queued on. Read only by `idleOnly`. */
  readonly activeIssueIds?: ReadonlySet<string>;
  /**
   * Group key (`issue_id ?? id`) of the notification whose detail is open.
   * Opening an unread notification marks it read, and replying from it can
   * start an agent on its issue — either would otherwise delete the row the
   * user is working in from under the detail pane. Each pin crosses only its
   * own dimension.
   */
  readonly pinnedUnreadKey?: string | null;
  readonly pinnedIdleKey?: string | null;
}

/**
 * The archive is filtered server-side and the backend has no idle dimension,
 * so a selection kept from the active inbox stays dormant there instead of
 * narrowing whichever archived pages happen to be loaded.
 *
 * The mobile counterpart of web's `inboxFiltersForArchive`
 * (`packages/core/inbox/filter-store.ts`). The archived screen reaches the
 * same conclusion by passing `filters` (never `mainFilters`) to the sheet and
 * the paged query — this function exists for the count that the sheet's Clear
 * gate reads, so that gate cannot go on advertising a dimension the list
 * cannot show.
 */
export function inboxFiltersForArchive(filters: InboxFilters): InboxFilters {
  return filters.idleOnly ? { ...filters, idleOnly: false } : filters;
}

/**
 * OR within a dimension, AND between dimensions.
 *
 * Every dimension is read off the row the list actually renders. For status
 * and priority that is free — they are properties of the issue, identical on
 * every notification in the group. For the actor it is a deliberate choice:
 * deduplication keeps only a group's newest notification, and that row shows
 * ITS actor's avatar and name. Matching an actor buried in an older row of
 * the same group would answer a different question ("issues Alice has ever
 * touched") than the one the row then displays, so selecting Alice would fill
 * the list with Bob. What you filter by is what you see.
 *
 * A row whose dimension value is null (an issue-less notification has no
 * status and no priority) never matches a selection on that dimension — it is
 * excluded, not passed through. `unreadOnly` reads the rendered row's `read`.
 *
 * `idleOnly` asks about the ISSUE, like status and priority, so a row without
 * one never matches: a plain notification (a failure alert, an unconfirmed
 * quick-create) is not "an issue nobody is working on", and letting it through
 * would fill a list that promises "no agents working" with rows that are not
 * about work at all. `activeIssueIds` is the running-OR-QUEUED set, matching
 * web's `new Set(activityByIssueId.keys())` (`inbox-page.tsx`).
 *
 * **An unresolved snapshot must not read as "everybody is idle".** Callers
 * pass `activeIssueIds: undefined` while the task snapshot is loading, and an
 * empty set is what an unresolved one would degrade to. With the filter on,
 * that would show the entire inbox for a moment and then throw most of it
 * away — the same flash `applyIssueFilters` avoids by failing closed. So an
 * undefined set makes the idle dimension match nothing, and the list shows its
 * empty/loading state rather than a lie.
 */
export function filterInboxItems(
  items: InboxItem[],
  filters: InboxFilters,
  {
    activeIssueIds,
    pinnedUnreadKey = null,
    pinnedIdleKey = null,
  }: InboxFilterContext = {},
): InboxItem[] {
  if (isEmptyInboxFilters(filters)) return items;

  const statuses = new Set<string>(filters.statuses);
  const priorities = new Set<string>(filters.priorities);
  const actors = new Set<string>(filters.actors);
  return items.filter((item) => {
    const actor = inboxActorKey(item);
    const matchesOtherDimensions =
      (statuses.size === 0 ||
        (item.issue_status != null && statuses.has(item.issue_status))) &&
      (priorities.size === 0 ||
        (item.issue_priority != null &&
          priorities.has(item.issue_priority))) &&
      (actors.size === 0 || (actor != null && actors.has(actor)));
    if (!matchesOtherDimensions) return false;
    const key = item.issue_id ?? item.id;
    const matchesUnread =
      !filters.unreadOnly ||
      item.read !== true ||
      (pinnedUnreadKey != null && key === pinnedUnreadKey);
    const matchesIdle =
      !filters.idleOnly ||
      (item.issue_id != null &&
        activeIssueIds != null &&
        !activeIssueIds.has(item.issue_id)) ||
      (pinnedIdleKey != null && key === pinnedIdleKey);
    return matchesUnread && matchesIdle;
  });
}

/**
 * Whether the backend projects `issue_priority`.
 *
 * Inferred from the parsed response, not from a version string: the paged
 * endpoint always serializes the column (null for notifications without an
 * issue), an older backend omits it entirely. Requiring every returned row to
 * carry a *defined* value is what keeps a mixed rolling-deploy response from
 * looking fully supported.
 *
 * `unknown` on an empty list is the honest answer — no rows is no evidence.
 * It is treated as "cannot filter", not "assume fine": see
 * `inboxFiltersForPrioritySupport`.
 */
export type InboxPriorityFilterSupport =
  | "unknown"
  | "supported"
  | "unsupported";

export function inboxPriorityFilterSupport(
  items: readonly InboxItem[],
): InboxPriorityFilterSupport {
  if (items.length === 0) return "unknown";
  return items.every((item) => item.issue_priority !== undefined)
    ? "supported"
    : "unsupported";
}

/**
 * Drop a priority selection the backend cannot be shown to honour.
 *
 * Only a proven `supported` keeps it — `unknown` and `unsupported` both strip.
 * That is upstream's rule (packages/core/inbox/filter-store.ts) and it is the
 * safe side of the trade: the priority dimension travels to the server, so a
 * selection the server cannot filter on would narrow nothing and the list
 * would contradict the checkbox.
 *
 * Stripping here does not destroy the user's choice — it returns a copy, and
 * the store still holds the original — so a backend that starts reporting the
 * field brings the selection back rather than having lost it.
 */
export function inboxFiltersForPrioritySupport<T extends InboxFilters | ArchivedInboxFilters>(
  filters: T,
  support: InboxPriorityFilterSupport,
): T {
  if (support === "supported" || filters.priorities.length === 0) {
    return filters;
  }
  return { ...filters, priorities: [] };
}

/**
 * Whether a priority selection will survive `inboxFiltersForPrioritySupport`.
 *
 * The sheet asks this to decide whether to print the priority section at all:
 * offering rows whose presses are then silently dropped is worse than not
 * offering them.
 */
export function showsPriorityFilter(
  support: InboxPriorityFilterSupport,
): boolean {
  return support === "supported";
}

interface InboxFilterState {
  filtersByWorkspace: Record<string, InboxFilters>;
  toggleStatusFilter: (wsId: string, status: IssueStatus) => void;
  togglePriorityFilter: (wsId: string, priority: IssuePriority) => void;
  toggleActorFilter: (wsId: string, actor: string) => void;
  toggleUnreadOnly: (wsId: string) => void;
  toggleIdleOnly: (wsId: string) => void;
  clearFilters: (wsId: string) => void;
}

function toggleValue<T extends string>(values: readonly T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((candidate) => candidate !== value)
    : [...values, value];
}

export const useInboxFilterStore = create<InboxFilterState>()((set) => ({
  filtersByWorkspace: {},
  toggleStatusFilter: (wsId, status) =>
    set((state) => {
      const current = state.filtersByWorkspace[wsId] ?? EMPTY_INBOX_FILTERS;
      return {
        filtersByWorkspace: {
          ...state.filtersByWorkspace,
          [wsId]: {
            ...current,
            statuses: toggleValue(current.statuses, status),
          },
        },
      };
    }),
  togglePriorityFilter: (wsId, priority) =>
    set((state) => {
      const current = state.filtersByWorkspace[wsId] ?? EMPTY_INBOX_FILTERS;
      return {
        filtersByWorkspace: {
          ...state.filtersByWorkspace,
          [wsId]: {
            ...current,
            priorities: toggleValue(current.priorities, priority),
          },
        },
      };
    }),
  toggleActorFilter: (wsId, actor) =>
    set((state) => {
      const current = state.filtersByWorkspace[wsId] ?? EMPTY_INBOX_FILTERS;
      return {
        filtersByWorkspace: {
          ...state.filtersByWorkspace,
          [wsId]: { ...current, actors: toggleValue(current.actors, actor) },
        },
      };
    }),
  toggleUnreadOnly: (wsId) =>
    set((state) => {
      const current = state.filtersByWorkspace[wsId] ?? EMPTY_INBOX_FILTERS;
      return {
        filtersByWorkspace: {
          ...state.filtersByWorkspace,
          [wsId]: { ...current, unreadOnly: !current.unreadOnly },
        },
      };
    }),
  toggleIdleOnly: (wsId) =>
    set((state) => {
      const current = state.filtersByWorkspace[wsId] ?? EMPTY_INBOX_FILTERS;
      return {
        filtersByWorkspace: {
          ...state.filtersByWorkspace,
          [wsId]: { ...current, idleOnly: !current.idleOnly },
        },
      };
    }),
  clearFilters: (wsId) =>
    set((state) => {
      if (!state.filtersByWorkspace[wsId]) return state;
      const { [wsId]: _removed, ...filtersByWorkspace } =
        state.filtersByWorkspace;
      return { filtersByWorkspace };
    }),
}));

/** Workspace-isolated filter state with a stable empty fallback. */
export function useInboxFilters(wsId: string | null): InboxFilters {
  return (
    useInboxFilterStore((state) =>
      wsId ? state.filtersByWorkspace[wsId] : undefined,
    ) ?? EMPTY_INBOX_FILTERS
  );
}
