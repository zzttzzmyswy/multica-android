/**
 * Status options shared by the picker and the filter (MUL-6243), mirroring
 * web's `packages/views/issues/utils/status-options.ts` + `status-label.ts`.
 *
 * Naming rule converging here, once:
 *   - a BUILT-IN status key always resolves through i18n — never through the
 *     catalog's server-seeded English name, or every non-English workspace
 *     would see "In Progress" where it used to see "进行中".
 *   - a CUSTOM status resolves through its catalog entry (`name`); unknown
 *     keys fall back to the raw key.
 *
 * Archived statuses are excluded from the pickable set (`activeStatuses`):
 * archiving retires a status from future assignment, but issues already on it
 * keep its real name/color via the catalog query that keeps archived rows.
 */
import { useCallback, useMemo } from "react";
import type {
  IssueStatus,
  IssueStatusCategory,
} from "@multica/core/types";
import {
  ISSUE_STATUS_CATEGORIES,
  isIssueStatusCategory,
} from "@/lib/issue-status-catalog";
import { buildStatusOptionGroups, type StatusOption, type StatusOptionGroup } from "@/lib/status-options-core";
import { useIssueStatuses } from "@/data/queries/issue-statuses";
import { useTranslation } from "@/lib/i18n/react";

export type { StatusOption, StatusOptionGroup } from "@/lib/status-options-core";

/**
 * Resolves a status KEY to the label the UI should show: built-ins through
 * i18n, custom statuses through the catalog, unknown keys as the raw key.
 */
export function useStatusLabel(wsId?: string | null): (statusKey: string) => string {
  const { t } = useTranslation();
  const { entryOf } = useIssueStatuses(wsId ?? null);

  return useCallback(
    (statusKey: string): string => {
      if (isIssueStatusCategory(statusKey)) {
        return t(`enum.status.${statusKey}`);
      }
      return entryOf(statusKey)?.name ?? statusKey;
    },
    [t, entryOf],
  );
}

/**
 * The statuses a user can pick or filter by, grouped by category in canonical
 * order. Shared by the status picker and the status filter so the two can
 * never drift. A status offered in one and missing from the other is exactly
 * how an issue becomes unfindable.
 */
export function useStatusOptions(wsId?: string | null): {
  groups: StatusOptionGroup[];
  /** Flat list in the same order, for surfaces without grouping. */
  options: StatusOption[];
  /** True once any category holds more than one status — group headings earn their space. */
  hasCustom: boolean;
} {
  const { activeStatuses } = useIssueStatuses(wsId ?? null);
  const labelOf = useStatusLabel(wsId ?? null);
  return useMemo(
    () => buildStatusOptionGroups(ISSUE_STATUS_CATEGORIES, activeStatuses, labelOf),
    [activeStatuses, labelOf],
  );
}