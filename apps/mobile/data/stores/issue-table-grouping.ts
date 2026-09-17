/**
 * Table-view grouping slice (MYS-1156) — mobile surface of web's
 * `view-store.ts` `tableGrouping` / `setTableGrouping`.
 *
 * Same factory shape as `issue-table-columns.ts`: each of the three issue
 * view stores (`issues-view-store` / `my-issues-view-store` /
 * `project-issues-view-store`) owns an instance, so grouping one surface
 * never regroups another.
 *
 * The grouping VALUE is web's: `none` | `status` | `assignee` |
 * `property:<definitionId>`. Only the rendering differs — web sends it to the
 * server and paginates per group; mobile segments the loaded window client
 * side (`lib/issue-table-groups.ts`).
 */
import type { IssueTableGrouping } from "@/lib/issue-table-groups";

export interface TableGroupingSlice {
  tableGrouping: IssueTableGrouping;
  /** Set the active grouping dimension. */
  setTableGrouping: (grouping: IssueTableGrouping) => void;
}

export function defaultTableGrouping(): IssueTableGrouping {
  return "none";
}

export function createTableGroupingActions<T extends TableGroupingSlice>(set: (
  partial:
    | Partial<TableGroupingSlice>
    | ((state: TableGroupingSlice) => Partial<TableGroupingSlice>),
) => void): Pick<TableGroupingSlice, "setTableGrouping"> {
  return { setTableGrouping: (tableGrouping) => set({ tableGrouping }) };
}
