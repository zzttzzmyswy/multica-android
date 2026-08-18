/**
 * Pure issue-status catalog layer (MUL-6243) — no React, no i18n, no expo.
 *
 * Mirrors web's `packages/core/issue-statuses/queries.ts` catalog semantics
 * so the mobile surface answers the same questions the same way:
 *
 * - a status KEY is open (7 built-ins + workspace custom keys)
 * - a status CATEGORY is the closed 7-item union, and a category's value IS
 *   the canonical built-in status key
 * - built-in keys resolve with no catalog at all (a built-in key is its own
 *   category), which keeps a workspace with no custom statuses rendering
 *   byte-identically before the catalog fetch lands
 *
 * Built-in english fallback labels mirror `lib/issue-status.ts` `STATUS_LABEL`
 * (which itself mirrors `packages/core/issues/config/status.ts`). The
 * i18n-aware label lookup used by surfaces lives in the status-options hook.
 */
import type {
  Issue,
  IssueStatusCategory,
  IssueStatusEntry,
} from "@multica/core/types";

/** The 7 categories in canonical display order (web's ALL_STATUSES). */
export const ISSUE_STATUS_CATEGORIES: IssueStatusCategory[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
];

const CATEGORY_SET = new Set<string>(ISSUE_STATUS_CATEGORIES);

const CATEGORY_RANK = new Map<string, number>(
  ISSUE_STATUS_CATEGORIES.map((c, i) => [c, i]),
);

/** English canonical label mirror — see module doc. */
const BUILTIN_STATUS_LABEL: Record<string, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  blocked: "Blocked",
  cancelled: "Cancelled",
};

/** True when `value` is one of the 7 built-in status keys (which ARE the
 *  categories). */
export function isIssueStatusCategory(value: string): value is IssueStatusCategory {
  return CATEGORY_SET.has(value);
}

/** The category a bare status KEY belongs to. Exact for the 7 built-ins; a
 *  custom key no catalog resolved falls back to `todo` so presentation
 *  lookups always render something. */
export function statusCategoryOfKey(statusKey: string): IssueStatusCategory {
  return isIssueStatusCategory(statusKey) ? statusKey : "todo";
}

/**
 * The category an issue's status belongs to — the bucket it occupies on the
 * board. Reads the server-provided `status_category` when present, else falls
 * back to the rule that makes that field optional: a BUILT-IN status key is
 * its own category. Returns null for a custom key this response did not
 * resolve, so callers skip bucketing rather than guessing a wrong column.
 */
export function issueStatusCategoryOfIssue(
  issue: Pick<Issue, "status" | "status_category">,
): IssueStatusCategory | null {
  const fromServer = issue.status_category;
  if (fromServer && isIssueStatusCategory(fromServer)) return fromServer;
  if (isIssueStatusCategory(issue.status)) return issue.status;
  return null;
}

/**
 * Rewrites a patch's `status_category` to match its `status`, before the
 * patch reaches any cache. The server backfills a category on every issue, so
 * a cached entity looks like `{status:"todo", status_category:"todo"}`; an
 * optimistic patch carrying only `{status:"done"}` would otherwise keep the
 * stale category while the card moves bucket. A patch that does not touch
 * `status` is returned unchanged; an unresolvable custom key drops the
 * inherited value rather than trusting a stale one.
 */
export function normalizeStatusPatch(patch: Partial<Issue>): Partial<Issue> {
  if (patch.status === undefined) return patch;
  const category = issueStatusCategoryOfIssue({
    status: patch.status,
    status_category: patch.status_category,
  });
  return { ...patch, status_category: category ?? undefined };
}

/**
 * The server's catalog ordering, mirrored for client-side re-sorts.
 * Category rank, then intra-category position, then key as a stable
 * tiebreak.
 */
export function compareIssueStatusEntries(
  a: IssueStatusEntry,
  b: IssueStatusEntry,
): number {
  const rank =
    (CATEGORY_RANK.get(a.category) ?? ISSUE_STATUS_CATEGORIES.length) -
    (CATEGORY_RANK.get(b.category) ?? ISSUE_STATUS_CATEGORIES.length);
  if (rank !== 0) return rank;
  if (a.position !== b.position) return a.position - b.position;
  return a.key.localeCompare(b.key);
}

/**
 * A resolved view over the catalog. Every lookup falls back to something
 * renderable: an issue can legitimately carry a status this client has not
 * heard of (created moments ago elsewhere, or a fetch still in flight).
 */
export interface IssueStatusCatalog {
  /** Every status in display order, ARCHIVED INCLUDED — issues left on an
   *  archived status keep their real name/color/category. Surfaces that offer
   *  a status to pick use `activeStatuses`. */
  statuses: IssueStatusEntry[];
  /** Assignable statuses — `statuses` minus archived ones. */
  activeStatuses: IssueStatusEntry[];
  /** Category for a status key; falls back to the key when built-in, else "todo". */
  categoryOf: (statusKey: string) => IssueStatusCategory;
  /** Human label for a status key; falls back to the category label, then the raw key. */
  labelOf: (statusKey: string) => string;
  /** Catalog entry for a status key, when the catalog knows it. */
  entryOf: (statusKey: string) => IssueStatusEntry | undefined;
  /** ACTIVE statuses belonging to one category, in display order. */
  inCategory: (category: IssueStatusCategory) => IssueStatusEntry[];
  /** True once the catalog has loaded; false while still in flight. */
  isLoaded: boolean;
  /** The catalog is still in flight and nothing has resolved yet. */
  isPending: boolean;
  /** The catalog request failed AND there is no usable snapshot to fall back on. */
  isError: boolean;
  /** Re-runs the catalog request. Wired to a surface retry affordance. */
  retry: () => void;
  /**
   * True when the catalog is LOADED and holds at least one custom status —
   * the switch for the category-grouped surface contract. A workspace with no
   * custom statuses therefore keeps rendering exactly as before this feature.
   */
  hasCustomStatuses: boolean;
}

/**
 * Builds the resolved catalog from a raw entry list. Pure, so non-React
 * callers can use it with a list they already hold.
 */
export function buildIssueStatusCatalog(
  entries: IssueStatusEntry[] | undefined,
  status: { isPending?: boolean; isError?: boolean; retry?: () => void } = {},
): IssueStatusCatalog {
  const list = entries ?? [];
  const byKey = new Map(list.map((e) => [e.key, e]));

  const categoryOf = (statusKey: string): IssueStatusCategory => {
    const category = byKey.get(statusKey)?.category;
    if (category && isIssueStatusCategory(category)) return category;
    // A built-in key IS its own category, so an unloaded catalog still
    // resolves all 7 — which keeps the default workspace identical before the
    // fetch lands.
    if (isIssueStatusCategory(statusKey)) return statusKey;
    // An unknown custom key: render it somewhere sane rather than dropping it.
    return "todo";
  };

  return {
    statuses: list,
    activeStatuses: list.filter((e) => !e.archived_at),
    categoryOf,
    entryOf: (statusKey) => byKey.get(statusKey),
    labelOf: (statusKey) => {
      const entry = byKey.get(statusKey);
      if (entry) return entry.name;
      if (isIssueStatusCategory(statusKey)) {
        return BUILTIN_STATUS_LABEL[statusKey] ?? statusKey;
      }
      return statusKey;
    },
    inCategory: (category) =>
      list.filter((e) => e.category === category && !e.archived_at),
    isLoaded: entries !== undefined,
    // Defaults describe a non-React caller holding a list it already has:
    // resolved when entries are present, still pending when they are not.
    isPending: status.isPending ?? entries === undefined,
    // A failure that still has entries behind it is stale-data, not blocking.
    isError: (status.isError ?? false) && entries === undefined,
    retry: status.retry ?? (() => {}),
    hasCustomStatuses:
      entries !== undefined && list.some((e) => e.is_system !== true),
  };
}

/** An empty, unloaded catalog — the pre-flight render shape. */
export const EMPTY_ISSUE_STATUS_CATALOG: IssueStatusCatalog =
  buildIssueStatusCatalog(undefined);