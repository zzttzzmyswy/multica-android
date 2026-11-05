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
import { useQuery } from "@tanstack/react-query";
import type {
  IssueStatus,
  IssueStatusCategory,
} from "@multica/core/types";
import {
  ISSUE_STATUS_CATEGORIES,
  isIssueStatusCategory,
} from "@/lib/issue-status-catalog";
import {
  buildStatusOptionGroups,
  groupStatusOptionsByAppearance,
  type StatusOption,
  type StatusOptionGroup,
} from "@/lib/status-options-core";
import {
  resolveStatusScope,
  workflowStatusOptions,
} from "@/lib/workflow-status-scope";
import { useIssueStatuses } from "@/data/queries/issue-statuses";
import { useIssueWorkflows } from "@/data/queries/workflows";
import { projectListOptions } from "@/data/queries/projects";
import { useTranslation } from "@/lib/i18n/react";

export type { StatusOption, StatusOptionGroup } from "@/lib/status-options-core";
export { groupStatusOptionsByAppearance } from "@/lib/status-options-core";

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

/**
 * The statuses ONE issue may be moved to, narrowed by its project's workflow.
 *
 * Grouping goes through `groupStatusOptionsByAppearance`: a workflow's step order
 * is a pipeline, so the headings follow the order the steps appear rather than
 * the canonical category order — otherwise Done renders above Blocked on the
 * live Default workflow, which is the reverse of the pipeline it describes.
 *
 * Web counterpart: `useIssueStatusOptions`
 * (`packages/views/issues/utils/status-options.ts`). The rules — which
 * workflow applies, what a three-valued `projectId` means, and the Default
 * grace for an issue stranded on a dropped column — live in
 * `lib/workflow-status-scope.ts` so they are testable without a renderer.
 *
 * ## `projectId`'s three values
 *
 * - a project id → that project's workflow;
 * - `null` → an issue outside any project: Default, and only Default;
 * - `undefined` → a surface spanning projects (a batch selection): the
 *   catalog, unlimited.
 *
 * ## Reading `authoritative`
 *
 * False means the workflow read has not landed or failed, so the list is the
 * un-narrowed catalog and may include statuses the server would refuse. The
 * picker says so rather than presenting it as complete — see the module doc
 * on `lib/workflow-status-scope.ts` for why this is not folded into an empty
 * list.
 */
export function useIssueStatusOptions(
  wsId: string | null,
  projectId: string | null | undefined,
  currentStatus?: IssueStatus | null,
): {
  /** Flat list in offer order. */
  options: StatusOption[];
  /** Grouped by category, for surfaces that render headings. */
  groups: StatusOptionGroup[];
  /** True once any category holds more than one status. */
  hasCustom: boolean;
  /** The workflow limiting this issue, or null when nothing does. */
  workflow: ReturnType<typeof resolveStatusScope>["workflow"];
  /** True when `options` is the verified set, false when it is a fallback. */
  authoritative: boolean;
  /** The read's state, for a caller that wants to offer a retry. */
  state: ReturnType<typeof resolveStatusScope>["state"];
  retry: () => void;
} {
  const catalog = useStatusOptions(wsId);
  const { workflows, state, refetch } = useIssueWorkflows(wsId ?? null);
  // Projects are only consulted to map a project id to its workflow_id, and
  // only when a concrete project is named — a spanning or project-less surface
  // must not pay for (or wait on) this read.
  const needsProjects = typeof projectId === "string" && projectId.length > 0;
  const { data: projects } = useQuery({
    ...projectListOptions(wsId),
    enabled: !!wsId && needsProjects,
  });

  // The current status does NOT belong in this memo: it changes no scope, only
  // where the current row is re-inserted in the option list below. Passing it
  // here would recompute the scope (and every option's identity) on each status
  // write for no gain.
  const scope = useMemo(
    () =>
      resolveStatusScope({
        workflows,
        state,
        projectId,
        projects,
      }),
    [workflows, state, projectId, projects],
  );

  const options = useMemo(
    () =>
      workflowStatusOptions(
        catalog.options,
        scope,
        currentStatus,
        ISSUE_STATUS_CATEGORIES,
      ),
    [catalog.options, scope, currentStatus],
  );

  const groups = useMemo(
    () => groupStatusOptionsByAppearance(options, ISSUE_STATUS_CATEGORIES),
    [options],
  );

  return {
    options,
    groups,
    hasCustom: catalog.hasCustom || options.length > ISSUE_STATUS_CATEGORIES.length,
    workflow: scope.workflow,
    authoritative: scope.authoritative,
    state: scope.state,
    retry: refetch,
  };
}