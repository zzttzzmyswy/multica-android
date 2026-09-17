/**
 * Server-authoritative group counts for the mobile issue table (MYS-1178).
 *
 * Web asks the server to group (`POST /api/issues/table/groups`) and renders
 * `descriptor.count` straight from the response, so a group header counts the
 * COMPLETE result set. Mobile segments its loaded window locally
 * (`lib/issue-table-groups.ts`), which under-reports every group the window
 * has not paged in yet.
 *
 * This module is the bridge: it derives the request spec mobile has to send,
 * and maps the descriptors the server sends back onto the group keys mobile
 * builds locally. Everything here is pure — the query lives in
 * `data/queries/issue-table-groups.ts`.
 */
import type {
  IssueAssigneeType,
  IssueTableGroupDescriptor,
  IssueTableGroupSpec,
  IssueTableGroupValue,
  IssueTableQuerySpec,
  IssueTableScope,
} from "@multica/core/types";
import type { IssueListWindowParams } from "@/data/queries/issue-keys";
import {
  propertyIdFromGrouping,
  type IssueTableGrouping,
} from "./issue-table-groups";

/** The workspace scope tabs mobile's Issues screen exposes. */
export type WorkspaceIssueScopeTab = "all" | "members" | "agents";

/**
 * Scope tab → the `assignee_types` a Table scope carries, mirroring web's
 * `assigneeTypesForActorKind` (packages/core/issues/surface/scope.ts:27):
 * the `members` / `agents` tabs are a client-side predicate on
 * `GET /api/issues` (see `more/issues.tsx`), but the Table query spec
 * expresses them server-side, squads counting as agent work.
 */
export function assigneeTypesForScopeTab(
  tab: WorkspaceIssueScopeTab,
): IssueAssigneeType[] | undefined {
  switch (tab) {
    case "members":
      return ["member"];
    case "agents":
      return ["agent", "squad"];
    default:
      return undefined;
  }
}

export function workspaceIssueTableScope(
  tab: WorkspaceIssueScopeTab,
): IssueTableScope {
  const assigneeTypes = assigneeTypesForScopeTab(tab);
  return {
    kind: "workspace",
    ...(assigneeTypes ? { assignee_types: assigneeTypes } : {}),
  };
}

/**
 * "My issues" tab → server scope. Mobile's `all` scatter-gathers three legs
 * on the list API because `GET /api/issues` ANDs its params; the Table spec
 * has a real union (`relation: "any"`, server `any` = assigned OR created OR
 * involved — see issue_table_query.go:505), so the whole tab is one query.
 */
export function myIssueTableScope(
  scope: "all" | "assigned" | "created" | "agents",
): IssueTableScope {
  switch (scope) {
    case "all":
      return { kind: "my", relation: "any" };
    case "agents":
      return { kind: "my", relation: "involved" };
    default:
      return { kind: "my", relation: scope };
  }
}

/** The grouping dimension as the server's group spec, or null when the table
 *  is ungrouped (nothing to ask for). */
export function issueTableGroupSpecFor(
  grouping: IssueTableGrouping,
): Exclude<IssueTableGroupSpec, { kind: "none" }> | null {
  if (grouping === "status") return { kind: "status" };
  if (grouping === "assignee") return { kind: "assignee" };
  const propertyId = propertyIdFromGrouping(grouping);
  return propertyId ? { kind: "property", property_id: propertyId } : null;
}

/**
 * The window mobile passes to `GET /api/issues` → the Table query spec.
 *
 * Sort is deliberately NOT carried over: group counts are sort-invariant, and
 * keeping it out means re-sorting the table does not refetch them. The default
 * positional sort is what the server would fall back to anyway.
 *
 * `include_sub_issues` IS carried over — the surface's "show sub-issues"
 * toggle filters rows out client-side, so a count that ignored it would
 * report rows the table is not showing.
 */
export function buildIssueTableGroupQuerySpec(
  scope: IssueTableScope,
  window: IssueListWindowParams,
  includeSubIssues = true,
): IssueTableQuerySpec {
  const date =
    window.date_field && window.date_start && window.date_end
      ? {
          field: window.date_field,
          start: window.date_start,
          end: window.date_end,
        }
      : undefined;
  return {
    scope,
    filters: {
      ...(window.statuses?.length ? { statuses: window.statuses } : {}),
      ...(window.priorities?.length ? { priorities: window.priorities } : {}),
      ...(window.assignee_filters?.length
        ? { assignees: window.assignee_filters }
        : {}),
      ...(window.include_no_assignee ? { include_no_assignee: true } : {}),
      ...(window.creator_filters?.length
        ? { creators: window.creator_filters }
        : {}),
      ...(window.project_ids?.length
        ? { project_ids: window.project_ids }
        : {}),
      ...(window.include_no_project ? { include_no_project: true } : {}),
      ...(window.label_ids?.length ? { label_ids: window.label_ids } : {}),
      ...(window.properties && Object.keys(window.properties).length > 0
        ? { properties: window.properties }
        : {}),
      ...(date ? { date } : {}),
      include_sub_issues: includeSubIssues,
    },
    sort: { field: "position", direction: "asc" },
  };
}

/**
 * A server descriptor's value → the group key `buildIssueTableGroups` builds
 * locally, so a header can look its server count up by key.
 *
 * The keys agree by construction for status/assignee. For properties the
 * server base64url-encodes the raw value into its own key
 * (issue_table_group.go:383), so the descriptor's decoded `value` is used
 * instead of its `key`. Returns null for a descriptor mobile cannot render
 * (project / parent groupings, or a value shape it does not model) — the
 * caller falls back to the local count for that group.
 */
export function serverGroupKey(value: IssueTableGroupValue): string | null {
  switch (value.kind) {
    case "status":
      return `status:${value.status}`;
    case "assignee":
      return value.actor
        ? `assignee:${value.actor.type}:${value.actor.id}`
        : "assignee:unassigned";
    case "property": {
      const prefix = `property:${value.property_id}`;
      if (value.value_state === "unset") return `${prefix}:unset`;
      if (value.value_state === "unavailable") {
        return typeof value.value === "string" && value.value !== ""
          ? `${prefix}:unavailable:${value.value}`
          : `${prefix}:unavailable`;
      }
      // state === "value": select stores the option id, checkbox a boolean.
      if (typeof value.value === "boolean") {
        return `${prefix}:value:${String(value.value)}`;
      }
      if (typeof value.value === "string") {
        return `${prefix}:value:${value.value}`;
      }
      return null;
    }
    default:
      return null;
  }
}

/** Descriptors → `mobile group key → count`. Unmappable descriptors drop. */
export function serverGroupCountMap(
  groups: readonly IssueTableGroupDescriptor[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const group of groups) {
    const key = serverGroupKey(group.value);
    if (key) counts.set(key, group.count);
  }
  return counts;
}
