/**
 * Client-side project list predicate + sort helpers for the projects
 * browser. Mirrors web `packages/views/projects/components/projects-page.tsx`
 * `visible` useMemo — same predicates, same "empty array = show all"
 * semantics, same sort orders (enum-column sorts tie-break on title), same
 * default directions as the web view store.
 *
 * Search is a pinyin-aware title match: case-insensitive substring, plus
 * web's `matchesPinyin` arm (projects-page.tsx:870), so a Chinese project
 * title is reachable by full pinyin, initials or hybrid input.
 */
import type {
  Project,
  ProjectPriority,
  ProjectStatus,
} from "@multica/core/types";
import { matchesNameOrPinyin } from "./name-search";

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

/** One lead-filter chip: the composite value it filters by, the name it may
 *  show, and a key its ORDER can be settled on before any name exists. */
export interface LeadFilterOption {
  value: string;
  /** The lead's name, or `null` while the directory that would answer for it
   *  has not settled. `null` is not "no lead" — a project with no lead
   *  contributes no option at all, as in web's loop. */
  label: string | null;
  /** Stable per-reference ordering key. Deliberately the composite `value`, not
   *  the label: sorting by a withholdable string makes the chips reshuffle as
   *  directories answer, and on a partial cache (members resolved, agents not)
   *  it actively interleaves them. */
  sortKey: string;
  count: number;
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
    if (q && !matchesNameOrPinyin(p.title, search)) return false;
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

/**
 * Lead-filter options — web's `leadOptions` memo
 * (`projects-page.tsx:855-865`), plus the read-state split iteration 256
 * (MYS-2227) needed.
 *
 * Two requirements pull in opposite directions here:
 *
 *   - The chip's TEXT is an assertion about a person, so an unread directory
 *     must withhold it rather than print `getName`'s 「Unknown Agent」.
 *   - The chip's ORDER must not depend on read progress. `sortKey` is the
 *     composite `type:id` reference, which exists the moment the option does,
 *     so the chips are in their final positions on the first paint and stay
 *     there. Iteration 255 established the same split for the issue table's
 *     grouped cells: settle the key on ids, never on text a read can withhold.
 *
 * The resolver is injected rather than read from a hook so this module stays
 * React-free and the Node lane can exercise both properties.
 */
export function leadFilterOptions(
  projects: readonly Project[],
  resolveName: (
    type: "member" | "agent",
    id: string,
  ) => { kind: "name" | "gone"; name: string } | { kind: "unsettled" },
): LeadFilterOption[] {
  const byValue = new Map<
    string,
    { type: "member" | "agent"; id: string; count: number }
  >();
  for (const p of projects) {
    const v = leadFilterValue(p);
    if (!v || !p.lead_type || !p.lead_id) continue;
    const entry = byValue.get(v);
    if (entry) entry.count += 1;
    else byValue.set(v, { type: p.lead_type, id: p.lead_id, count: 1 });
  }
  return [...byValue.entries()]
    .map(([value, { type, id, count }]) => {
      const state = resolveName(type, id);
      return {
        value,
        label: state.kind === "unsettled" ? null : state.name,
        sortKey: value,
        count,
      };
    })
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}
