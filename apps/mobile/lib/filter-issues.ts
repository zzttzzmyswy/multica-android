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
  IssueStatus,
} from "@multica/core/types";
import type {
  ActorFilterValue,
  IssueGrouping,
  IssueSortDirection,
  IssueSortField,
} from "@/data/stores/issue-filter-slice";

export interface IssueFilterState {
  statusFilters: IssueStatus[];
  priorityFilters: IssuePriority[];
  assigneeFilters: ActorFilterValue[];
  includeNoAssignee: boolean;
  creatorFilters: ActorFilterValue[];
  projectFilters: string[];
  includeNoProject: boolean;
  labelFilters: string[];
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
};

/**
 * Apply every filter dimension. Mirrors web `applyIssueFilters` at
 * packages/views/issues/utils/filter.ts (status/priority/assignee+no-
 * assignee/creator/project+no-project/label). Custom-property + date +
 * working filters are not yet exposed on mobile — deferred dimensions are
 * documented in the filter panel.
 */
export function applyIssueFilters(
  issues: Issue[],
  filters: IssueFilterState,
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
  } = filters;

  const hasAssigneeFilter =
    assigneeFilters.length > 0 || includeNoAssignee;
  const hasProjectFilter =
    projectFilters.length > 0 || includeNoProject;

  return issues.filter((issue) => {
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
}

/**
 * Build SectionList sections / board columns for the given grouping.
 * `status` uses BOARD_STATUSES order (web issues-page.tsx); `assignee`
 * uses the role lane order. Consumed by both issue list screens.
 *
 * `includeEmpty` keeps empty status columns (board mode needs every status
 * as a visible column, like web's `buildGroups` at
 * packages/views/issues/components/board-view.tsx — the list keeps dropping
 * empty sections). Assignee lanes are data-driven, so the flag has no
 * effect on that grouping.
 */
export function groupIssues(
  issues: Issue[],
  grouping: IssueGrouping,
  statusOrder: readonly IssueStatus[],
  includeEmpty = false,
): IssueGroupSection[] {
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

  // status grouping — web issues-page.tsx order
  const byStatus = new Map<IssueStatus, Issue[]>();
  for (const issue of issues) {
    const list = byStatus.get(issue.status);
    if (list) list.push(issue);
    else byStatus.set(issue.status, [issue]);
  }
  return statusOrder
    .map((status) => ({
      key: status,
      status,
      unassigned: false,
      data: byStatus.get(status) ?? [],
    }))
    .filter((s) => includeEmpty || s.data.length > 0);
}