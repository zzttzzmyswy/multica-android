/**
 * Client-side issue list predicate + sort + grouping helpers.
 *
 * Mirrors the filter slice of web's `applyIssueFilters()` at
 * `packages/views/issues/utils/filter.ts:117-176` — same predicates, same
 * "empty array = show all" semantics, same `includeNoAssignee` /
 * `includeNoProject` OR-with-inclusion semantics. Required by the same-N
 * parity rule in apps/mobile/CLAUDE.md.
 *
 * Sorting mirrors `packages/views/issues/utils/sort.ts` `sortIssues()`
 * (mobile adds an explicit `updated_at` branch — web lists it in
 * SORT_OPTIONS but that util falls through to position; mobile renders the
 * field the filter UI advertises).
 *
 * Grouping mirrors web's status bucketing (`issues-page.tsx`) plus the
 * assignee option from `GROUPING_OPTIONS`, so both list screens can render
 * a SectionList over status OR assignee with no view-mode switching.
 */
import type {
  Issue,
  IssuePriority,
  IssueProperty,
  IssueStatus,
  IssueStatusCategory,
} from "@multica/core/types";
import type {
  ActorFilterValue,
  IssueDateFilterValue,
  IssueGrouping,
  IssueSortDirection,
  IssueSortField,
} from "@/data/stores/issue-filter-slice";
import { propertyIdFromViewKey } from "@/data/stores/issue-filter-slice";
import { issueStatusCategoryOfIssue } from "./issue-status-catalog";

export interface IssueFilterState {
  statusFilters: IssueStatus[];
  priorityFilters: IssuePriority[];
  assigneeFilters: ActorFilterValue[];
  includeNoAssignee: boolean;
  creatorFilters: ActorFilterValue[];
  projectFilters: string[];
  includeNoProject: boolean;
  labelFilters: string[];
  /** Custom-property definition id → selected option ids (checkbox
   *  definitions use "true"/"false"). OR within a definition, AND across
   *  — filtered in `issueMatchesPropertyFilters`. */
  propertyFilters: Record<string, string[]>;
  /**
   * Date window. Carried for chip rendering + active-detection only — the
   * FILTER itself is applied server-side (date_field/date_start/date_end
   * window), exactly like web: the client predicate has no date branch.
   */
  dateFilter: IssueDateFilterValue | null;
  /**
   * Keep only issues with at least one agent task in `running` status
   * (web's `agentRunningFilter` → `workingOnly`). The set comes from the
   * workspace agent-task snapshot, passed separately as
   * `IssueFilterContext.runningIssueIds` so this module stays free of
   * fetching — same split as web's `filter.ts`.
   */
  workingOnly: boolean;
  /**
   * Show issues that have a parent (sub-issues). Only an explicit `false`
   * hides them — web's `filter.ts:114` reads `=== false`, so a missing /
   * undefined value keeps the historical "show everything" behaviour.
   * Applied first, alongside `workingOnly`, in `applyIssueFilters`.
   */
  showSubIssues: boolean;
}

/**
 * Data the predicate needs that is not part of the filter state. Mirrors
 * web `IssueFilterContext` (packages/views/issues/utils/filter.ts:49-52)
 * minus `activityByIssueId`: mobile's surfaces have no per-issue activity
 * map, so the snapshot projection is the single representation here.
 */
export interface IssueFilterContext {
  /** Distinct issue ids with a RUNNING agent task. `undefined` = the
   *  projection has not resolved yet. */
  runningIssueIds?: ReadonlySet<string>;
}

/** Empty filter snapshot — "show all". */
export const EMPTY_ISSUE_FILTER: IssueFilterState = {
  statusFilters: [],
  priorityFilters: [],
  assigneeFilters: [],
  includeNoAssignee: false,
  creatorFilters: [],
  projectFilters: [],
  includeNoProject: false,
  labelFilters: [],
  propertyFilters: {},
  dateFilter: null,
  workingOnly: false,
  showSubIssues: true,
};

/**
 * Match one issue against the property filters. Mirrors web's
 * `issueMatchesPropertyFilters` (packages/views/issues/utils/filter.ts:61-82):
 * select values are single option-id strings, multi_select values are
 * option-id arrays, checkbox values are booleans compared against the
 * "true"/"false" pseudo-options. An issue with no value for a filtered
 * definition never matches it.
 */
export function issueMatchesPropertyFilters(
  issue: Issue,
  propertyFilters: Record<string, string[]> | undefined,
): boolean {
  if (!propertyFilters || Object.keys(propertyFilters).length === 0)
    return true;
  for (const [propertyId, selected] of Object.entries(propertyFilters)) {
    if (selected.length === 0) continue;
    const value = issue.properties?.[propertyId];
    if (value === undefined) return false;
    if (typeof value === "string") {
      if (!selected.includes(value)) return false;
    } else if (Array.isArray(value)) {
      if (!value.some((id) => selected.includes(id))) return false;
    } else if (typeof value === "boolean") {
      if (!selected.includes(String(value))) return false;
    } else {
      return false;
    }
  }
  return true;
}

/**
 * Apply every filter dimension. Mirrors web `applyIssueFilters` at
 * packages/views/issues/utils/filter.ts (status/priority/assignee+no-
 * assignee/creator/project+no-project/label/property/working-only). Date is
 * intentionally absent — its server window is the single source of truth
 * (web does the same).
 *
 * `workingOnly` is fail-closed in the same way web's is: when the filter is
 * on but `runningIssueIds` is missing (projection unresolved) it hides
 * everything, because the user asked for "only what is working" and nothing
 * has been shown to be working yet. An EMPTY set is a real answer — the
 * projection resolved and nobody is running — so it also yields an empty
 * list, not a bypass.
 */
export function applyIssueFilters(
  issues: Issue[],
  filters: IssueFilterState,
  context: IssueFilterContext = {},
): Issue[] {
  const {
    statusFilters,
    priorityFilters,
    assigneeFilters,
    includeNoAssignee,
    creatorFilters,
    projectFilters,
    includeNoProject,
    labelFilters,
    propertyFilters,
    workingOnly,
    showSubIssues,
  } = filters;

  const hasAssigneeFilter =
    assigneeFilters.length > 0 || includeNoAssignee;
  const hasProjectFilter =
    projectFilters.length > 0 || includeNoProject;
  const applyWorkingOnly = workingOnly === true;
  // Only an explicit `false` hides sub-issues (web filter.ts:114).
  const hideSubIssues = showSubIssues === false;

  return issues.filter((issue) => {
    if (applyWorkingOnly && !context.runningIssueIds?.has(issue.id)) {
      return false;
    }

    if (hideSubIssues && issue.parent_issue_id) return false;

    if (
      statusFilters.length > 0 &&
      !statusFilters.includes(issue.status)
    ) {
      return false;
    }
    if (
      priorityFilters.length > 0 &&
      !priorityFilters.includes(issue.priority)
    ) {
      return false;
    }

    if (hasAssigneeFilter) {
      if (!issue.assignee_id) {
        // Unassigned issue — show only if "No assignee" is checked
        if (!includeNoAssignee) return false;
      } else if (assigneeFilters.length > 0) {
        if (
          !assigneeFilters.some(
            (f) =>
              f.type === issue.assignee_type && f.id === issue.assignee_id,
          )
        ) {
          return false;
        }
      } else {
        // Only "No assignee" checked → hide assigned issues
        return false;
      }
    }

    if (
      creatorFilters.length > 0 &&
      !creatorFilters.some(
        (f) => f.type === issue.creator_type && f.id === issue.creator_id,
      )
    ) {
      return false;
    }

    if (hasProjectFilter) {
      if (!issue.project_id) {
        if (!includeNoProject) return false;
      } else if (projectFilters.length > 0) {
        if (!projectFilters.includes(issue.project_id)) return false;
      } else {
        // Only "No project" checked → hide issues that have a project
        return false;
      }
    }

    if (labelFilters.length > 0) {
      // OR within labels: keep issues carrying any selected label.
      const labels = issue.labels;
      if (!labels || labels.length === 0) return false;
      if (!labels.some((l) => labelFilters.includes(l.id))) return false;
    }

    if (!issueMatchesPropertyFilters(issue, propertyFilters)) return false;

    return true;
  });
}

/**
 * Deprecated thin wrapper keeping the old positional signature working for
 * the brief period both screens migrate. Prefer `applyIssueFilters` for new
 * code — it carries the full dimension set this iteration adds.
 */
export function filterIssues(
  issues: Issue[],
  statusFilters: IssueStatus[],
  priorityFilters: IssuePriority[],
): Issue[] {
  return applyIssueFilters(issues, {
    ...EMPTY_ISSUE_FILTER,
    statusFilters,
    priorityFilters,
  });
}

/** Sort-key rank for `status` / `priority`, matching web sort.ts PRIORITY
 *  RANK + the server's status CASE (issue.go:995). */
const STATUS_RANK: Record<string, number> = {
  backlog: 0,
  todo: 1,
  in_progress: 2,
  in_review: 3,
  done: 4,
  blocked: 5,
  cancelled: 6,
};

// Mirrors PRIORITY_ORDER in packages/core/issues/config/priority.ts.
const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

/**
 * Client-side sort matching web `sortIssues`
 * (packages/views/issues/utils/sort.ts:10-71). Missing dates sort last in
 * asc (web returns 1 for missing in both directions, then a whole-array
 * reverse flips them to the front on desc — mirrored here via the inverse
 * comparator for date fields so nulls stay at the end in BOTH directions).
 */
export function sortIssues(
  issues: Issue[],
  field: IssueSortField,
  direction: IssueSortDirection,
): Issue[] {
  const dir = direction === "desc" ? -1 : 1;
  // `property:<id>` sorts by the custom-property value (web sort.ts:15-34).
  // Number values sort numerically, date values are date-only "YYYY-MM-DD"
  // strings that sort correctly lexically. Direction applies to the VALUE
  // comparison only — issues without a value sort last in BOTH directions,
  // so they never jump to the top on desc.
  const propertyId = propertyIdFromViewKey(field);
  if (propertyId) {
    return [...issues].sort((a, b) => {
      const av = a.properties?.[propertyId];
      const bv = b.properties?.[propertyId];
      // Arrays (multi_select) and objects have no scalar order → missing.
      const aMissing = av === undefined || Array.isArray(av);
      const bMissing = bv === undefined || Array.isArray(bv);
      if (aMissing && bMissing) return 0;
      if (aMissing) return 1;
      if (bMissing) return -1;
      if (typeof av === "number" && typeof bv === "number") {
        return dir * (av - bv);
      }
      return dir * String(av).localeCompare(String(bv));
    });
  }
  // Copy-then-sort (no Array.prototype.toSorted — Hermes on Android may not
  // ship the ES2023 methods). Web's sort.ts uses toSorted on modern runtime.
  const sorted = [...issues].sort((a, b) => {
    switch (field) {
      case "status":
        return (
          (STATUS_RANK[a.status] ?? 99) - (STATUS_RANK[b.status] ?? 99)
        );
      case "priority":
        return (
          (PRIORITY_RANK[a.priority] ?? 99) -
          (PRIORITY_RANK[b.priority] ?? 99)
        );
      case "start_date":
      case "due_date": {
        const av = a[field];
        const bv = b[field];
        if (!av && !bv) return 0;
        if (!av) return 1;
        if (!bv) return -1;
        const diff = new Date(av).getTime() - new Date(bv).getTime();
        // Nulls last in both directions: web reverses the whole array on
        // desc which would push nulls to the front — diverge deliberately
        // so empty dates never sort above dated issues.
        return direction === "desc" ? -diff : diff;
      }
      case "created_at":
      case "updated_at": {
        const diff =
          new Date(a[field]).getTime() - new Date(b[field]).getTime();
        return dir * diff;
      }
      case "title":
        return dir * a.title.localeCompare(b.title);
      case "position":
      default:
        return dir * (a.position - b.position);
    }
  });
  // Enums (`status` / `priority`) have no natural inverse via comparator
  // negation when ranks tie, so reverse the whole array like web.
  if (direction === "desc" && (field === "status" || field === "priority")) {
    return [...sorted].reverse();
  }
  return sorted;
}

/** Group key space for the assignee grouping — cent `type:id`, `none` for
 *  unassigned. Mirrors web's assignee-board lane ids. */
export function assigneeGroupKey(issue: Issue): {
  key: string;
  labelKey: "none" | `${string}:${string}`;
  type?: "member" | "agent" | "squad";
  id?: string;
} {
  if (!issue.assignee_type || !issue.assignee_id) {
    return { key: "none", labelKey: "none" };
  }
  return {
    key: `${issue.assignee_type}:${issue.assignee_id}`,
    labelKey: `${issue.assignee_type}:${issue.assignee_id}`,
    type: issue.assignee_type,
    id: issue.assignee_id,
  };
}

/** Stable section ordering for a list of assignee groups: unassigned lane
 *  first, then alphabetical by actor (mobile has no drag-ordering). */
export function orderAssigneeGroups(
  groups: { key: string; name: string }[],
): { key: string; name: string }[] {
  return [...groups].sort((a, b) => {
    if (a.key === "none") return -1;
    if (b.key === "none") return 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * One SectionList section from `groupIssues`. `status` is set for status
 * grouping; `assigneeType`/`assigneeId` for assignee grouping (absent for
 * the unassigned lane, key `"none"`).
 */
export interface IssueGroupSection {
  key: string;
  data: Issue[];
  status?: IssueStatus;
  assigneeType?: "member" | "agent" | "squad";
  assigneeId?: string;
  unassigned: boolean;
  /** Select-property grouping: the definition this lane belongs to, its
   *  option (`null` = the trailing "No value" lane) and the option's label /
   *  color for the column header. */
  propertyId?: string;
  propertyOptionId?: string | null;
  propertyOptionName?: string;
  propertyOptionColor?: string;
}

/**
 * The new-issue defaults a board column seeds its "+" with — web's
 * `BoardColumnGroup.createData` (board-column.tsx:75-88), built here from the
 * group's own identity rather than carried as a parallel field.
 *
 * Status wins over assignee when a group somehow has both: the status lanes
 * and the assignee lanes are separate groupings, so only one is ever set, and
 * status is the one the board's edit affordances assume.
 *
 * Returns `null` for a column that implies nothing (the assignee grouping's
 * "No assignee" lane) — the caller creates a plain issue rather than pinning
 * a default the column cannot express. Web sends
 * `{ assignee_type: null, assignee_id: null }` in that case, which the create
 * API treats as "unassigned"; mobile's draft store models that as `null`
 * instead of a `{type, id}` pair.
 */
export function columnCreateDefaults(
  section: IssueGroupSection,
): { status: IssueStatus } | { assignee: { type: "member" | "agent" | "squad"; id: string } } | null {
  if (section.status) return { status: section.status };
  if (section.assigneeType && section.assigneeId) {
    return {
      assignee: { type: section.assigneeType, id: section.assigneeId },
    };
  }
  return null;
}

/**
 * Build SectionList sections / board columns for the given grouping.
 * `status` uses BOARD_STATUSES order (web issues-page.tsx); `assignee`
 * uses the role lane order; `property:<id>` uses the definition's option
 * order plus a trailing "No value" lane. Consumed by both issue list
 * screens and the board.
 *
 * `includeEmpty` keeps empty status columns (board mode needs every status
 * as a visible column, like web's `buildGroups` at
 * packages/views/issues/components/board-view.tsx — the list keeps dropping
 * empty sections). Assignee lanes are data-driven, so the flag has no
 * effect on that grouping; property lanes are catalog-driven, so they honour
 * it exactly like status lanes (empty option columns stay as drop targets on
 * the board, and drop out of the list).
 *
 * Status grouping folds by CATEGORY (MUL-6243): each issue bucketed via
 * `statusCategoryOf` — server-backfilled `status_category` first, built-in
 * key fallback — so a custom status lands in the column whose behavior it
 * inherits instead of gaining a column of its own. A status the resolver
 * cannot categorize (custom key before the catalog loaded) stays out of the
 * fixed columns, same as unknown keys always have been. With no custom
 * statuses the result is byte-identical to key grouping.
 *
 * `groupingProperty` is the resolved definition for a `property:<id>`
 * grouping; when it is absent the grouping falls back to status (see the
 * branch comment below).
 */
export function groupIssues(
  issues: Issue[],
  grouping: IssueGrouping,
  statusOrder: readonly IssueStatus[],
  includeEmpty = false,
  statusCategoryOf: (
    issue: Issue,
  ) => IssueStatusCategory | null = issueStatusCategoryOfIssue,
  groupingProperty: IssueProperty | null = null,
): IssueGroupSection[] {
  // Select-property grouping (web board-view.tsx:88-106): one lane per
  // option in definition order, plus a trailing "No value" lane that is the
  // drop target for issues the property does not cover. Only reachable when
  // the caller resolved the definition — the LACK of one means the grouping
  // key is stale (archived/deleted definition, or a persisted board grouping
  // opened on a list surface that never asked for the catalog), and status
  // grouping is the safe, self-explanatory fallback.
  const groupingPropertyId = propertyIdFromViewKey(grouping);
  if (groupingPropertyId && groupingProperty) {
    const known = new Set(
      (groupingProperty.config.options ?? []).map((o) => o.id),
    );
    const columns: IssueGroupSection[] = (
      groupingProperty.config.options ?? []
    ).map((option) => ({
      key: `property:${groupingProperty.id}:${option.id}`,
      propertyId: groupingProperty.id,
      propertyOptionId: option.id,
      propertyOptionName: option.name,
      propertyOptionColor: option.color,
      unassigned: false,
      data: [],
    }));
    columns.push({
      key: `property:${groupingProperty.id}:none`,
      propertyId: groupingProperty.id,
      propertyOptionId: null,
      unassigned: false,
      data: [],
    });
    const byKey = new Map(columns.map((c) => [c.key, c]));
    for (const issue of issues) {
      const value = issue.properties?.[groupingProperty.id];
      // A value naming an option the definition no longer carries buckets
      // into "No value" — an unmatched lane id would silently drop the
      // issue from the board (web drag-utils.ts:60-67).
      const optionId =
        typeof value === "string" && known.has(value) ? value : null;
      byKey.get(`property:${groupingProperty.id}:${optionId ?? "none"}`)?.data.push(
        issue,
      );
    }
    return includeEmpty ? columns : columns.filter((c) => c.data.length > 0);
  }

  if (grouping === "assignee") {
    const byKey = new Map<
      string,
      { key: string; type?: "member" | "agent" | "squad"; id?: string; data: Issue[] }
    >();
    for (const issue of issues) {
      const g = assigneeGroupKey(issue);
      const entry = byKey.get(g.key) ?? {
        key: g.key,
        type: g.type,
        id: g.id,
        data: [],
      };
      entry.data.push(issue);
      byKey.set(g.key, entry);
    }
    const ordered = orderAssigneeGroups(
      [...byKey.values()].map((e) => ({
        key: e.key,
        name: e.key === "none" ? "" : e.key,
      })),
    );
    return ordered.map((o) => {
      const e = byKey.get(o.key)!;
      return {
        key: e.key,
        assigneeType: e.type,
        assigneeId: e.id,
        unassigned: e.key === "none",
        data: e.data,
      };
    });
  }

  // status grouping — web issues-page.tsx order, folded by category.
  const byStatus = new Map<IssueStatus, Issue[]>();
  for (const issue of issues) {
    const statusKey = statusCategoryOf(issue) ?? issue.status;
    const list = byStatus.get(statusKey);
    if (list) list.push(issue);
    else byStatus.set(statusKey, [issue]);
  }
  // Note: a status whose category the resolver could not determine (a custom
  // key before the catalog landed) buckets by its raw key and falls outside
  // `statusOrder`, so it renders in no column — exactly the pre-catalog
  // contract (unknown keys / cancelled never gain a column).
  return statusOrder
    .map((status) => ({
      key: status,
      status,
      unassigned: false,
      data: byStatus.get(status) ?? [],
    }))
    .filter((s) => includeEmpty || s.data.length > 0);
}