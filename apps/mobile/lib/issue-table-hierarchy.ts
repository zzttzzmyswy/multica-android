/**
 * Parent/child hierarchy for the mobile issue table (MYS-1149, web parity
 * with `packages/views/issues/components/table-view.tsx`).
 *
 * Web gets its tree from the server: the query paginates per
 * (groupKey, parentId) branch and returns rows already in parent-then-child
 * order, so `row.depth` / `row.hasChildren` / `row.collapsed` arrive as
 * server fields. Mobile loads one flat, client-sorted window, so the same
 * three things are derived here instead:
 *
 *   - `depth`       — parent hops within the LOADED window (`parent_issue_id`
 *                     chains). A parent that isn't in the window can't indent
 *                     its child, so that child reads as a root.
 *   - `hasChildren` — some loaded row names this row as its parent.
 *   - `collapsed`   — the caller's collapsed set, echoed back for the chevron.
 *
 * Order is deliberately preserved: the surface already applied the user's
 * sort (header-tap cycling), and web keeps the same sort *within* branches.
 * Re-nesting here would silently override the sort the user just chose.
 *
 * Depth is capped (see `MAX_DEPTH`) and cycle-guarded — a corrupted
 * `parent_issue_id` loop must not hang the render.
 */
import type { Issue } from "@multica/core/types";

/** Deepest indent the table renders; deeper chains flatten at the cap. */
export const MAX_DEPTH = 6;

export interface IssueTableRow {
  issue: Issue;
  /** 0 for a root row, +1 per parent hop inside the loaded window. */
  depth: number;
  /** True when some loaded row has this row as its `parent_issue_id`. */
  hasChildren: boolean;
  /** Caller-owned collapse state, echoed for the chevron direction. */
  collapsed: boolean;
}

/**
 * Resolve one row's depth by walking `parent_issue_id` up through the loaded
 * window. `byId` holds only the rows on screen, so a chain that leaves the
 * window terminates at depth 0 — the row is a root as far as the table can
 * tell. Meeting a node twice means the chain loops (corrupt data): there is
 * no root to indent from, so the row also reads as a root.
 */
function depthOf(id: string, parentOf: Map<string, string>, byId: Set<string>): number {
  let depth = 0;
  const seen = new Set<string>([id]);
  let cursor = parentOf.get(id);
  while (cursor && byId.has(cursor) && depth < MAX_DEPTH) {
    if (seen.has(cursor)) return 0;
    seen.add(cursor);
    depth += 1;
    cursor = parentOf.get(cursor);
  }
  return depth;
}

/**
 * Project the surface's flat, sorted rows into table rows, dropping every
 * descendant of a collapsed row (at any depth — collapsing a grandparent
 * hides the whole subtree, matching web's `collapsed` branch pruning).
 */
export function buildIssueTableRows(
  issues: readonly Issue[],
  collapsedIds: ReadonlySet<string>,
): IssueTableRow[] {
  const byId = new Set(issues.map((issue) => issue.id));

  const parentOf = new Map<string, string>();
  const hasChildren = new Set<string>();
  for (const issue of issues) {
    const parentId = issue.parent_issue_id;
    if (!parentId) continue;
    parentOf.set(issue.id, parentId);
    // Only a parent inside the window can be collapsed, so only in-window
    // parents get a chevron.
    if (byId.has(parentId)) hasChildren.add(parentId);
  }

  const depthCache = new Map<string, number>();
  const depthOfCached = (id: string): number => {
    const cached = depthCache.get(id);
    if (cached !== undefined) return cached;
    const depth = depthOf(id, parentOf, byId);
    depthCache.set(id, depth);
    return depth;
  };

  const rows: IssueTableRow[] = [];
  for (const issue of issues) {
    // Hide the row when ANY ancestor is collapsed — walk the chain and bail
    // on the first hit. Same cycle guard as depthOf.
    let hidden = false;
    const seen = new Set<string>([issue.id]);
    let cursor = parentOf.get(issue.id);
    while (cursor && byId.has(cursor) && !seen.has(cursor)) {
      if (collapsedIds.has(cursor)) {
        hidden = true;
        break;
      }
      seen.add(cursor);
      cursor = parentOf.get(cursor);
    }
    if (hidden) continue;

    rows.push({
      issue,
      depth: depthOfCached(issue.id),
      hasChildren: hasChildren.has(issue.id),
      collapsed: collapsedIds.has(issue.id),
    });
  }
  return rows;
}
