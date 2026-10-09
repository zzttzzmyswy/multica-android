/**
 * The controller behind the workspace wakeup table (MYS-2043).
 *
 * `components/autopilot/workspace-wakeups-table.tsx` is layout; the state and
 * the decisions live here. The separation is the same one the issue surface
 * uses (`lib/wakeup-controls.ts` holds the branch order, the JSX renders it),
 * and for the same reason: the mobile vitest lane is Node-only, so anything
 * that can be a pure function is one.
 *
 * What this hook owns:
 *   - the filter bag and the paging offset, both of which travel to the SERVER
 *     (`GET /api/issue-wakeups` takes them as query params), so they are query
 *     key inputs rather than client-side narrowing;
 *   - the selection set, reconciled against the rows on screen every render
 *     (`workspaceWakeupSelection`) so a filter change cannot leave a stale id
 *     selected off-screen;
 *   - the batch run and its partial-failure result, which the footer reports and
 *     the selection retries from.
 *
 * Nothing here polls. `data/queries/workspace-wakeups.ts` documents why the
 * phone does not use web's 10s interval.
 */
import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  WorkspaceWakeup,
  WorkspaceWakeupFilters,
  WakeupScope,
} from "@multica/core/types";
import {
  FIRST_WORKSPACE_WAKEUP_PAGE,
  workspaceWakeupBannerOptions,
  workspaceWakeupsOptions,
} from "@/data/queries/workspace-wakeups";
import { useDisableWorkspaceWakeups } from "@/data/mutations/workspace-wakeups";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { useActorLookup } from "@/data/use-actor-name";
import {
  EMPTY_WORKSPACE_WAKEUP_FILTERS,
  WORKSPACE_WAKEUP_KINDS,
  WORKSPACE_WAKEUP_PAGE_SIZE,
  WORKSPACE_WAKEUP_SCOPES,
  WORKSPACE_WAKEUP_SOURCES,
  isWorkspaceWakeupFiltered,
  nextWorkspaceWakeupOffset,
  previousWorkspaceWakeupOffset,
  toggleWorkspaceWakeupSelection,
  workspaceWakeupBanner,
  workspaceWakeupPageNumber,
  workspaceWakeupRowBlock,
  workspaceWakeupSelectable,
  workspaceWakeupSelection,
  workspaceWakeupTriggerDetail,
  workspaceWakeupTriggerText,
  workspaceWakeupEndsText,
} from "@/lib/workspace-wakeups";
import type { WorkspaceWakeupBatchResult } from "@/lib/workspace-wakeups";
import {
  wakeupRunStateText,
  type WakeupTextDeps,
} from "@/lib/wakeup-presentation";
import { useStatusLabel } from "@/lib/status-options";

/** A single-choice filter option: the server's value plus its i18n id. */
export interface WorkspaceWakeupOption<T extends string> {
  value: T;
  labelKey: string;
}

/** The text bundle the row renderer reads. Built once per controller. */
export interface WorkspaceWakeupText {
  trigger: (row: WorkspaceWakeup) => string;
  triggerDetail: (row: WorkspaceWakeup) => string | null;
  ends: (row: WorkspaceWakeup) => string;
  runState: (row: WorkspaceWakeup) => string | null;
  selectable: (row: WorkspaceWakeup) => boolean;
  blockKey: (row: WorkspaceWakeup) => string | null;
}

export interface WorkspaceWakeupsController {
  filters: WorkspaceWakeupFilters;
  setFilters: (patch: Partial<WorkspaceWakeupFilters>) => void;
  /** Back to the neutral window, offset included. */
  clearFilters: () => void;
  /** Whether anything is narrowing the table, for the empty state. */
  filtered: boolean;

  page: { items: WorkspaceWakeup[]; total: number } | undefined;
  counts: Record<WakeupScope, number>;
  isLoading: boolean;
  isError: boolean;
  isRefetching: boolean;
  refetch: () => void;

  /** The newest paused rule, or null when nothing is paused / it has not
   *  loaded. */
  banner: ReturnType<typeof workspaceWakeupBanner>;

  selected: ReadonlySet<string>;
  selection: ReturnType<typeof workspaceWakeupSelection>;
  toggleSelect: (id: string) => void;
  toggleSelectAll: () => void;
  clearSelection: () => void;

  batch: ReturnType<typeof useDisableWorkspaceWakeups>;
  batchResult: WorkspaceWakeupBatchResult | null;
  /** Runs the batch over the current selection and keeps the failures
   *  selected, web's retry contract. */
  runBatch: () => Promise<void>;

  pageNumber: number;
  nextOffset: number | null;
  previousOffset: number | null;
  goToOffset: (offset: number | null) => void;

  /** The filter catalogs, in the server's own order. */
  sourceOptions: WorkspaceWakeupOption<"" | "member" | "agent" | "system">[];
  kindOptions: WorkspaceWakeupOption<WorkspaceWakeupFilters["kind"]>[];
  agentOptions: { id: string; name: string }[];
  agentLabel: string;

  text: WorkspaceWakeupText;
}

export function useWorkspaceWakeupsController(): WorkspaceWakeupsController {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  const statusLabel = useStatusLabel(wsId);
  const { getName } = useActorLookup();

  const [filters, setFiltersState] = useState<WorkspaceWakeupFilters>(
    FIRST_WORKSPACE_WAKEUP_PAGE,
  );
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [batchResult, setBatchResult] = useState<WorkspaceWakeupBatchResult | null>(
    null,
  );

  const query = useQuery(workspaceWakeupsOptions(wsId, filters));
  const counts = useMemo(
    () =>
      query.data?.counts ?? {
        active: 0,
        all: 0,
        paused: 0,
        disabled: 0,
        ended: 0,
      },
    [query.data],
  );
  const bannerQuery = useQuery(workspaceWakeupBannerOptions(wsId, counts));

  const batch = useDisableWorkspaceWakeups();

  const deps: WakeupTextDeps = useMemo(
    () => ({
      t,
      statusLabel,
      actorName: (type: string, id: string) => getName(type as "agent", id),
    }),
    [t, statusLabel, getName],
  );

  const rows = query.data?.items ?? [];
  const selection = useMemo(
    () => workspaceWakeupSelection(rows, selected),
    [rows, selected],
  );

  /**
   * Change the window.
   *
   * Every change resets the OFFSET, which is the part that is easy to get
   * wrong: narrowing a filter while on page 3 lands on an offset the new result
   * set may not have, and the server answers an empty page that reads as "no
   * matches". The selection and the batch report are dropped for the same
   * reason — they name rows of a window that no longer exists.
   */
  const setFilters = useCallback(
    (patch: Partial<WorkspaceWakeupFilters>) => {
      setFiltersState((prev) => ({ ...prev, offset: 0, ...patch }));
      setSelected(new Set());
      setBatchResult(null);
    },
    [],
  );

  const clearFilters = useCallback(() => {
    setFiltersState({ ...EMPTY_WORKSPACE_WAKEUP_FILTERS });
    setSelected(new Set());
    setBatchResult(null);
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => toggleWorkspaceWakeupSelection(prev, id));
  }, []);

  const toggleSelectAll = useCallback(() => {
    const selectable = rows
      .filter(workspaceWakeupSelectable)
      .map((row) => row.id);
    setSelected((prev) => {
      const current = workspaceWakeupSelection(rows, prev);
      return current.allSelected ? new Set() : new Set(selectable);
    });
  }, [rows]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const runBatch = useCallback(async () => {
    const result = await batch.mutateAsync(selection.picked);
    setBatchResult(result);
    // The failures stay selected so the button can be pressed again; web does
    // the same (`setSelected(new Set(result.failed))`).
    setSelected(new Set(result.failed));
  }, [batch, selection.picked]);

  const goToOffset = useCallback(
    (offset: number | null) => {
      if (offset === null) return;
      setFiltersState((prev) => ({ ...prev, offset }));
      setSelected(new Set());
      setBatchResult(null);
    },
    [],
  );

  const agentOptions = useMemo(() => query.data?.agents ?? [], [query.data]);

  const text: WorkspaceWakeupText = useMemo(
    () => ({
      trigger: (row) => workspaceWakeupTriggerText(deps, row),
      triggerDetail: (row) => workspaceWakeupTriggerDetail(deps, row),
      ends: (row) => workspaceWakeupEndsText(deps, row),
      runState: (row) =>
        // The table's own row carries the run it needs (`task`), so there is
        // nothing to resolve through `wakeupRun`: this surface never loads the
        // issue's task list. Web's `RunsCell` reads `row.task?.status` the same
        // way and shows the state only while the run is active.
        row.task ? wakeupRunStateText(deps, row.task.status) : null,
      selectable: workspaceWakeupSelectable,
      blockKey: (row) => {
        const block = workspaceWakeupRowBlock({
          row,
          pending: batch.isPending,
        });
        if (block === null) return null;
        if (block === "read_only") return "autopilots.wakeups.read_only";
        if (block === "closed") return "wakeups.closedHint";
        return null;
      },
    }),
    [deps, batch.isPending],
  );

  return {
    filters,
    setFilters,
    clearFilters,
    filtered: isWorkspaceWakeupFiltered(filters),
    page: query.data
      ? { items: query.data.items, total: query.data.total }
      : undefined,
    counts,
    isLoading: query.isLoading,
    isError: query.isError,
    isRefetching: query.isRefetching,
    refetch: () => void query.refetch(),
    banner: workspaceWakeupBanner(
      deps,
      filters,
      counts,
      bannerQuery.data?.items[0],
    ),
    selected,
    selection,
    toggleSelect,
    toggleSelectAll,
    clearSelection,
    batch,
    batchResult,
    runBatch,
    pageNumber: workspaceWakeupPageNumber(filters.offset),
    nextOffset: nextWorkspaceWakeupOffset(
      filters.offset,
      query.data?.total ?? 0,
      WORKSPACE_WAKEUP_PAGE_SIZE,
    ),
    previousOffset: previousWorkspaceWakeupOffset(filters.offset),
    goToOffset,
    sourceOptions: WORKSPACE_WAKEUP_SOURCES.map((value) => ({
      value,
      labelKey: value
        ? `autopilots.wakeups.sources.${value}`
        : "autopilots.wakeups.sources.all",
    })),
    kindOptions: WORKSPACE_WAKEUP_KINDS.map((value) => ({
      value,
      labelKey:
        value === "all"
          ? "autopilots.wakeups.all_triggers"
          : `autopilots.wakeups.kinds.${value}`,
    })),
    agentOptions,
    agentLabel: filters.agent_id
      ? (agentOptions.find((a) => a.id === filters.agent_id)?.name ?? "")
      : t("autopilots.wakeups.all_agents"),
    text,
  };
}

/** The scope list, exported so a test can pin the order without importing the
 *  table component (which pulls in React Native). */
export { WORKSPACE_WAKEUP_SCOPES };
