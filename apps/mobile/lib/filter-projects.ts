/**
 * Client-side project list predicate + sort helpers for the projects
 * browser. Mirrors web `packages/views/projects/components/projects-page.tsx`
 * `visible` useMemo — same predicates, same "empty array = show all"
 * semantics, same sort orders (enum-column sorts tie-break on title), same
 * default directions as the web view store.
 *
 * Search is a title substring match, case-insensitive (web additionally
 * matches pinyin; mobile ships the plain substring pass — the input method
 * on Android produces composed text, so the pinyin fallback has no
 * equivalent).
 */
import type {
  Project,
  ProjectPriority,
  ProjectStatus,
} from "@multica/core/types";

export type ProjectSortField =
  | "name"
  | "priority"
  | "status"
  | "progress"
  | "created";

export type ProjectSortDirection = "asc" | "desc";

// Filter chip option orders — web STATUS_VALUES / PRIORITY_VALUES /
// SORT_FIELDS.
export const PROJECT_STATUSES: ProjectStatus[] = [
  "planned",
  "in_progress",
  "paused",
  "completed",
  "cancelled",
];

export const PROJECT_PRIORITIES: ProjectPriority[] = [
  "urgent",
  "high",
  "medium",
  "low",
  "none",
];

export const PROJECT_SORT_FIELDS: ProjectSortField[] = [
  "name",
  "priority",
  "status",
  "progress",
  "created",
];

// Default direction per field — mirrors web view-store
// PROJECT_SORT_DEFAULT_DIRECTION: enum/progress sorts read naturally
// high-first, created reads newest-first, name reads A→Z.
export const PROJECT_SORT_DEFAULT_DIRECTION: Record<
  ProjectSortField,
  ProjectSortDirection
> = {
  name: "asc",
  priority: "desc",
  status: "asc",
  progress: "desc",
  created: "desc",
};

/** Multi-select filters. Empty array per dimension = inactive. */
export interface ProjectListFilters {
  statuses: string[];
  priorities: string[];
  /** Composite "type:id" lead refs (member or agent). */
  leads: string[];
}

export const EMPTY_PROJECT_FILTERS: ProjectListFilters = {
  statuses: [],
  priorities: [],
  leads: [],
};

// Header sort needs a total order over the enum columns (web
// PRIORITY_ORDER / STATUS_ORDER).
export const PROJECT_PRIORITY_SORT_ORDER: Record<string, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};

export const PROJECT_STATUS_SORT_ORDER: Record<string, number> = {
  planned: 0,
  in_progress: 1,
  paused: 2,
  completed: 3,
  cancelled: 4,
};

// Composite "type:id" lead value so the filter holds member/agent refs alike
// (web leadFilterValue).
export function leadFilterValue(p: Project): string | null {
  return p.lead_type && p.lead_id ? `${p.lead_type}:${p.lead_id}` : null;
}

// Progress proxy for the progress sort. -1 for an issueless project puts
// them last in a desc sort (same total-order trick web uses).
const progressOf = (p: Project) =>
  p.issue_count > 0 ? p.done_count / p.issue_count : -1;

export function countActiveProjectFilters(f: ProjectListFilters): number {
  let c = 0;
  if (f.statuses.length) c++;
  if (f.priorities.length) c++;
  if (f.leads.length) c++;
  return c;
}

export function toggleInList(list: string[], value: string): string[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

export function filterProjects(
  projects: Project[],
  search: string,
  filters: ProjectListFilters,
): Project[] {
  const q = search.trim().toLowerCase();
  return projects.filter((p) => {
    if (q && !p.title.toLowerCase().includes(q)) return false;
    if (filters.statuses.length && !filters.statuses.includes(p.status))
      return false;
    if (filters.priorities.length && !filters.priorities.includes(p.priority))
      return false;
    if (filters.leads.length) {
      const v = leadFilterValue(p);
      if (!v || !filters.leads.includes(v)) return false;
    }
    return true;
  });
}

/**
 * Header-tap sort transition for the projects compact table (iteration 135),
 * mirroring the issue table's `nextTableSort`: tapping a NEW column applies
 * that field's default direction (`PROJECT_SORT_DEFAULT_DIRECTION`), tapping
 * the ALREADY active column flips. Web exposes the two directions as explicit
 * menu items on the header; the tap-to-cycle is the touch adaptation of the
 * same two targets.
 *
 * Note the flip reads `currentDirection`, not the field's default: a column
 * whose default is `desc` and which the user flipped to `asc` must return to
 * `desc` on the next tap, or every other tap would be inert.
 */
export function nextProjectSort(
  currentField: ProjectSortField,
  currentDirection: ProjectSortDirection,
  targetField: ProjectSortField,
): { field: ProjectSortField; direction: ProjectSortDirection } {
  if (currentField === targetField) {
    return {
      field: targetField,
      direction: currentDirection === "asc" ? "desc" : "asc",
    };
  }
  return { field: targetField, direction: PROJECT_SORT_DEFAULT_DIRECTION[targetField] };
}

export function sortProjects(
  projects: Project[],
  field: ProjectSortField,
  direction: ProjectSortDirection,
): Project[] {
  const dir = direction === "asc" ? 1 : -1;
  const sorted = [...projects];
  sorted.sort((a, b) => {
    if (field === "name") return a.title.localeCompare(b.title) * dir;
    if (field === "priority") {
      return (
        ((PROJECT_PRIORITY_SORT_ORDER[a.priority] ?? 0) -
          (PROJECT_PRIORITY_SORT_ORDER[b.priority] ?? 0)) *
          dir || a.title.localeCompare(b.title)
      );
    }
    if (field === "status") {
      return (
        ((PROJECT_STATUS_SORT_ORDER[a.status] ?? 0) -
          (PROJECT_STATUS_SORT_ORDER[b.status] ?? 0)) *
          dir || a.title.localeCompare(b.title)
      );
    }
    if (field === "progress") {
      return (
        (progressOf(a) - progressOf(b)) * dir || a.title.localeCompare(b.title)
      );
    }
    return (Date.parse(a.created_at) - Date.parse(b.created_at)) * dir;
  });
  return sorted;
}
