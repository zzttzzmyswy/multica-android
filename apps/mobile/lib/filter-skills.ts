/**
 * Skills-list search, filter and sort — mobile port of web
 * `packages/views/skills/components/skills-page.tsx` (`allRows` :630-655,
 * `rows` :657-720) with the vocabulary from web's skills view store
 * (`packages/core/skills/stores/view-store.ts`).
 *
 * Web renders four filter dimensions as nested dropdown submenus; a phone has
 * no hover-revealed tree, so the screen presents the same four dimensions as
 * labelled groups of one multi-select sheet. The key codec below is what lets
 * that sheet speak in flat keys while the filter state stays dimensioned —
 * web's own `toggleFilter(key, value)` shape.
 *
 * Sort semantics are copied exactly, including the two asymmetries web has:
 * `usedBy` tie-breaks on name ASCENDING regardless of the chosen direction,
 * and an unknown/unparseable timestamp sorts as NaN (web does not guard it).
 */
import type {
  Agent,
  MemberRole,
  MemberWithUser,
  SkillSummary,
} from "@multica/core/types";
import { canEditSkill, readOrigin, type SkillOriginType } from "./skill-guards";

export type SkillSortField = "name" | "usedBy" | "updated" | "created";
export type SkillSortDirection = "asc" | "desc";
export type SkillUsage = "used" | "unused";

/** Presentation order of the sort menu, matching web's `SORT_FIELDS`. */
export const SKILL_SORT_FIELDS: SkillSortField[] = [
  "name",
  "usedBy",
  "updated",
  "created",
];

/** Per-field direction applied when the user switches TO that field —
 *  identical to web (view-store.ts `SKILL_SORT_DEFAULT_DIRECTION`). */
export const SKILL_SORT_DEFAULT_DIRECTION: Record<
  SkillSortField,
  SkillSortDirection
> = {
  name: "asc",
  usedBy: "desc",
  updated: "desc",
  created: "desc",
};

/** Option order of the Source filter group — web's `ORIGIN_TYPES`. */
export const SKILL_ORIGIN_TYPES: SkillOriginType[] = [
  "manual",
  "runtime_local",
  "clawhub",
  "skills_sh",
  "github",
];

/** Multi-select filter state. An empty array per dimension = inactive. */
export interface SkillListFilters {
  usage: SkillUsage[];
  origins: SkillOriginType[];
  agents: string[];
  creators: string[];
}

export const EMPTY_SKILL_FILTERS: SkillListFilters = {
  usage: [],
  origins: [],
  agents: [],
  creators: [],
};

export type SkillFilterDimension = keyof SkillListFilters;

export interface SkillRow {
  skill: SkillSummary;
  /** Active (non-archived) agents this skill is bound to. */
  agents: Agent[];
  /** The member who added it, when the workspace list still has them. */
  creator: MemberWithUser | null;
  originType: SkillOriginType;
  canEdit: boolean;
}

/**
 * Assemble the rows the list, the toolbar's counts and the filter sheet all
 * read from. Same inputs web passes (`skills-page.tsx:616-655`), minus the
 * runtimes map web uses only to render a runtime-local skill's CLI name.
 */
export function buildSkillRows({
  skills,
  agents,
  members,
  userId,
  role,
}: {
  skills: SkillSummary[];
  agents: Agent[];
  members: MemberWithUser[];
  userId: string | null | undefined;
  role: MemberRole | null | undefined;
}): SkillRow[] {
  const membersById = new Map<string, MemberWithUser>();
  for (const member of members) membersById.set(member.user_id, member);

  const activeAgents = agents.filter((agent) => !agent.archived_at);

  return skills.map((skill) => ({
    skill,
    agents: activeAgents.filter((agent) =>
      (agent.skills ?? []).some((bound) => bound.id === skill.id),
    ),
    creator: skill.created_by
      ? (membersById.get(skill.created_by) ?? null)
      : null,
    originType: readOrigin(skill).type,
    canEdit: canEditSkill(skill, { userId, role }),
  }));
}

/** Name substring, case-insensitive — web matches the name only (`:659-660`),
 *  deliberately not the description. */
export function matchesSkillSearch(row: SkillRow, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  return row.skill.name.toLowerCase().includes(trimmed);
}

export function rowMatchesSkillFilters(
  row: SkillRow,
  filters: SkillListFilters,
): boolean {
  if (filters.usage.length > 0) {
    const usage: SkillUsage = row.agents.length > 0 ? "used" : "unused";
    if (!filters.usage.includes(usage)) return false;
  }
  if (filters.origins.length > 0 && !filters.origins.includes(row.originType)) {
    return false;
  }
  if (
    filters.agents.length > 0 &&
    !row.agents.some((agent) => filters.agents.includes(agent.id))
  ) {
    return false;
  }
  if (
    filters.creators.length > 0 &&
    (!row.skill.created_by || !filters.creators.includes(row.skill.created_by))
  ) {
    return false;
  }
  return true;
}

export function filterSkillRows(
  rows: SkillRow[],
  {
    search,
    filters,
  }: { search: string; filters: SkillListFilters },
): SkillRow[] {
  const query = search.trim();
  if (!query && countActiveSkillFilterDimensions(filters) === 0) return rows;
  return rows.filter(
    (row) => matchesSkillSearch(row, query) && rowMatchesSkillFilters(row, filters),
  );
}

/** Non-mutating: the caller's `rows` (often memoized) is never reordered. */
export function sortSkillRows(
  rows: SkillRow[],
  field: SkillSortField,
  direction: SkillSortDirection,
): SkillRow[] {
  const dir = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (field === "name") {
      return a.skill.name.localeCompare(b.skill.name) * dir;
    }
    if (field === "usedBy") {
      return (
        (a.agents.length - b.agents.length) * dir ||
        a.skill.name.localeCompare(b.skill.name)
      );
    }
    if (field === "created") {
      return (
        (Date.parse(a.skill.created_at) - Date.parse(b.skill.created_at)) * dir
      );
    }
    return (
      (Date.parse(a.skill.updated_at) - Date.parse(b.skill.updated_at)) * dir
    );
  });
}

/** How many dimensions are narrowing the list — the filter chip's badge. */
export function countActiveSkillFilterDimensions(
  filters: SkillListFilters,
): number {
  let count = 0;
  if (filters.usage.length > 0) count++;
  if (filters.origins.length > 0) count++;
  if (filters.agents.length > 0) count++;
  if (filters.creators.length > 0) count++;
  return count;
}

/**
 * Flat key for one filter option, as the multi-select sheet's row identity.
 * The dimension prefix keeps agent and member ids from colliding and lets
 * `parseSkillFilterKey` hand `toggleSkillFilter` its arguments back.
 */
export function skillFilterKey(
  dimension: SkillFilterDimension,
  value: string,
): string {
  return `${dimension}:${value}`;
}

export function parseSkillFilterKey(
  key: string,
): { dimension: SkillFilterDimension; value: string } | null {
  const separator = key.indexOf(":");
  if (separator <= 0) return null;
  const dimension = key.slice(0, separator);
  const value = key.slice(separator + 1);
  if (
    dimension !== "usage" &&
    dimension !== "origins" &&
    dimension !== "agents" &&
    dimension !== "creators"
  ) {
    return null;
  }
  if (!value) return null;
  return { dimension, value };
}

/** Toggle one value in one dimension, returning a new filter object. */
export function toggleSkillFilter(
  filters: SkillListFilters,
  dimension: SkillFilterDimension,
  value: string,
): SkillListFilters {
  const list = filters[dimension] as string[];
  const next = list.includes(value)
    ? list.filter((entry) => entry !== value)
    : [...list, value];
  return { ...filters, [dimension]: next } as SkillListFilters;
}
