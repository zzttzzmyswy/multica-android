/**
 * Board/swimlane hidden-column wiring, shared by the three issue surfaces.
 *
 * Hiding a status column is not its own store field — `hideStatus` writes
 * `statusFilters`, which is also the server window's status facet (see
 * issue-filter-slice.ts). That is web's model and it means the board, the
 * swimlane, the filter chips and the fetched window all agree by construction.
 * What this hook adds is the glue each surface would otherwise repeat: the
 * derived hidden list, the two callbacks, and the saved-view guard.
 */
import { useCallback, useMemo } from "react";
import type { IssueStatus } from "@multica/core/types";
import {
  hiddenStatuses,
  isStatusHidden,
  type IssueFilterSlice,
} from "@/data/stores/issue-filter-slice";
import { BOARD_STATUSES } from "@/lib/issue-status-core";
import type { IssueViewBaseline } from "@/data/stores/issue-view-codec";

export interface BoardHiddenColumnProps {
  hiddenStatuses: IssueStatus[];
  hideStatus: (status: IssueStatus) => void;
  showStatus: (status: IssueStatus) => void;
  /** True when the open saved view pins this status — hiding it would strip
   *  one of the view's own conditions while its chip still reads as active
   *  (web board-column.tsx:119-122). */
  isStatusFixed: (status: IssueStatus) => boolean;
  /** Every column hidden — the board shows its dedicated empty state. */
  allStatusesHidden: boolean;
}

export function useBoardHiddenColumns({
  store,
  statusFilters,
  baseline,
}: {
  store: {
    getState: () => Pick<IssueFilterSlice, "hideStatus" | "showStatus">;
  };
  statusFilters: IssueStatus[];
  /** The open saved view's baseline, or null with no view open. */
  baseline: IssueViewBaseline | null;
}): BoardHiddenColumnProps {
  const hidden = useMemo(() => hiddenStatuses(statusFilters), [statusFilters]);

  const hideStatus = useCallback(
    (status: IssueStatus) => store.getState().hideStatus(status),
    [store],
  );
  const showStatus = useCallback(
    (status: IssueStatus) => store.getState().showStatus(status),
    [store],
  );

  const isStatusFixed = useCallback(
    (status: IssueStatus) => baseline?.status.has(status) ?? false,
    [baseline],
  );

  return {
    hiddenStatuses: hidden,
    hideStatus,
    showStatus,
    isStatusFixed,
    // "Everything hidden" is not `hidden.length > 0` — it is specifically the
    // state where an ACTIVE status filter leaves nothing visible. A
    // non-status filter (assignee, label) emptying the board is a different
    // situation and keeps the ordinary empty message.
    allStatusesHidden: statusFilters.length === 0
      ? false
      : BOARD_STATUSES.every((s) => isStatusHidden(statusFilters, s)),
  };
}
