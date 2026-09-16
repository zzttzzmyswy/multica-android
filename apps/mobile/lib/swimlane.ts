/**
 * Swimlane lane model — the pure half of the issue workbench's swimlane
 * view, mirroring web's `packages/views/issues/components/swimlane-view.tsx`
 * lane builders (`buildParentLanes` / `buildProjectLanes` /
 * `buildAssigneeLanes`).
 *
 * A lane is one value of the grouping dimension (assignee / project /
 * parent); inside a lane the columns are the issue statuses. Web builds the
 * same grid: a row per lane, a cell per status.
 *
 * Rules kept from web, field for field:
 *
 *   - Every grouping emits a PINNED "no X" lane first (`<grouping>:none`),
 *     matched by a null group field. It renders even when empty — it is the
 *     move target for "take this issue out of the dimension".
 *   - Parent grouping emits a second pinned lane for children whose parent
 *     metadata is not loaded (web's "Other parents" orphans), matched by
 *     nothing so it never double-renders an issue.
 *   - Non-pinned lanes are ordered by the caller's resolved label (project
 *     title / actor name; assignee lanes also by actor type), falling back
 *     to first appearance in the (already sorted) issue array — web's
 *     `storedOrder`-then-insertion fallback without the drag-order store.
 *   - Every lane carries ONE CELL PER STATUS in `statusOrder`, empty cells
 *     included: a cell with no cards is a valid move target, exactly like
 *     an empty board column.
 *
 * Deliberately NOT here (phone-level simplifications, see the component):
 * `storedOrder` lane drag-reordering, the "hidden status" set, and web's
 * `mergedIssues` parent-header merge. The builder is pure and takes no
 * i18n or React dependency so it runs in the Node vitest lane.
 */
import type { Issue, IssueAssigneeType, IssueStatus } from "@multica/core/types";

/** Swimlane grouping dimension. Web `SwimlaneGrouping`. */
export type SwimlaneGrouping = "assignee" | "project" | "parent";

export const SWIMLANE_GROUPINGS: SwimlaneGrouping[] = [
  "assignee",
  "project",
  "parent",
];

/** Sentinel rawId of the pinned "no X" lane (web `NONE_LANE_ID`). */
export const SWIMLANE_NONE_ID = "none";
/** Sentinel rawId of the parent-grouping orphan lane (web `ORPHAN_LANE_ID`). */
export const SWIMLANE_ORPHAN_ID = "orphan";

/** One status column inside a lane. */
export interface SwimlaneCell {
  status: IssueStatus;
  /** Issues in this lane with this status, in the input array's order. */
  issues: Issue[];
}

/** One swimlane row. */
export interface SwimlaneLane {
  /** `<grouping>:<rawId>` — unique across the board, web's `lane.key`. */
  key: string;
  rawId: string;
  grouping: SwimlaneGrouping;
  /** The "no X" lane and the orphan lane — pinned to the top, no move value. */
  pinned: boolean;
  /** Parent grouping only: children whose parent metadata isn't loaded. */
  orphan: boolean;
  assigneeType?: IssueAssigneeType;
  assigneeId?: string;
  projectId?: string;
  parentIssueId?: string;
  /** One entry per status in `statusOrder`, in that order. */
  cells: SwimlaneCell[];
  /** Sum of `cells[].issues.length` — the count in the lane header. */
  total: number;
}

export interface BuildSwimlaneLanesInput {
  /** Already filtered + sorted by the caller (the surface's `sorted`). */
  issues: readonly Issue[];
  grouping: SwimlaneGrouping;
  statusOrder: readonly IssueStatus[];
  /** Resolved display name for an assignee lane. Absent → first appearance. */
  actorName?: (type: IssueAssigneeType, id: string) => string;
  /** Resolved title for a project lane. Absent → first appearance. */
  projectTitle?: (id: string) => string;
  /**
   * Parent-grouping: parent issue ids whose metadata IS loaded. A child
   * whose `parent_issue_id` is missing from the set (or the set itself is
   * absent, i.e. nothing is loaded yet) lands in the pinned orphan lane,
   * mirroring web's `buildParentLanes`.
   */
  knownParentIds?: ReadonlySet<string>;
}

const ACTOR_TYPE_ORDER: Record<string, number> = {
  member: 0,
  agent: 1,
  squad: 2,
};

const EMPTY_PARENT_SET: ReadonlySet<string> = new Set();

interface LaneSeed {
  key: string;
  rawId: string;
  assigneeType?: IssueAssigneeType;
  assigneeId?: string;
  projectId?: string;
  parentIssueId?: string;
}

function emptyCells(statusOrder: readonly IssueStatus[]): SwimlaneCell[] {
  return statusOrder.map((status) => ({ status, issues: [] }));
}

function makeLane(
  grouping: SwimlaneGrouping,
  seed: LaneSeed,
  statusOrder: readonly IssueStatus[],
  pinned = false,
  orphan = false,
): SwimlaneLane {
  return {
    ...seed,
    grouping,
    pinned,
    orphan,
    cells: emptyCells(statusOrder),
    total: 0,
  };
}

/** Does this issue belong in the pinned "no X" lane of `grouping`? */
export function inNoneLane(
  issue: Pick<Issue, "assignee_id" | "project_id" | "parent_issue_id">,
  grouping: SwimlaneGrouping,
): boolean {
  if (grouping === "assignee") return issue.assignee_id === null;
  if (grouping === "project") return issue.project_id === null;
  return issue.parent_issue_id === null;
}

type LaneSlot =
  | { kind: "lane"; seed: LaneSeed }
  | { kind: "none" }
  | { kind: "orphan" };

/** Which lane an issue belongs to: a value lane, the pinned "no X" lane, or
 *  (parent grouping) the pinned orphan lane. */
function laneSlotOf(
  issue: Issue,
  grouping: SwimlaneGrouping,
  knownParentIds: ReadonlySet<string>,
): LaneSlot {
  if (grouping === "assignee") {
    if (issue.assignee_id === null || issue.assignee_type === null) {
      return { kind: "none" };
    }
    const rawId = `${issue.assignee_type}:${issue.assignee_id}`;
    return {
      kind: "lane",
      seed: {
        key: `assignee:${rawId}`,
        rawId,
        assigneeType: issue.assignee_type,
        assigneeId: issue.assignee_id,
      },
    };
  }
  if (grouping === "project") {
    if (issue.project_id === null) return { kind: "none" };
    return {
      kind: "lane",
      seed: {
        key: `project:${issue.project_id}`,
        rawId: issue.project_id,
        projectId: issue.project_id,
      },
    };
  }
  if (issue.parent_issue_id === null) return { kind: "none" };
  // A child whose parent metadata hasn't loaded cannot be named, so it is
  // not a lane yet — it renders in the pinned orphan lane (web parity).
  if (!knownParentIds.has(issue.parent_issue_id)) return { kind: "orphan" };
  return {
    kind: "lane",
    seed: {
      key: `parent:${issue.parent_issue_id}`,
      rawId: issue.parent_issue_id,
      parentIssueId: issue.parent_issue_id,
    },
  };
}

function orderLanes(
  lanes: SwimlaneLane[],
  {
    actorName,
    projectTitle,
  }: Pick<BuildSwimlaneLanesInput, "actorName" | "projectTitle">,
): SwimlaneLane[] {
  const labelOf = (lane: SwimlaneLane): string | null => {
    if (lane.assigneeType && lane.assigneeId && actorName) {
      return actorName(lane.assigneeType, lane.assigneeId);
    }
    if (lane.projectId && projectTitle) return projectTitle(lane.projectId);
    return null;
  };

  // `sort` on a copy is stable, so lanes without a resolved label keep the
  // input's first-appearance order (web's insertion-order fallback).
  return [...lanes].sort((a, b) => {
    if (a.assigneeType && b.assigneeType) {
      const at = ACTOR_TYPE_ORDER[a.assigneeType] ?? 99;
      const bt = ACTOR_TYPE_ORDER[b.assigneeType] ?? 99;
      if (at !== bt) return at - bt;
    }
    const al = labelOf(a);
    const bl = labelOf(b);
    if (al === null || bl === null) return 0;
    return al.localeCompare(bl);
  });
}

/**
 * Bucket `issues` into lanes for `grouping`. Issues whose status is not in
 * `statusOrder` are dropped before bucketing — same contract as
 * `groupIssues`: a status with no column renders nowhere.
 */
export function buildSwimlaneLanes({
  issues,
  grouping,
  statusOrder,
  actorName,
  projectTitle,
  knownParentIds,
}: BuildSwimlaneLanesInput): SwimlaneLane[] {
  const parents = knownParentIds ?? EMPTY_PARENT_SET;
  const renderable = issues.filter((issue) =>
    statusOrder.includes(issue.status),
  );

  const byLaneKey = new Map<string, SwimlaneLane>();
  const noneLane = makeLane(
    grouping,
    { key: `${grouping}:${SWIMLANE_NONE_ID}`, rawId: SWIMLANE_NONE_ID },
    statusOrder,
    true,
  );
  const orphanLane = makeLane(
    grouping,
    { key: `parent:${SWIMLANE_ORPHAN_ID}`, rawId: SWIMLANE_ORPHAN_ID },
    statusOrder,
    true,
    true,
  );
  let hasOrphan = false;

  for (const issue of renderable) {
    const slot = laneSlotOf(issue, grouping, parents);
    let lane: SwimlaneLane;
    if (slot.kind === "none") {
      lane = noneLane;
    } else if (slot.kind === "orphan") {
      hasOrphan = true;
      lane = orphanLane;
    } else {
      const existing = byLaneKey.get(slot.seed.key);
      if (existing) {
        lane = existing;
      } else {
        lane = makeLane(grouping, slot.seed, statusOrder);
        byLaneKey.set(slot.seed.key, lane);
      }
    }
    const cell = lane.cells.find((c) => c.status === issue.status);
    if (cell) cell.issues.push(issue);
  }

  noneLane.total = countLane(noneLane);
  orphanLane.total = countLane(orphanLane);

  const ordered = orderLanes([...byLaneKey.values()], {
    actorName,
    projectTitle,
  });
  for (const lane of ordered) lane.total = countLane(lane);

  return hasOrphan
    ? [noneLane, orphanLane, ...ordered]
    : [noneLane, ...ordered];
}

function countLane(lane: SwimlaneLane): number {
  return lane.cells.reduce((n, cell) => n + cell.issues.length, 0);
}

/**
 * The field patch that moves an issue into `lane` — the swimlane move menu's
 * write, mirroring web's `LaneGroup.moveUpdates`. Pinned lanes carry no
 * values, so they resolve to the "clear the dimension" patch.
 */
export function laneMovePatch(lane: SwimlaneLane): {
  assignee_type?: IssueAssigneeType | null;
  assignee_id?: string | null;
  project_id?: string | null;
  parent_issue_id?: string | null;
} {
  if (lane.grouping === "assignee") {
    if (lane.assigneeType && lane.assigneeId) {
      return { assignee_type: lane.assigneeType, assignee_id: lane.assigneeId };
    }
    return { assignee_type: null, assignee_id: null };
  }
  if (lane.grouping === "project") {
    return { project_id: lane.projectId ?? null };
  }
  return { parent_issue_id: lane.parentIssueId ?? null };
}
