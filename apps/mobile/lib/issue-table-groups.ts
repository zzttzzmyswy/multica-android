/**
 * Table grouping for the mobile issue table (MYS-1156, web parity with
 * `packages/views/issues/components/table-view.tsx` `tableGroupSpec`).
 *
 * Web groups on the SERVER: the rows endpoint paginates per
 * (groupKey, parentId) branch, so `depth` / `hasChildren` arrive already
 * scoped to a group. Mobile loads one flat client-sorted window and has no
 * group route, so both halves are derived here:
 *
 *   - the group key/value per issue, using the same key shapes the server's
 *     descriptors use (`status:<status>`, `assignee:<type>:<id>` /
 *     `assignee:unassigned`, `property:<id>:<state>[:<value>]`), and
 *   - the hierarchy INSIDE each segment — `buildIssueTableRows` runs per
 *     group, not once over the window. That is what keeps a sub-issue whose
 *     parent landed in another group from rendering as an orphan indented
 *     under nothing: in its own segment it is a root, exactly as it would be
 *     in web's branch fetch.
 *
 * Ordering mirrors the server's `orderExpression` + `sortExpression`:
 * status by the canonical status order, assignee by actor class then display
 * name, select properties by the definition's option order with
 * unavailable/unset last.
 */
import type { Issue, IssueProperty } from "@multica/core/types";
import {
  buildIssueTableRows,
  type IssueTableRow,
} from "./issue-table-hierarchy";

export type IssueTableGrouping =
  | "none"
  | "status"
  | "assignee"
  | `property:${string}`;

export const PROPERTY_GROUP_PREFIX = "property:";

/** Strip the `property:` prefix off a grouping key (web's
 *  `propertyIdFromViewKey`). */
export function propertyIdFromGrouping(
  grouping: IssueTableGrouping,
): string | null {
  return grouping.startsWith(PROPERTY_GROUP_PREFIX)
    ? grouping.slice(PROPERTY_GROUP_PREFIX.length)
    : null;
}

/** Property types the table may group by — web's `groupablePropertyIds`. */
export const GROUPABLE_PROPERTY_TYPES = ["select", "checkbox"] as const;

export function isGroupableProperty(property: IssueProperty): boolean {
  return (GROUPABLE_PROPERTY_TYPES as readonly string[]).includes(
    property.type,
  );
}

/** Server `orderExpression` status order; anything newer sorts after it. */
const STATUS_ORDER = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
] as const;

/** Server `orderExpression` assignee class order. Unassigned falls through
 *  to the catch-all class, i.e. last. */
const ACTOR_CLASS_ORDER: Record<string, number> = {
  member: 0,
  agent: 1,
  squad: 2,
};
const ACTOR_CLASS_FALLBACK = 3;

/** An assignee reference. Narrowed to the schema's own assignee type so a
 *  caller can hand it straight to the actor-name lookup. */
export interface IssueTableGroupActor {
  type: NonNullable<Issue["assignee_type"]>;
  id: string;
}

export type IssueTableGroupState = "value" | "unset" | "unavailable";

export interface IssueTableGroupValue {
  kind: "none" | "status" | "assignee" | "property";
  /** `kind: "status"` — the raw status value. */
  status?: string;
  /** `kind: "assignee"` — the actor, or null for the unassigned bucket. */
  actor?: IssueTableGroupActor | null;
  /** `kind: "property"` — the definition this group belongs to. */
  propertyId?: string;
  /** `kind: "property"` — which of value/unset/unavailable this bucket is. */
  state?: IssueTableGroupState;
  /** select: the option id; checkbox: "true" / "false". */
  raw?: string;
}

export interface IssueTableGroup {
  /** Stable identity for the collapse set (server descriptor key shape). */
  key: string;
  value: IssueTableGroupValue;
  /** Issues in this segment, BEFORE collapse pruning — this is the number the
   *  header shows, and it must not shrink when a subtree is collapsed. */
  count: number;
  /** Hierarchy-built rows for the segment, already pruned by the collapsed
   *  parent set. */
  rows: IssueTableRow[];
}

export interface IssueTableGroupOptions {
  /** Resolve an actor's display name — the server sorts assignee groups by
   *  `LOWER(name)` after the class order. Missing names sort as "". */
  actorName?: (issue: IssueTableGroupActor) => string;
  /**
   * Whether sub-issues nest under their parent (web's `tableHierarchy`
   * toggle, view-store.ts:223). Defaults to true — the table's own default.
   *
   * Off flattens every row: no indent, no chevron, and the collapsed-parent
   * set stops pruning anything (a flat list has no subtree to hide). Group
   * headers still render; only the hierarchy inside each segment is dropped.
   *
   * Note this is a LOCAL flatten of the loaded window. Web implements the same
   * switch as a server query parameter (`hierarchy: { enabled: false }`,
   * table-view.tsx:1471) and gets a flat page back, so the two do not
   * necessarily agree on the row SET once paging is involved — see
   * `issue-filter-slice.ts` `tableHierarchy` for the full divergence note.
   */
  hierarchy?: boolean;
}

/** One issue's group identity, or null when the issue cannot be grouped
 *  (unknown property definition). */
function groupOf(
  issue: Issue,
  grouping: IssueTableGrouping,
  propertyById: Map<string, IssueProperty>,
): { key: string; value: IssueTableGroupValue } | null {
  if (grouping === "status") {
    return {
      key: `status:${issue.status}`,
      value: { kind: "status", status: issue.status },
    };
  }
  if (grouping === "assignee") {
    const type = issue.assignee_type;
    const id = issue.assignee_id;
    if (!type || !id) {
      return {
        key: "assignee:unassigned",
        value: { kind: "assignee", actor: null },
      };
    }
    return {
      key: `assignee:${type}:${id}`,
      value: { kind: "assignee", actor: { type, id } },
    };
  }

  const propertyId = propertyIdFromGrouping(grouping);
  const property = propertyId ? propertyById.get(propertyId) : undefined;
  const prefix = `property:${propertyId ?? ""}`;
  if (!property) {
    // The definition is gone (deleted, or archived out of the catalog): the
    // whole window reads as one "unavailable" bucket rather than vanishing.
    return {
      key: `${prefix}:unavailable`,
      value: {
        kind: "property",
        propertyId: propertyId ?? "",
        state: "unavailable",
      },
    };
  }

  const raw = (issue.properties ?? {})[propertyId as string];
  if (raw === undefined || raw === null) {
    return {
      key: `${prefix}:unset`,
      value: { kind: "property", propertyId: property.id, state: "unset" },
    };
  }
  if (property.type === "select") {
    const options = property.config.options ?? [];
    if (typeof raw === "string" && options.some((o) => o.id === raw)) {
      return {
        key: `${prefix}:value:${raw}`,
        value: {
          kind: "property",
          propertyId: property.id,
          state: "value",
          raw,
        },
      };
    }
    // A value the catalog no longer offers (an option that was deleted). The
    // stale id rides in the key so two dead options stay distinct; a
    // non-string value has none, matching the server's `unavailable:` bucket
    // (issue_table_group.go:205) so server counts map onto these keys.
    return typeof raw === "string"
      ? {
          key: `${prefix}:unavailable:${raw}`,
          value: {
            kind: "property",
            propertyId: property.id,
            state: "unavailable",
            raw,
          },
        }
      : {
          key: `${prefix}:unavailable`,
          value: {
            kind: "property",
            propertyId: property.id,
            state: "unavailable",
          },
        };
  }
  if (property.type === "checkbox" && typeof raw === "boolean") {
    return {
      key: `${prefix}:value:${raw}`,
      value: {
        kind: "property",
        propertyId: property.id,
        state: "value",
        raw: String(raw),
      },
    };
  }
  return {
    key: `${prefix}:unavailable`,
    value: { kind: "property", propertyId: property.id, state: "unavailable" },
  };
}

/** Rank within a group's own ordering dimension (lower first). */
function orderRank(
  group: IssueTableGroup,
  property: IssueProperty | undefined,
): number {
  const value = group.value;
  if (value.kind === "status") {
    const index = STATUS_ORDER.indexOf(
      value.status as (typeof STATUS_ORDER)[number],
    );
    return index === -1 ? STATUS_ORDER.length : index;
  }
  if (value.kind === "assignee") {
    if (!value.actor) return ACTOR_CLASS_FALLBACK;
    return ACTOR_CLASS_ORDER[value.actor.type] ?? ACTOR_CLASS_FALLBACK;
  }
  if (property?.type === "select") {
    if (value.state === "value") {
      const index = (property.config.options ?? []).findIndex(
        (o) => o.id === value.raw,
      );
      return index === -1 ? 100000 : index;
    }
    return value.state === "unavailable" ? 100001 : 100002;
  }
  // checkbox
  if (value.state === "value") return value.raw === "true" ? 1 : 0;
  return value.state === "unavailable" ? 2 : 3;
}

/** Secondary sort key — the server's `groupSortExpr` (actor name) falling
 *  back to the raw group value. */
function orderSortKey(
  group: IssueTableGroup,
  options: IssueTableGroupOptions,
): string {
  const value = group.value;
  if (value.kind === "assignee" && value.actor) {
    return (options.actorName?.(value.actor) ?? "").toLowerCase();
  }
  return group.key;
}

/**
 * One segment's rows: the hierarchy-built rows normally, or an unindented,
 * unpruned projection of the same issues when the caller turned hierarchy off.
 *
 * The flat branch deliberately reuses `buildIssueTableRows`'s row SHAPE rather
 * than hand-rolling `{ issue, depth: 0, … }` objects, and it passes an EMPTY
 * collapsed set. That empty set is the point: with no depth, a chevron would
 * expand into nothing, and pruning a subtree from a list that has no tree just
 * silently drops rows. Both `hasChildren` and `collapsed` therefore also come
 * out false, which is what makes the table's chevron disappear on its own —
 * no second flag has to travel to the row renderer.
 */
function buildRows(
  issues: readonly Issue[],
  collapsedIds: ReadonlySet<string>,
  options: IssueTableGroupOptions,
): IssueTableRow[] {
  // Off: every row is a root. No indent, no chevron, and nothing to prune —
  // the caller's collapsed set is simply not consulted, because a flat list
  // has no subtree to hide.
  if (options.hierarchy === false) {
    return issues.map((issue) => ({
      issue,
      depth: 0,
      hasChildren: false,
      collapsed: false,
    }));
  }
  return buildIssueTableRows(issues, collapsedIds);
}

/**
 * Split the loaded window into ordered segments, each with its own hierarchy.
 * Returns a single unnamed segment when `grouping` is `"none"` so callers can
 * treat both shapes alike.
 */
export function buildIssueTableGroups(
  issues: readonly Issue[],
  grouping: IssueTableGrouping,
  properties: readonly IssueProperty[],
  collapsedParentIds: ReadonlySet<string>,
  options: IssueTableGroupOptions = {},
): IssueTableGroup[] {
  if (grouping === "none") {
    return [
      {
        key: "all",
        value: { kind: "none" },
        count: issues.length,
        rows: buildRows(issues, collapsedParentIds, options),
      },
    ];
  }

  const propertyById = new Map(properties.map((p) => [p.id, p]));
  const propertyId = propertyIdFromGrouping(grouping);
  const property = propertyId ? propertyById.get(propertyId) : undefined;

  // Insertion order = the window's own order, which is the user's sort; the
  // final sort below only reorders whole segments, never rows inside one.
  const buckets = new Map<
    string,
    { value: IssueTableGroupValue; issues: Issue[] }
  >();
  for (const issue of issues) {
    const group = groupOf(issue, grouping, propertyById);
    if (!group) continue;
    const bucket = buckets.get(group.key);
    if (bucket) bucket.issues.push(issue);
    else buckets.set(group.key, { value: group.value, issues: [issue] });
  }

  const groups: IssueTableGroup[] = [...buckets.entries()].map(
    ([key, bucket]) => ({
      key,
      value: bucket.value,
      count: bucket.issues.length,
      // Hierarchy is branch-local (see the file header): a parent outside
      // this segment cannot indent a child inside it.
      rows: buildRows(bucket.issues, collapsedParentIds, options),
    }),
  );

  return groups.sort((a, b) => {
    const rank = orderRank(a, property) - orderRank(b, property);
    if (rank !== 0) return rank;
    const bySortKey = orderSortKey(a, options).localeCompare(
      orderSortKey(b, options),
    );
    if (bySortKey !== 0) return bySortKey;
    return a.key.localeCompare(b.key);
  });
}

/** A table body row: a group header, or one issue. */
export type IssueTableDisplayRow =
  | {
      kind: "group";
      key: string;
      value: IssueTableGroupValue;
      count: number;
      collapsed: boolean;
    }
  | { kind: "row"; row: IssueTableRow };

/**
 * The flat sequence the two synced lists render. A collapsed group keeps its
 * header and drops its rows; its `count` still reports the segment size.
 */
export function buildIssueTableDisplayRows(
  issues: readonly Issue[],
  grouping: IssueTableGrouping,
  properties: readonly IssueProperty[],
  collapsedParentIds: ReadonlySet<string>,
  collapsedGroupIds: ReadonlySet<string>,
  options: IssueTableGroupOptions = {},
): IssueTableDisplayRow[] {
  const groups = buildIssueTableGroups(
    issues,
    grouping,
    properties,
    collapsedParentIds,
    options,
  );
  const display: IssueTableDisplayRow[] = [];
  for (const group of groups) {
    // "none" is the degenerate single segment: no header, just the rows.
    if (grouping !== "none") {
      const collapsed = collapsedGroupIds.has(group.key);
      display.push({
        kind: "group",
        key: group.key,
        value: group.value,
        count: group.count,
        collapsed,
      });
      if (collapsed) continue;
    }
    for (const row of group.rows) display.push({ kind: "row", row });
  }
  return display;
}