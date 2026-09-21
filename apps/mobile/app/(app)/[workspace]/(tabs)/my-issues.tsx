/**
 * "My Issues" tab. Three scopes — assigned / created / agents — mirroring
 * web's `packages/views/my-issues/components/my-issues-page.tsx:48-65`. The
 * `agents` scope label is "Agents and Squads" because the backend predicate
 * (`involves_user_id`, MUL-2397) surfaces both the user's owned agents and
 * squads they're involved in (member / leader / has an owned agent inside).
 *
 * Issues are grouped by status using SectionList in `BOARD_STATUSES` order;
 * empty status sections are filtered out so the screen doesn't fill with
 * "(0)" headers. Since iteration 62 grouping can switch to by-assignee
 * (web GROUPING_OPTIONS), filter dimensions extend to assignee / creator /
 * project / label, and the list carries a client sort (web sortIssues).
 *
 * Filter state lives in `useMyIssuesViewStore` and is cleared on workspace
 * change via the shared `useClearFiltersOnWorkspaceChange` hook. The store's
 * filter window travels as server params into `myIssueListOptions`, and the
 * client re-runs `applyIssueFilters` + `sortIssues` as a belt-and-suspenders
 * pass (same as the workspace Issues page).
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { SectionList, View } from "react-native";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useIsFocused } from "@react-navigation/native";
import { router } from "expo-router";
import type { Issue } from "@multica/core/types";
import type { CreateIssueViewRequest, IssueView } from "@multica/core/api/schemas";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/ui/header";
import { HeaderActions } from "@/components/ui/app-header-actions";
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
  IssueSectionHeader,
  IssueSelectionRow,
  IssueSection,
  IssueSurfaceScopeToolbar,
  SurfaceEmptyState,
} from "@/components/issue/issue-surface-chrome";
import {
  buildMyIssuesFilter,
  myIssuesAllOptions,
  myIssueListOptions,
} from "@/data/queries/my-issues";
import { ganttIssuesOptions } from "@/data/queries/issues";
import { useRunningIssueIds } from "@/data/queries/agent-task-snapshot";
import { useCreateIssueFromColumn } from "@/lib/use-create-issue-from-column";
import { readIssueRows } from "@/data/queries/issue-list-cache";
import { hasMoreIssues, issueListTotal } from "@/lib/issue-pagination";
import { useDrainIssuePages } from "@/lib/use-drain-issue-pages";
import { issueViewListOptions } from "@/data/queries/issue-views";
import type { MyIssuesScope } from "@/data/queries/issue-keys";
import { useIssueBatchSelectionStore } from "@/data/stores/issue-batch-selection-store";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useMyIssuesViewStore } from "@/data/stores/my-issues-view-store";
import { useCreateSubIssue } from "@/lib/use-create-sub-issue";
import {
  issueViewContainerKey,
  useActiveIssueViewStore,
} from "@/data/stores/active-issue-view-store";
import {
  viewMatchesSlice,
} from "@/data/stores/issue-view-codec";
import {
  applySavedView,
  myScopeForViewVariant,
  useApplyExternallyActivatedView,
} from "@/lib/saved-view-apply";
import {
  buildIssueWindow,
  defaultIssueFilterSlice,
  hasActiveIssueFilters,
} from "@/data/stores/issue-filter-slice";
import { useClearFiltersOnWorkspaceChange } from "@/lib/use-clear-filters-on-workspace-change";
import { useDebouncedTableSearch } from "@/lib/use-debounced-table-search";
import { useBoardHiddenColumns } from "@/lib/use-board-hidden-columns";
import { myIssueTableScope } from "@/lib/issue-table-group-counts";
import { useGroupingProperty } from "@/lib/use-grouping-property";
import { BOARD_STATUSES } from "@/lib/issue-status-core";
import {
  applyIssueFilters,
  groupIssues,
  sortIssues,
  type IssueFilterState,
} from "@/lib/filter-issues";
import { useTranslation } from "@/lib/i18n/react";

// Mobile pill row has tight width on SE3 (375pt). Four pills + the view
// toggle + Filter icon no longer fit, so the row scrolls horizontally (see
// `IssueSurfaceScopeToolbar`) and no label is abbreviated away. The agents
// scope still renders "Agents" — the full "Agents and Squads" label (~135pt)
// blows past safe limits and breaks under Dynamic Type. Semantics unchanged:
// same backend predicate (`involves_user_id`, MUL-2397) covers owned agents +
// related squads; the empty state copy still says "agents or squads".
// `all` is web's first scope (my-issues-header.tsx:89-94) and carries no
// relation filter — it is the plain workspace issue list.
const SCOPES: { value: MyIssuesScope; labelKey: string }[] = [
  { value: "all", labelKey: "myIssues.scopeAll" },
  { value: "assigned", labelKey: "myIssues.scopeAssigned" },
  { value: "created", labelKey: "myIssues.scopeCreated" },
  { value: "agents", labelKey: "myIssues.scopeAgents" },
];

// Row hairline aligned to the row's left padding (IssueRow uses px-4).
function IssueSeparator() {
  return <View className="h-px bg-border ml-4" />;
}

export default function MyIssues() {
  const isFocused = useIsFocused();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const batchSelectionMode = useIssueBatchSelectionStore((s) => s.selectionMode);
  const { t } = useTranslation();

  const scope = useMyIssuesViewStore((s) => s.scope);
  const setScope = useMyIssuesViewStore((s) => s.setScope);
  const view = useMyIssuesViewStore((s) => s.view);
  const setView = useMyIssuesViewStore((s) => s.setView);
  const swimlaneGrouping = useMyIssuesViewStore((s) => s.swimlaneGrouping);
  const tableColumns = useMyIssuesViewStore((s) => s.tableColumns);
  const toggleTableColumn = useMyIssuesViewStore((s) => s.toggleTableColumn);
  const tableColumnWidths = useMyIssuesViewStore((s) => s.tableColumnWidths);
  const setTableColumnWidth = useMyIssuesViewStore((s) => s.setTableColumnWidth);
  const reorderTableColumn = useMyIssuesViewStore((s) => s.reorderTableColumn);
  const resetTableColumns = useMyIssuesViewStore((s) => s.resetTableColumns);
  const createSubIssue = useCreateSubIssue();
  const tableGrouping = useMyIssuesViewStore((s) => s.tableGrouping);
  const setTableGrouping = useMyIssuesViewStore((s) => s.setTableGrouping);
  const grouping = useMyIssuesViewStore((s) => s.grouping);
  const groupingProperty = useGroupingProperty(grouping);
  const sortBy = useMyIssuesViewStore((s) => s.sortBy);
  const sortDirection = useMyIssuesViewStore((s) => s.sortDirection);
  const statusFilters = useMyIssuesViewStore((s) => s.statusFilters);
  const priorityFilters = useMyIssuesViewStore((s) => s.priorityFilters);
  const assigneeFilters = useMyIssuesViewStore((s) => s.assigneeFilters);
  const includeNoAssignee = useMyIssuesViewStore((s) => s.includeNoAssignee);
  const creatorFilters = useMyIssuesViewStore((s) => s.creatorFilters);
  const projectFilters = useMyIssuesViewStore((s) => s.projectFilters);
  const includeNoProject = useMyIssuesViewStore((s) => s.includeNoProject);
  const labelFilters = useMyIssuesViewStore((s) => s.labelFilters);
  const propertyFilters = useMyIssuesViewStore((s) => s.propertyFilters);
  const dateFilter = useMyIssuesViewStore((s) => s.dateFilter);
  const workingOnly = useMyIssuesViewStore((s) => s.workingOnly);
  const showSubIssues = useMyIssuesViewStore((s) => s.showSubIssues);
  // Running-agent projection for the working-only filter. `undefined` while
  // the snapshot loads — the predicate fails closed on it, which is the
  // intended "only what is provably working" read.
  const runningIssueIds = useRunningIssueIds();
  // Stable dedup feeding applyIssueFilters — each field is its own
  // subscription above.
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
      params: { workspace: wsSlug, scope: "my" },
    });
  };

  const createFromColumn = useCreateIssueFromColumn();

  useClearFiltersOnWorkspaceChange(
    useMyIssuesViewStore.getState().clearFilters,
    wsId,
  );

  // Batch selection is workspace-scoped — drop it when switching workspaces.
  useClearFiltersOnWorkspaceChange(
    useIssueBatchSelectionStore.getState().exitSelection,
    wsId,
  );

  // Saved views (iteration-65): the my-scope container holds this page's
  // views. My scopes map to the view-variant vocabulary (assigned/created/
  // involved — mobile "agents" ≈ web "involved"; "all" ≈ web "any");
  // applying a view resets the slice + display defaults and lands on the
  // scope axis the view captured.
  const myScope = useMemo(() => ({ scope_type: "my" as const }), []);
  const scopeVariant = useMemo<CreateIssueViewRequest["scope_variant"]>(
    () =>
      scope === "all"
        ? "any"
        : scope === "assigned"
          ? "assigned"
          : scope === "created"
            ? "created"
            : scope === "agents"
              ? "involved"
              : null,
    [scope],
  );
  const containerKey = useMemo(
    () => issueViewContainerKey(wsId, myScope),
    [wsId, myScope],
  );
  const { data: savedViews = [] } = useQuery({
    ...issueViewListOptions(wsId, myScope),
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
    useFilterChipBaseline(activeView?.query ?? null, useMyIssuesViewStore);
  const snapshotSource = useMemo(
    () => ({ ...filterState, sortBy, sortDirection, grouping, showSubIssues }),
    [filterState, sortBy, sortDirection, grouping, showSubIssues],
  );
  const modifiedActive = useMemo(
    () => (activeView ? !viewMatchesSlice(activeView, snapshotSource, view) : false),
    [activeView, snapshotSource, view],
  );
  // Which view this surface last wrote to the store. A pinned view row marks a
  // view active without going through `applyView`, so the surface has to apply
  // it on arrival (see `useApplyExternallyActivatedView`).
  const appliedViewIdRef = useRef<string | null>(null);
  const applyView = useCallback(
    (v: IssueView) => {
      appliedViewIdRef.current = v.id;
      applySavedView({
        view: v,
        store: useMyIssuesViewStore,
        containerKey,
        sortBy,
      });
      // The scope axis a my-view captured is part of the VIEW — landing on
      // the right tab, while the user's own tab stays untouched once the
      // view closes. An unknown/absent variant means "all" (core
      // issues/surface/scope.ts:47).
      setScope(myScopeForViewVariant(v.scope_variant));
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
    useMyIssuesViewStore.setState({
      ...defaultIssueFilterSlice(),
      scope: "assigned",
      view: "list",
    });
    useActiveIssueViewStore.getState().setActive(containerKey, null);
    appliedViewIdRef.current = null;
  }, [containerKey]);

  // `all` is the workspace-wide list, so it needs no user id; every other
  // scope keys off one. The empty-string assignee is the deliberate
  // "nothing can match" placeholder while the session's user is still
  // resolving — the query is disabled in that window anyway.
  const filter = useMemo(
    () =>
      scope === "all"
        ? {}
        : userId
          ? buildMyIssuesFilter(scope, userId)
          : { assignee_id: "" },
    [scope, userId],
  );

  // Board/swimlane hidden status columns — see the workspace surface.
  const boardHiddenColumns = useBoardHiddenColumns({
    store: useMyIssuesViewStore,
    statusFilters,
    baseline: chipBaseline,
  });

  // Table quick search — see the workspace surface for why it stays out of
  // the view store.
  const [tableSearch, setTableSearch] = useState("");
  const debouncedTableSearch = useDebouncedTableSearch(tableSearch);

  // Server window (scope filter from `filter`, grid dimensions from the
  // shared slice mapped through buildIssueWindow).
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

  // Group headers count the complete result set (server group descriptors),
  // not just the loaded window. The `all` tab is one union query server-side,
  // unlike the list API's scatter-gather.
  const groupCountQuery = useMemo(
    () => ({
      scope: myIssueTableScope(scope),
      window,
      includeSubIssues: showSubIssues,
    }),
    [scope, window, showSubIssues],
  );

  // Paginated window — see the workspace Issues screen for the rationale
  // (`GET /api/issues` clamps limit to 100 server-side). The list view
  // infinite-scrolls; board / swimlane / table drain the window instead.
  //
  // `all` is the union of the three legs, which the list API cannot express
  // in one request — it uses the scatter-gather options instead. Every other
  // scope is a single relation param.
  const listQuery = useInfiniteQuery({
    ...(scope === "all"
      ? myIssuesAllOptions(wsId, userId, window)
      : myIssueListOptions(wsId, scope, filter, window)),
    // Every scope keys off the session user, `all` included — its three legs
    // are all "…= me" predicates.
    enabled: !!wsId && !!userId,
  });
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
  const listLoadError = isError && !listData;
  const listIssues = useMemo(() => readIssueRows(listData), [listData]);
  const listTotal = issueListTotal(listData?.pages ?? []);

  // Gantt canvas data — paged scheduled-issue fetch. The regular list is
  // capped at 100 rows server-side (GET /api/issues), which would silently
  // drop scheduled issues past page 1 on busy workspaces. While the gantt
  // view is active we switch the surface's data source to this dedicated
  // fetch (mirrors web's `usesGantt` switch in use-issue-surface-data.ts);
  // every other view keeps the regular list. The scope filter rides along so
  // the canvas honours assigned / created / agents like the list does.
  const ganttActive = view === "gantt";
  const {
    data: ganttIssues,
    isLoading: ganttLoading,
    error: ganttError,
    refetch: refetchGantt,
    isRefetching: ganttRefetching,
  } = useQuery(
    ganttIssuesOptions(wsId, ganttActive && (scope === "all" || !!userId), filter),
  );

  // Loading/error/refresh follow the ACTIVE source so a first gantt load
  // shows a spinner instead of a stale "no scheduled issues" empty state.
  const surfaceData = useMemo(
    () => (ganttActive ? ganttIssues ?? [] : listIssues),
    [ganttActive, ganttIssues, listIssues],
  );
  const surfaceLoading = ganttActive ? ganttLoading : isLoading;
  const surfaceError = ganttActive ? ganttError : listLoadError ? error : null;
  const surfaceRefetch = ganttActive ? refetchGantt : refetch;

  // Board / swimlane / table group the window client-side, so a partially
  // loaded window under-reports them — drain the rest while one is on screen.
  useDrainIssuePages({
    enabled: !ganttActive && view !== "list",
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    loadedRows: listIssues.length,
    fetchNextPage,
  });
  const surfaceRefetching = ganttActive ? ganttRefetching : isRefetching;

  // Client predicate — same window re-applied so WS-patched rows that fell
  // out of it drop at render time (mirrors the workspace Issues page).
  const filtered = useMemo(
    () => applyIssueFilters(surfaceData, filterState, { runningIssueIds }),
    [surfaceData, filterState, runningIssueIds],
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

  // Stable nav callback shared by every issue container (board / table /
  // list rows). BoardColumn + cells are memoized, so an inline arrow here
  // would defeat the memo and re-render the whole board on unrelated
  // updates (e.g. a filter-chip toggle) — the reference must stay put.
  const openIssue = useCallback(
    (issue: Issue) => {
      if (wsSlug) router.push(`/${wsSlug}/issue/${issue.id}`);
    },
    [wsSlug],
  );

  return (
    <View className="flex-1 bg-background">
      <Header title={t("myIssues.title")} right={<HeaderActions />} />
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
      <IssueViewBar
        wsId={wsId}
        scope={myScope}
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
            useMyIssuesViewStore.getState().toggleStatusFilter(s)
          }
          onClearPriority={(p) =>
            useMyIssuesViewStore.getState().togglePriorityFilter(p)
          }
          onClearAssignee={(v) =>
            useMyIssuesViewStore.getState().toggleAssigneeFilter(v)
          }
          onClearCreator={(v) =>
            useMyIssuesViewStore.getState().toggleCreatorFilter(v)
          }
          onClearProject={(id) =>
            useMyIssuesViewStore.getState().toggleProjectFilter(id)
          }
          onClearLabel={(id) =>
            useMyIssuesViewStore.getState().toggleLabelFilter(id)
          }
          onClearNoAssignee={() =>
            useMyIssuesViewStore.getState().toggleNoAssignee()
          }
          onClearNoProject={() =>
            useMyIssuesViewStore.getState().toggleNoProject()
          }
          onClearProperty={(id) =>
            useMyIssuesViewStore.getState().clearPropertyFilter(id)
          }
          onClearDate={() =>
            useMyIssuesViewStore.getState().setDateFilter(null)
          }
        />
      ) : null}
      {surfaceLoading ? (
        <IssuesLoading />
      ) : surfaceError ? (
        <View className="px-4 gap-3 pt-4">
          <Text className="text-sm text-destructive">
            {t("myIssues.loadError")}
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
              ? t("myIssues.filterEmpty")
              : emptyMessageForScope(scope, t)
          }
        />
      ) : view === "board" ? (
        <BoardView
          issues={sorted}
          grouping={grouping}
          groupingProperty={groupingProperty}
          statusOrder={BOARD_STATUSES}
          onOpenIssue={openIssue}
          onCreateIssue={createFromColumn}
          emptyLabel={
            hasActiveFilterChips
              ? t("myIssues.filterEmpty")
              : emptyMessageForScope(scope, t)
          }
          hiddenStatuses={boardHiddenColumns.hiddenStatuses}
          onHideStatus={boardHiddenColumns.hideStatus}
          onShowStatus={boardHiddenColumns.showStatus}
          isStatusFixed={boardHiddenColumns.isStatusFixed}
          allStatusesHidden={boardHiddenColumns.allStatusesHidden}
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
          sortBy={sortBy}
          sortDirection={sortDirection}
          onSort={(field, direction) => {
            useMyIssuesViewStore.getState().setSortBy(field);
            useMyIssuesViewStore.getState().setSortDirection(direction);
          }}
          onOpenIssue={openIssue}
          emptyLabel={
            hasActiveFilterChips
              ? t("myIssues.filterEmpty")
              : emptyMessageForScope(scope, t)
          }
          search={tableSearch}
          onSearchChange={setTableSearch}
        />
      ) : view === "gantt" ? (
        <GanttView
          issues={sorted}
          sortBy={sortBy}
          sortDirection={sortDirection}
          onOpenIssue={openIssue}
          emptyLabel={
            hasActiveFilterChips
              ? t("myIssues.filterEmpty")
              : t("issues.gantt.empty")
          }
        />
      ) : view === "swimlane" ? (
        <SwimlaneView
          issues={sorted}
          grouping={swimlaneGrouping}
          onGroupingChange={(next) =>
            useMyIssuesViewStore.getState().setSwimlaneGrouping(next)
          }
          statusOrder={BOARD_STATUSES}
          onOpenIssue={openIssue}
          emptyLabel={
            hasActiveFilterChips
              ? t("myIssues.filterEmpty")
              : emptyMessageForScope(scope, t)
          }
          hiddenStatuses={boardHiddenColumns.hiddenStatuses}
          onShowStatus={boardHiddenColumns.showStatus}
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          stickySectionHeadersEnabled={false}
          ItemSeparatorComponent={IssueSeparator}
          initialNumToRender={14}
          windowSize={9}
          maxToRenderPerBatch={10}
          updateCellsBatchingPeriod={40}
          renderSectionHeader={({ section }) => (
            <IssueSectionHeader section={section} />
          )}
          contentContainerClassName={
            batchSelectionMode ? "pb-48" : "pb-6"
          }
          renderItem={({ item }) => (
            <IssueSelectionRow
              issue={item}
              onOpen={() => openIssue(item)}
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
          refreshing={isFocused && surfaceRefetching}
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
  scope: MyIssuesScope,
  t: (id: string, params?: Record<string, string | number>) => string,
): string {
  switch (scope) {
    case "all":
      return t("myIssues.emptyAll");
    case "assigned":
      return t("myIssues.emptyAssigned");
    case "created":
      return t("myIssues.emptyCreated");
    case "agents":
      return t("myIssues.emptyAgents");
  }
}