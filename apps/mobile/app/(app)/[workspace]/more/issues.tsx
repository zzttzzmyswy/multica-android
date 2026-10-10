/**
 * Workspace-wide Issues page. Mirrors web `packages/views/issues/components/
 * issues-page.tsx:32-94`: fetch every issue in the workspace, expose
 * `all / members / agents` scope tabs, group by status, allow status +
 * priority filtering.
 *
 * Since iteration 62 the page also carries web's full issue-workbench
 * dimensions: assignee / creator / project / label filters + sort + grouping.
 * Filter/sort state lives in `useIssuesViewStore` (shared with the filter
 * sheet); the list query passes the active window as server params
 * (`issueListOptions(wsId, window)`) so the cache is keyed per filter, and
 * the client re-runs `applyIssueFilters` + `sortIssues` on the result as a
 * belt-and-suspenders pass for WS-patched rows.
 *
 * Scope is a **client-side** filter on `assignee_type` — matches web
 * `issues-page.tsx:90-94`. This keeps `issueListOptions(wsId)` workspace-
 * scoped (no scope param on the wire), so `issueKeys.list(wsId)` and
 * `useIssuesRealtime` need no changes.
 *
 * Grouping (status / assignee) is client-side via `groupIssues` — mirrors
 * web GROUPING_OPTIONS. Assignee grouping resolves actor names through
 * `useActorLookup`, same source as the assignee filter picker.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { SectionList, View } from "react-native";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import type { IssueView } from "@multica/core/api/schemas";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
// Header chrome (back + "Issues" title) comes from the parent Stack
// (`apps/mobile/app/(app)/[workspace]/_layout.tsx:269`). The Filter
// affordance now lives in <IssueSurfaceScopeToolbar> below, matching web's
// IssuesHeader pattern (scope + filter share a row).
import { BatchActionBar } from "@/components/issue/batch-action-bar";
import { BoardView } from "@/components/issue/board-view";
import { GanttView } from "@/components/issue/gantt-view";
import { SwimlaneView } from "@/components/issue/swimlane-view";
import { IssueViewBar } from "@/components/issue/issue-view-bar";
import { IssueTableView } from "@/components/issue/table-view";
import { IssuesLoading } from "@/components/issue/issues-loading";
import { IssueListFooter } from "@/components/issue/issue-list-footer";
import {
  ActiveFilterChips,
  useFilterChipBaseline,
  IssueSection,
  IssueSectionHeader,
  IssueSelectionRow,
  IssueSurfaceAgentActivityRow,
  IssueSurfaceScopeToolbar,
  SurfaceEmptyState,
} from "@/components/issue/issue-surface-chrome";
import { ganttIssuesOptions, issueListOptions } from "@/data/queries/issues";
import { workingAgentsFacetOptions } from "@/data/queries/working-agents";
import { readIssueRows } from "@/data/queries/issue-list-cache";
import {
  hasMoreIssues,
  issueListTotal,
} from "@/lib/issue-pagination";
import { useDrainIssuePages } from "@/lib/use-drain-issue-pages";
import { issueViewListOptions } from "@/data/queries/issue-views";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  useIssuesViewStore,
  type IssuesScope,
} from "@/data/stores/issues-view-store";
import { useCreateSubIssue } from "@/lib/use-create-sub-issue";
import { useIssueBatchSelectionStore } from "@/data/stores/issue-batch-selection-store";
import {
  issueViewContainerKey,
  useActiveIssueViewStore,
} from "@/data/stores/active-issue-view-store";
import {
  viewMatchesSlice,
} from "@/data/stores/issue-view-codec";
import {
  actorKindForViewVariant,
  applySavedView,
  useApplyExternallyActivatedView,
} from "@/lib/saved-view-apply";
import {
  buildIssueWindow,
  defaultIssueFilterSlice,
  hasActiveIssueFilters,
} from "@/data/stores/issue-filter-slice";
import { useRunningIssueIds } from "@/data/queries/agent-task-snapshot";
import { issueRowNarrowing } from "@/lib/issue-row-narrowing";
import {
  countWorkingOnly,
  withWorkingCountDimension,
  workspaceIssueTableScope,
} from "@/lib/issue-table-group-counts";
import { useCreateIssueFromColumn } from "@/lib/use-create-issue-from-column";
import { useClearFiltersOnWorkspaceChange } from "@/lib/use-clear-filters-on-workspace-change";
import { useDebouncedTableSearch } from "@/lib/use-debounced-table-search";
import { useBoardHiddenColumns } from "@/lib/use-board-hidden-columns";
import { useGroupingProperty } from "@/lib/use-grouping-property";
import { useListSectionFolding } from "@/data/stores/issue-workbench-layout-store";
import { BOARD_STATUSES } from "@/lib/issue-status-core";
import {
  applyIssueFilters,
  groupIssues,
  sortIssues,
  type IssueFilterState,
} from "@/lib/filter-issues";
import { useTranslation } from "@/lib/i18n/react";

// Scope tab definitions. Mirrors web `issuesScopeStore`. Counts are NOT
// rendered on the pill labels — web's `IssuesHeader` doesn't show them
// either, and on SE3 (375pt) "(123)" appended to each label pushes the
// row past the safe width when filter icon shares the row. Per-status
// counts still appear on the SectionList headers below.
const SCOPES: { value: IssuesScope; labelKey: string }[] = [
  { value: "all", labelKey: "issues.scopeAll" },
  { value: "members", labelKey: "issues.scopeMembers" },
  { value: "agents", labelKey: "issues.scopeAgents" },
];

export default function IssuesPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const batchSelectionMode = useIssueBatchSelectionStore((s) => s.selectionMode);
  const { t } = useTranslation();

  const scope = useIssuesViewStore((s) => s.scope);
  const setScope = useIssuesViewStore((s) => s.setScope);
  const view = useIssuesViewStore((s) => s.view);
  const setView = useIssuesViewStore((s) => s.setView);
  const swimlaneGrouping = useIssuesViewStore((s) => s.swimlaneGrouping);
  const tableColumns = useIssuesViewStore((s) => s.tableColumns);
  const toggleTableColumn = useIssuesViewStore((s) => s.toggleTableColumn);
  const tableColumnWidths = useIssuesViewStore((s) => s.tableColumnWidths);
  const setTableColumnWidth = useIssuesViewStore((s) => s.setTableColumnWidth);
  const reorderTableColumn = useIssuesViewStore((s) => s.reorderTableColumn);
  const resetTableColumns = useIssuesViewStore((s) => s.resetTableColumns);
  const createSubIssue = useCreateSubIssue();
  const tableGrouping = useIssuesViewStore((s) => s.tableGrouping);
  const tableHierarchy = useIssuesViewStore((s) => s.tableHierarchy);
  const setTableGrouping = useIssuesViewStore((s) => s.setTableGrouping);
  const grouping = useIssuesViewStore((s) => s.grouping);
  const groupingProperty = useGroupingProperty(grouping);
  const sortBy = useIssuesViewStore((s) => s.sortBy);
  const sortDirection = useIssuesViewStore((s) => s.sortDirection);
  const statusFilters = useIssuesViewStore((s) => s.statusFilters);
  const priorityFilters = useIssuesViewStore((s) => s.priorityFilters);
  const assigneeFilters = useIssuesViewStore((s) => s.assigneeFilters);
  const includeNoAssignee = useIssuesViewStore((s) => s.includeNoAssignee);
  const creatorFilters = useIssuesViewStore((s) => s.creatorFilters);
  const projectFilters = useIssuesViewStore((s) => s.projectFilters);
  const includeNoProject = useIssuesViewStore((s) => s.includeNoProject);
  const labelFilters = useIssuesViewStore((s) => s.labelFilters);
  const propertyFilters = useIssuesViewStore((s) => s.propertyFilters);
  const dateFilter = useIssuesViewStore((s) => s.dateFilter);
  const workingOnly = useIssuesViewStore((s) => s.workingOnly);
  const showSubIssues = useIssuesViewStore((s) => s.showSubIssues);
  const cardProperties = useIssuesViewStore((s) => s.cardProperties);
  // The custom-property ids a card draws — web's second card display
  // dimension, saved with the view like `cardProperties` above.
  const cardPropertyIds = useIssuesViewStore((s) => s.cardPropertyIds);
  // Running-agent projection for the working-only filter. `undefined` while
  // the snapshot loads — the predicate fails closed on it, which is the
  // intended "only what is provably working" read.
  const runningIssueIds = useRunningIssueIds();
  // Stable dedup of the object that feeds applyIssueFilters (each field is
  // its own subscription above, so the assembled object only changes when a
  // dimension actually changes).
  const filterState = useMemo<IssueFilterState>(
    () => ({
      statusFilters,
      priorityFilters,
      assigneeFilters,
      includeNoAssignee,
      creatorFilters,
      projectFilters,
      includeNoProject,
      labelFilters,
      propertyFilters,
      dateFilter,
      workingOnly,
      showSubIssues,
    }),
    [
      statusFilters,
      priorityFilters,
      assigneeFilters,
      includeNoAssignee,
      creatorFilters,
      projectFilters,
      includeNoProject,
      labelFilters,
      propertyFilters,
      dateFilter,
      workingOnly,
      showSubIssues,
    ],
  );

  const openFilter = () => {
    if (!wsSlug) return;
    router.push({
      pathname: "/[workspace]/issues-filter",
      params: { workspace: wsSlug, scope: "all" },
    });
  };

  const createFromColumn = useCreateIssueFromColumn();

  useClearFiltersOnWorkspaceChange(
    useIssuesViewStore.getState().clearFilters,
    wsId,
  );

  // Batch selection is workspace-scoped — drop it when switching workspaces
  // (same hook the my-issues tab uses).
  useClearFiltersOnWorkspaceChange(
    useIssueBatchSelectionStore.getState().exitSelection,
    wsId,
  );

  // Saved views (iteration-65): the workspace-scope container holds this
  // page's views. The bar owns the list query (cached, shared with the bar);
  // applying a view resets the slice to its snapshot + display defaults and
  // remembers which view is active per container (in-memory, like the rest
  // of mobile's view state). `scopeVariant` is the current scope tab in the
  // view-variant vocabulary captured into NEW views (null = All tab).
  const issueScope = useMemo(
    () => ({ scope_type: "workspace" as const }),
    [],
  );
  const scopeVariant = scope === "all" ? null : scope;
  const containerKey = useMemo(
    () => issueViewContainerKey(wsId, issueScope),
    [wsId, issueScope],
  );
  const { data: savedViews = [] } = useQuery({
    ...issueViewListOptions(wsId, issueScope),
  });
  const activeViewId = useActiveIssueViewStore(
    (s) => s.active[containerKey] ?? null,
  );
  const activeView = useMemo(
    () => savedViews.find((v) => v.id === activeViewId) ?? null,
    [savedViews, activeViewId],
  );

  // The chips bar works against the open view's baseline: it shows only the
  // user's additions and a chip's removal falls back to the view's own
  // values (web filter-chips-bar semantics).
  const { baseline: chipBaseline, resetDimension: resetChipDimension } =
    useFilterChipBaseline(activeView?.query ?? null, useIssuesViewStore);
  // Union of the filter dims + display defaults the views save/compare.
  const snapshotSource = useMemo(
    () => ({
      ...filterState,
      sortBy,
      sortDirection,
      grouping,
      showSubIssues,
      tableHierarchy,
      cardProperties,
      cardPropertyIds,
    }),
    [
      filterState,
      sortBy,
      sortDirection,
      grouping,
      showSubIssues,
      tableHierarchy,
      cardProperties,
      cardPropertyIds,
    ],
  );
  const modifiedActive = useMemo(
    () => (activeView ? !viewMatchesSlice(activeView, snapshotSource, view) : false),
    [activeView, snapshotSource, view],
  );
  // Which view this surface last wrote to the store. A pinned view row marks a
  // view active without going through `applyView`, so the surface has to apply
  // it on arrival — the ref is what tells the two cases apart (see
  // `useApplyExternallyActivatedView`).
  const appliedViewIdRef = useRef<string | null>(null);
  const applyView = useCallback(
    (v: IssueView) => {
      appliedViewIdRef.current = v.id;
      applySavedView({
        view: v,
        store: useIssuesViewStore,
        containerKey,
        sortBy,
      });
      // The scope axis a workspace view captured is part of the VIEW (web
      // semantics) — switching to it lands on the right tab, but the
      // user's own tab is exactly where they left it once the view closes.
      setScope(actorKindForViewVariant(v.scope_variant));
    },
    [containerKey, setScope, sortBy],
  );
  useApplyExternallyActivatedView({
    activeViewId,
    activeView,
    appliedViewIdRef,
    onApply: applyView,
  });
  const exitView = useCallback(() => {
    useIssuesViewStore.setState({
      ...defaultIssueFilterSlice(),
      scope: "all",
      view: "list",
    });
    useActiveIssueViewStore.getState().setActive(containerKey, null);
    appliedViewIdRef.current = null;
  }, [containerKey]);

  // Board/swimlane hidden status columns (web `hideStatus`). Derived from the
  // same `statusFilters` the server window uses, so hiding a lane narrows the
  // fetch too — see `useBoardHiddenColumns`.
  const boardHiddenColumns = useBoardHiddenColumns({
    store: useIssuesViewStore,
    statusFilters,
    baseline: chipBaseline,
  });

  // Table quick search (web `controller.tableSearch`). Kept OUT of the view
  // store: it is a property of the table being looked at, not of the view
  // definition, so it must not be captured into a saved view or compared by
  // `viewMatchesSlice`.
  const [tableSearch, setTableSearch] = useState("");
  const debouncedTableSearch = useDebouncedTableSearch(tableSearch);

  // The active window travels as server params → filter/sort changes refetch
  // and the cache is keyed per window (issueKeys.listFiltered). Identity is
  // memoized on the slice values so the query key stays stable.
  //
  // This is the PLAIN window: the grid's own filter/sort dimensions. It stays
  // free of the two narrowing switches below so the chips and counts that read
  // it keep a window that does not move when 智能体工作中` is clicked.
  const window = useMemo(
    () =>
      buildIssueWindow({
        statusFilters: filterState.statusFilters,
        priorityFilters: filterState.priorityFilters,
        assigneeFilters: filterState.assigneeFilters,
        includeNoAssignee: filterState.includeNoAssignee,
        creatorFilters: filterState.creatorFilters,
        projectFilters: filterState.projectFilters,
        includeNoProject: filterState.includeNoProject,
        labelFilters: filterState.labelFilters,
        propertyFilters: filterState.propertyFilters,
        dateFilter: filterState.dateFilter,
        sortBy,
        sortDirection,
        tableSearch: debouncedTableSearch,
      }),
    [filterState, sortBy, sortDirection, debouncedTableSearch],
  );

  // The ROW window — the plain window plus the two dimensions that used to be
  // client-only (MYS-2066). 「智能体工作中」 and 「显示子任务」 off now narrow the
  // SERVER window, so the list answers about the complete result set the way
  // web's does, instead of about whichever 100 rows happened to load. Each is
  // emitted only while active, and `ids` is emitted even when EMPTY — see
  // `lib/issue-row-narrowing.ts` for both rules.
  //
  // The count channels below read the PLAIN window and add their own spelling
  // of the same restriction (`working_issue_ids`, the Table spec's name for
  // it). Keeping the two apart means neither window ever carries both
  // spellings, and a comment cannot drift from which one a channel reads.
  const rowWindow = useMemo(
    () => ({
      ...window,
      ...issueRowNarrowing({ workingOnly, showSubIssues }, runningIssueIds),
    }),
    [window, workingOnly, showSubIssues, runningIssueIds],
  );

  // Group headers count the complete result set (server group descriptors),
  // not just the loaded window. Scope travels as `assignee_types` so the
  // members/agents tabs count what they render.
  //
  // The count window carries the working dimension in the COUNT channel's
  // spelling (`working_issue_ids`): the Table group/facet endpoints name it
  // differently from `GET /api/issues`'s `ids`, and the two transports have
  // separate type contracts. It is the same switch the rows read above, so the
  // two cannot disagree about when the dimension applies (MYS-2017).
  const countWindow = useMemo(
    () =>
      withWorkingCountDimension(
        window,
        countWorkingOnly("all", workingOnly),
        runningIssueIds,
      ),
    [window, workingOnly, runningIssueIds],
  );

  const groupCountQuery = useMemo(
    () => ({
      scope: workspaceIssueTableScope(scope),
      window: countWindow,
      includeSubIssues: showSubIssues,
    }),
    [scope, countWindow, showSubIssues],
  );

  // The header chip's own count, from the surface's `working_agents` facet.
  //
  // A separate request from `groupCountQuery` even though both are Table
  // facets, because the two must not share a query identity: the group counts
  // carry `working_issue_ids` (they answer about the FILTERED rows), while this
  // one strips it. Sharing would re-key the chip's request every time the
  // toggle flipped, and the number would flicker at the exact moment the user
  // clicked the chip it labels (web keeps the same split — see
  // `workingAgentsQuerySpec` in `use-issue-surface-controller.ts:523`).
  //
  // Built from the UNNARROWED window, which is what makes the number stable
  // across the toggle: the server drops the facet's own dimension before
  // counting, so "who would I see if I turned this on" is also the answer while
  // it is on.
  const workingAgentsQuery = useMemo(
    () => ({
      scope: workspaceIssueTableScope(scope),
      window,
      includeSubIssues: showSubIssues,
    }),
    [scope, window, showSubIssues],
  );
  const { data: headerWorkingAgents } = useQuery(
    workingAgentsFacetOptions(wsId, workingAgentsQuery),
  );

  // Paginated window. `GET /api/issues` clamps limit to 100 server-side, so a
  // one-shot fetch used to drop every issue past row 100 with no hint; the
  // list view now scrolls the window and the aggregate views drain it (below).
  const listQuery = useInfiniteQuery(issueListOptions(wsId, rowWindow));
  const {
    data: listData,
    isLoading,
    error,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    isError,
  } = listQuery;

  // `error` stays populated on a failed *refetch* even though rows are on
  // screen; only a load with no data at all should take over the surface.
  const listLoadError = isError && !listData;
  const listIssues = useMemo(() => readIssueRows(listData), [listData]);
  const listTotal = issueListTotal(listData?.pages ?? []);

  // Gantt canvas data — paged scheduled-issue fetch. The regular list is
  // capped at 100 rows server-side (GET /api/issues), which would silently
  // drop scheduled issues past page 1 on busy workspaces. While the gantt
  // view is active we switch the surface's data source to this dedicated
  // fetch (mirrors web's `usesGantt` switch in use-issue-surface-data.ts);
  // every other view keeps the regular list. Scope (all/members/agents)
  // stays a client-side pre-filter below, exactly as it is for the list.
  const ganttActive = view === "gantt";
  const {
    data: ganttIssues,
    isLoading: ganttLoading,
    error: ganttError,
    refetch: refetchGantt,
    isRefetching: ganttRefetching,
  } = useQuery(ganttIssuesOptions(wsId, ganttActive));

  // Loading/error/refresh follow the ACTIVE source so a first gantt load
  // shows a spinner instead of a stale "no scheduled issues" empty state.
  const surfaceData = useMemo(
    () => (ganttActive ? ganttIssues ?? [] : listIssues),
    [ganttActive, ganttIssues, listIssues],
  );
  const surfaceLoading = ganttActive ? ganttLoading : isLoading;
  const surfaceError = ganttActive ? ganttError : listLoadError ? error : null;
  const surfaceRefetch = ganttActive ? refetchGantt : refetch;
  const surfaceRefetching = ganttActive ? ganttRefetching : isRefetching;

  // Board / swimlane / table group the window client-side, so a partially
  // loaded window silently under-reports them — drain the remaining pages
  // while one of those views is on screen. The linear list view does NOT
  // drain: it has a real end-of-scroll sentinel instead.
  useDrainIssuePages({
    enabled: !ganttActive && view !== "list",
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    loadedRows: listIssues.length,
    fetchNextPage,
  });

  // Scope pre-filter — mirrors web `issues-page.tsx:90-94`. Applied before
  // other filtering so chip filters operate on the visible slice.
  const scopedIssues = useMemo(() => {
    const allIssues = surfaceData;
    if (scope === "members") {
      return allIssues.filter((i) => i.assignee_type === "member");
    }
    if (scope === "agents") {
      return allIssues.filter(
        (i) => i.assignee_type === "agent" || i.assignee_type === "squad",
      );
    }
    return allIssues;
  }, [surfaceData, scope]);

  // Client predicate — the same filters the server window applied, re-run
  // so rows that drifted out of the window via WS patches drop at render.
  const filtered = useMemo(
    () => applyIssueFilters(scopedIssues, filterState, { runningIssueIds }),
    [scopedIssues, filterState, runningIssueIds],
  );

  const sorted = useMemo(
    () => sortIssues(filtered, sortBy, sortDirection),
    [filtered, sortBy, sortDirection],
  );

  const sections = useMemo<IssueSection[]>(() => {
    const groups = groupIssues(sorted, grouping, BOARD_STATUSES);
    return groups.map((g) => {
      if (grouping === "status" && g.status) {
        return { key: g.key, status: g.status, data: g.data };
      }
      // Assignee grouping lane.
      if (g.unassigned) {
        return { key: g.key, unassigned: true, data: g.data };
      }
      return {
        key: g.key,
        assigneeType: g.assigneeType,
        assigneeId: g.assigneeId,
        data: g.data,
      };
    });
  }, [sorted, grouping]);

  // Fold state is per device, per workspace, and keyed by SECTION key —
  // mobile's list groups by status, by assignee and by select property, so
  // web's `IssueStatus[]` shape would collide across groupings (see
  // `data/stores/issue-workbench-layout-store.ts`).
  const { sections: visibleSections, collapsed, toggle } =
    useListSectionFolding(wsId, sections);

  // Whether the empty state should say "no matches under your filters"
  // instead of "nothing here for this scope" — i.e. whether any dimension
  // the user turned on is narrowing the list. Delegates to the shared
  // selector so a newly added dimension (workingOnly, iteration-127) cannot
  // leave this page claiming the scope is empty while a filter is silently
  // on.
  const hasActiveFilterChips = useMemo(
    () => hasActiveIssueFilters(filterState),
    [filterState],
  );

  // The gantt view owns its own empty state (the scheduled projection can't
  // prove the window is empty — web never asserts surface-empty in gantt).
  // The table owns its own empty state, and that state carries the SEARCH BOX
  // — it has to, or a search matching nothing would leave the query in the
  // window with no visible way to clear it (verified on-device: the surface
  // empty state swallowed the toolbar and the screen became a dead end).
  const showEmptyState =
    !surfaceLoading &&
    !surfaceError &&
    !ganttActive &&
    view !== "table" &&
    sorted.length === 0;

  return (
    <View className="flex-1 bg-background">
      <IssueSurfaceScopeToolbar
        scopes={SCOPES}
        scope={scope}
        onChange={(v) => setScope(v)}
        onOpenFilter={openFilter}
        hasActiveFilters={hasActiveFilterChips}
        view={view}
        onViewChange={setView}
        t={t}
      />
      {/* The agents-working toggle, on its own row under the toolbar — see
          `IssueSurfaceAgentActivityRow` for why it is not seated in the
          toolbar itself. Its count comes from the surface's own
          `working_agents` facet, so it says how many agents are working inside
          the rows THIS scope + filter set would show, not the workspace. */}
      <IssueSurfaceAgentActivityRow
        value={workingOnly}
        onToggle={() => useIssuesViewStore.getState().toggleWorkingOnly()}
        agents={headerWorkingAgents}
      />
      <IssueViewBar
        wsId={wsId}
        scope={issueScope}
        scopeVariant={scopeVariant}
        slice={snapshotSource}
        viewMode={view}
        activeViewId={activeViewId}
        modifiedActive={modifiedActive}
        onApplyView={applyView}
        onExitView={exitView}
      />
      {hasActiveFilterChips ? (
        <ActiveFilterChips
          filterState={filterState}
          baseline={chipBaseline}
          onResetDimension={resetChipDimension}
          onClearStatus={(s) =>
            useIssuesViewStore.getState().toggleStatusFilter(s)
          }
          onClearPriority={(p) =>
            useIssuesViewStore.getState().togglePriorityFilter(p)
          }
          onClearAssignee={(v) =>
            useIssuesViewStore.getState().toggleAssigneeFilter(v)
          }
          onClearCreator={(v) =>
            useIssuesViewStore.getState().toggleCreatorFilter(v)
          }
          onClearProject={(id) =>
            useIssuesViewStore.getState().toggleProjectFilter(id)
          }
          onClearLabel={(id) =>
            useIssuesViewStore.getState().toggleLabelFilter(id)
          }
          onClearNoAssignee={() =>
            useIssuesViewStore.getState().toggleNoAssignee()
          }
          onClearNoProject={() =>
            useIssuesViewStore.getState().toggleNoProject()
          }
          onClearProperty={(id) =>
            useIssuesViewStore.getState().clearPropertyFilter(id)
          }
          onClearDate={() =>
            useIssuesViewStore.getState().setDateFilter(null)
          }
        />
      ) : null}
      {surfaceLoading ? (
        <IssuesLoading />
      ) : surfaceError ? (
        <View className="px-4 gap-3 pt-4">
          <Text className="text-body text-destructive">
            {t("issues.loadError")}
            {surfaceError instanceof Error
              ? surfaceError.message
              : t("common.unknownError")}
          </Text>
          <Button variant="outline" onPress={() => surfaceRefetch()}>
            <Text>{t("workspace.retry")}</Text>
          </Button>
        </View>
      ) : showEmptyState ? (
        <SurfaceEmptyState
          message={
            hasActiveFilterChips
              ? t("issues.filterEmpty")
              : emptyMessageForScope(scope, t)
          }
        />
      ) : view === "board" ? (
        <BoardView
          cardProperties={cardProperties}
          cardPropertyIds={cardPropertyIds}
          issues={sorted}
          grouping={grouping}
          groupingProperty={groupingProperty}
          statusOrder={BOARD_STATUSES}
          onOpenIssue={(issue) => {
            if (wsSlug) router.push(`/${wsSlug}/issue/${issue.id}`);
          }}
          onCreateIssue={createFromColumn}
          emptyLabel={
            hasActiveFilterChips
              ? t("issues.filterEmpty")
              : emptyMessageForScope(scope, t)
          }
          hiddenStatuses={boardHiddenColumns.hiddenStatuses}
          onHideStatus={boardHiddenColumns.hideStatus}
          onShowStatus={boardHiddenColumns.showStatus}
          isStatusFixed={boardHiddenColumns.isStatusFixed}
          allStatusesHidden={boardHiddenColumns.allStatusesHidden}
          sortBy={sortBy}
          sortDirection={sortDirection}
        />
      ) : view === "table" ? (
        <IssueTableView
          issues={sorted}
          columns={tableColumns}
          onToggleColumn={toggleTableColumn}
          columnWidths={tableColumnWidths}
          onResizeColumn={setTableColumnWidth}
          onReorderColumn={reorderTableColumn}
          onResetColumns={resetTableColumns}
          onCreateSubIssue={createSubIssue}
          grouping={tableGrouping}
          onGroupingChange={setTableGrouping}
          groupCountQuery={groupCountQuery}
          hierarchy={tableHierarchy}
          sortBy={sortBy}
          sortDirection={sortDirection}
          onSort={(field, direction) => {
            useIssuesViewStore.getState().setSortBy(field);
            useIssuesViewStore.getState().setSortDirection(direction);
          }}
          onOpenIssue={(issue) => {
            if (wsSlug) router.push(`/${wsSlug}/issue/${issue.id}`);
          }}
          emptyLabel={
            hasActiveFilterChips
              ? t("issues.filterEmpty")
              : emptyMessageForScope(scope, t)
          }
          search={tableSearch}
          onSearchChange={setTableSearch}
          exportWindow={{
            hasNextPage,
            isFetchNextPageError,
            loadedRows: listIssues.length,
          }}
        />
      ) : view === "gantt" ? (
        <GanttView
          issues={sorted}
          sortBy={sortBy}
          sortDirection={sortDirection}
          onOpenIssue={(issue) => {
            if (wsSlug) router.push(`/${wsSlug}/issue/${issue.id}`);
          }}
          emptyLabel={
            hasActiveFilterChips
              ? t("issues.filterEmpty")
              : t("issues.gantt.empty")
          }
        />
      ) : view === "swimlane" ? (
        <SwimlaneView
          cardProperties={cardProperties}
          cardPropertyIds={cardPropertyIds}
          issues={sorted}
          grouping={swimlaneGrouping}
          onGroupingChange={(next) =>
            useIssuesViewStore.getState().setSwimlaneGrouping(next)
          }
          statusOrder={BOARD_STATUSES}
          onOpenIssue={(issue) => {
            if (wsSlug) router.push(`/${wsSlug}/issue/${issue.id}`);
          }}
          emptyLabel={
            hasActiveFilterChips
              ? t("issues.filterEmpty")
              : emptyMessageForScope(scope, t)
          }
          hiddenStatuses={boardHiddenColumns.hiddenStatuses}
          onShowStatus={boardHiddenColumns.showStatus}
        />
      ) : (
        <SectionList
          sections={visibleSections}
          keyExtractor={(item) => item.id}
          stickySectionHeadersEnabled={false}
          ItemSeparatorComponent={() => (
            <View className="h-px bg-border ml-4" />
          )}
          renderSectionHeader={({ section }) => (
            <IssueSectionHeader
              section={section}
              collapsed={collapsed.has(section.key)}
              onToggle={() => toggle(section.key)}
            />
          )}
          contentContainerClassName={
            batchSelectionMode ? "pb-48" : "pb-6"
          }
          renderItem={({ item }) => (
            <IssueSelectionRow
              issue={item}
              onOpen={() => {
                if (wsSlug) router.push(`/${wsSlug}/issue/${item.id}`);
              }}
            />
          )}
          ListFooterComponent={
            <IssueListFooter
              hasMore={hasMoreIssues(listData?.pages ?? [])}
              isLoadingMore={isFetchingNextPage}
              total={listTotal}
              isError={isFetchNextPageError}
              onRetry={() => void fetchNextPage()}
            />
          }
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) {
              void fetchNextPage();
            }
          }}
          refreshing={surfaceRefetching}
          onRefresh={surfaceRefetch}
        />
      )}

      {view !== "board" && sorted.length > 0 ? (
        <BatchActionBar issues={sorted} />
      ) : null}
    </View>
  );
}


function emptyMessageForScope(
  scope: IssuesScope,
  t: (id: string, params?: Record<string, string | number>) => string,
): string {
  switch (scope) {
    case "all":
      return t("issues.emptyAll");
    case "members":
      return t("issues.emptyMembers");
    case "agents":
      return t("issues.emptyAgents");
  }
}