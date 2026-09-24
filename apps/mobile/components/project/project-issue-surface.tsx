/**
 * Project-scoped issue workbench (iteration-68) — the project detail page's
 * full IssueSurface, replacing the read-only `ProjectRelatedIssues` list.
 *
 * Composes the same building blocks the workspace-wide Issues page and My
 * Issues use, scoped to one project:
 *
 *   - scope tabs all / members / agents (mirrors web's project-page issue
 *     tabs, `issues-scope-store` keyed `project:<id>`) — a CLIENT-side
 *     filter on `assignee_type` like the workspace Issues page
 *   - `IssueViewBar` with the project view container
 *     `{ scope_type: "project", scope_id }` (saved views + view-bar
 *     preferences persist per project — web save-view-dialog.tsx:573-575)
 *   - list/board toggle, filter sheet (`scope=project`), sort, grouping —
 *     all through `useProjectIssuesViewStore`, which is isolated from the
 *     workspace/my stores
 *   - batch multi-select via the same `batch-action-bar` the other
 *     surfaces use
 *
 * Data source is `projectIssuesOptions` (issues pre-fetched by project_id,
 * living under the issues cache prefix); filters/sort/grouping re-run
 * client-side, so WS-patched rows that drift out of the active window drop
 * at render-time like the other surfaces.
 *
 * The page passes its detail meta (header card / properties / resources) as
 * `header`: in list mode it renders as the SectionList's ListHeaderComponent
 * (scrolls away with the content, matching the page's previous
 * everything-in-one-scroll UX), in board mode it stays pinned above the
 * board. Pull-to-refresh refreshes issues and meta together.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { ScrollView, SectionList, View } from "react-native";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import type { CreateIssueViewRequest, IssueView } from "@multica/core/api/schemas";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
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
  IssueSurfaceScopeToolbar,
  SurfaceEmptyState,
} from "@/components/issue/issue-surface-chrome";
import { projectIssuesOptions } from "@/data/queries/projects";
import { readIssueRows } from "@/data/queries/issue-list-cache";
import { hasMoreIssues, issueListTotal } from "@/lib/issue-pagination";
import { useDrainIssuePages } from "@/lib/use-drain-issue-pages";
import { issueViewListOptions } from "@/data/queries/issue-views";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useProjectIssuesViewStore } from "@/data/stores/project-issues-view-store";
import { useCreateSubIssue } from "@/lib/use-create-sub-issue";
import { useBoardHiddenColumns } from "@/lib/use-board-hidden-columns";
import { useDebouncedTableSearch } from "@/lib/use-debounced-table-search";
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
} from "@/data/stores/issue-filter-slice";
import { assigneeTypesForScopeTab } from "@/lib/issue-table-group-counts";
import { useClearFiltersOnWorkspaceChange } from "@/lib/use-clear-filters-on-workspace-change";
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
import type { IssuesScope } from "@/data/stores/issues-view-store";

// Scope tab definitions — mirrors web's project-page issue tabs
// (`issues-scope-store` keyed `project:<id>`), same vocabulary as the
// workspace-wide Issues page.
const SCOPES: { value: IssuesScope; labelKey: string }[] = [
  { value: "all", labelKey: "issues.scopeAll" },
  { value: "members", labelKey: "issues.scopeMembers" },
  { value: "agents", labelKey: "issues.scopeAgents" },
];

interface Props {
  projectId: string;
  /** Detail meta rendered as the list header (scrolls with content in list
   *  mode, pinned above the board in board mode). */
  header?: React.ReactElement;
  /** Extra refresh work the owning page runs alongside the issues refetch
   *  (detail refetch / cache invalidations). */
  onRefreshMeta?: () => void | Promise<void>;
  refreshingMeta?: boolean;
}

export function ProjectIssueSurface({
  projectId,
  header,
  onRefreshMeta,
  refreshingMeta = false,
}: Props) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const batchSelectionMode = useIssueBatchSelectionStore((s) => s.selectionMode);
  const { t } = useTranslation();

  const scope = useProjectIssuesViewStore((s) => s.scope);
  const setScope = useProjectIssuesViewStore((s) => s.setScope);
  const view = useProjectIssuesViewStore((s) => s.view);
  const setView = useProjectIssuesViewStore((s) => s.setView);
  const swimlaneGrouping = useProjectIssuesViewStore((s) => s.swimlaneGrouping);
  const tableColumns = useProjectIssuesViewStore((s) => s.tableColumns);
  const toggleTableColumn = useProjectIssuesViewStore((s) => s.toggleTableColumn);
  const tableColumnWidths = useProjectIssuesViewStore((s) => s.tableColumnWidths);
  const setTableColumnWidth = useProjectIssuesViewStore((s) => s.setTableColumnWidth);
  const reorderTableColumn = useProjectIssuesViewStore((s) => s.reorderTableColumn);
  const resetTableColumns = useProjectIssuesViewStore((s) => s.resetTableColumns);
  const createSubIssue = useCreateSubIssue();
  const tableGrouping = useProjectIssuesViewStore((s) => s.tableGrouping);
  const setTableGrouping = useProjectIssuesViewStore((s) => s.setTableGrouping);
  const grouping = useProjectIssuesViewStore((s) => s.grouping);
  const showSubIssues = useProjectIssuesViewStore((s) => s.showSubIssues);
  const groupingProperty = useGroupingProperty(grouping);
  const sortBy = useProjectIssuesViewStore((s) => s.sortBy);
  const sortDirection = useProjectIssuesViewStore((s) => s.sortDirection);
  const statusFilters = useProjectIssuesViewStore((s) => s.statusFilters);
  const priorityFilters = useProjectIssuesViewStore((s) => s.priorityFilters);
  const assigneeFilters = useProjectIssuesViewStore((s) => s.assigneeFilters);
  const includeNoAssignee = useProjectIssuesViewStore((s) => s.includeNoAssignee);
  const creatorFilters = useProjectIssuesViewStore((s) => s.creatorFilters);
  const projectFilters = useProjectIssuesViewStore((s) => s.projectFilters);
  const includeNoProject = useProjectIssuesViewStore((s) => s.includeNoProject);
  const labelFilters = useProjectIssuesViewStore((s) => s.labelFilters);
  const propertyFilters = useProjectIssuesViewStore((s) => s.propertyFilters);
  const dateFilter = useProjectIssuesViewStore((s) => s.dateFilter);
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
      // `workingOnly` is wired on the two workspace-wide surfaces only. Web's
      // project surface renders the project IssuesSurface with no
      // `agentRunningFilter` (use-issue-surface-data.ts:396 vs :345), and
      // mobile's project store does not expose the toggle — so this literal
      // carries the switch off rather than reading a store field that can
      // never be set here.
      workingOnly: false,
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
      showSubIssues,
    ],
  );

  // Group headers count the complete result set (server group descriptors),
  // not just the loaded window. This surface's list query is unfiltered
  // server-side, so the spec carries the window the client applies itself.
  // Table quick search — same contract as the workspace/my-issues surfaces.
  const [tableSearch, setTableSearch] = useState("");
  const debouncedTableSearch = useDebouncedTableSearch(tableSearch);

  const groupCountQuery = useMemo(() => {
    const assigneeTypes = assigneeTypesForScopeTab(scope);
    return {
      scope: {
        kind: "project" as const,
        project_id: projectId,
        ...(assigneeTypes ? { assignee_types: assigneeTypes } : {}),
      },
      window: buildIssueWindow({
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
        sortBy,
        sortDirection,
        tableSearch: debouncedTableSearch,
      }),
      includeSubIssues: showSubIssues,
    };
  }, [
    projectId,
    scope,
    debouncedTableSearch,
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
    sortBy,
    sortDirection,
    showSubIssues,
  ]);

  const openFilter = () => {
    if (!wsSlug) return;
    router.push({
      pathname: "/[workspace]/issues-filter",
      params: { workspace: wsSlug, scope: "project" },
    });
  };

  // Filter + batch-selection state is workspace-scoped — drop it when
  // switching workspaces (same hooks the two other surfaces use).
  useClearFiltersOnWorkspaceChange(
    useProjectIssuesViewStore.getState().clearFilters,
    wsId,
  );
  useClearFiltersOnWorkspaceChange(
    useIssueBatchSelectionStore.getState().exitSelection,
    wsId,
  );

  // Saved views (iteration-68): the project container holds this surface's
  // views, keyed { scope_type: "project", scope_id }. Scope tabs map to
  // the view-variant vocabulary (members/agents; "all" → null, matching
  // web save-view-dialog scope_variant mapping).
  const projectScope = useMemo(
    () => ({ scope_type: "project" as const, scope_id: projectId }),
    [projectId],
  );
  const scopeVariant = useMemo<CreateIssueViewRequest["scope_variant"]>(
    () => (scope === "all" ? null : scope),
    [scope],
  );
  const containerKey = useMemo(
    () => issueViewContainerKey(wsId, projectScope),
    [wsId, projectScope],
  );
  const { data: savedViews = [] } = useQuery({
    ...issueViewListOptions(wsId, projectScope),
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
    useFilterChipBaseline(activeView?.query ?? null, useProjectIssuesViewStore);
  const snapshotSource = useMemo(
    () => ({ ...filterState, sortBy, sortDirection, grouping, showSubIssues }),
    [filterState, sortBy, sortDirection, grouping, showSubIssues],
  );
  const modifiedActive = useMemo(
    () =>
      activeView
        ? !viewMatchesSlice(activeView, snapshotSource, view)
        : false,
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
        store: useProjectIssuesViewStore,
        containerKey,
        sortBy,
      });
      // The scope-axis a project view captured is part of the VIEW — land
      // on the right tab, while the user's own tab is untouched once the
      // view closes (same semantics as the workspace surface).
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
  // Board/swimlane hidden status columns — see the workspace Issues surface.
  const boardHiddenColumns = useBoardHiddenColumns({
    store: useProjectIssuesViewStore,
    statusFilters,
    baseline: chipBaseline,
  });

  const exitView = useCallback(() => {
    useProjectIssuesViewStore.setState({
      ...defaultIssueFilterSlice(),
      scope: "all",
      view: "list",
    });
    useActiveIssueViewStore.getState().setActive(containerKey, null);
    appliedViewIdRef.current = null;
  }, [containerKey]);

  const listQuery = useInfiniteQuery(projectIssuesOptions(wsId, projectId));
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

  // Scope pre-filter — mirrors web issues-page.tsx:90-94. Applied before
  // the other filters so chip filters operate on the visible slice.
  const scopedIssues = useMemo(() => {
    const allIssues = listIssues;
    if (scope === "members") {
      return allIssues.filter((i) => i.assignee_type === "member");
    }
    if (scope === "agents") {
      return allIssues.filter(
        (i) => i.assignee_type === "agent" || i.assignee_type === "squad",
      );
    }
    return allIssues;
  }, [listIssues, scope]);

  // Board / swimlane / table group the window client-side, so a partially
  // loaded window under-reports them — drain the rest while one is on screen.
  useDrainIssuePages({
    enabled: view !== "list",
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    loadedRows: listIssues.length,
    fetchNextPage,
  });

  // Client predicate — the same window the workspace/my surfaces apply,
  // re-run so WS-patched rows outside it drop at render time.
  const filtered = useMemo(
    () => applyIssueFilters(scopedIssues, filterState),
    [scopedIssues, filterState],
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

  // Fold state is per device, per workspace, keyed by section key — see
  // `data/stores/issue-workbench-layout-store.ts`.
  const { sections: visibleSections, collapsed, toggle } =
    useListSectionFolding(wsId, sections);

  const hasActiveFilterChips = useMemo(() => {
    const f = filterState;
    return (
      f.statusFilters.length > 0 ||
      f.priorityFilters.length > 0 ||
      f.assigneeFilters.length > 0 ||
      f.includeNoAssignee ||
      f.creatorFilters.length > 0 ||
      f.projectFilters.length > 0 ||
      f.includeNoProject ||
      f.labelFilters.length > 0 ||
      Object.keys(f.propertyFilters).length > 0 ||
      f.dateFilter !== null
    );
  }, [filterState]);

  // The table owns its own empty state, which carries the search box — see the
  // workspace Issues surface for why that gate has to exclude `table`.
  const showEmptyState =
    !isLoading && !listLoadError && view !== "table" && sorted.length === 0;

  const onRefresh = useCallback(async () => {
    await Promise.all([refetch(), onRefreshMeta?.()]);
  }, [refetch, onRefreshMeta]);
  const refreshing = isRefetching || refreshingMeta;

  const navigateToIssue = (id: string) => {
    if (wsSlug) router.push(`/${wsSlug}/issue/${id}`);
  };

  const emptyMessage = hasActiveFilterChips
    ? t("issues.filterEmpty")
    : emptyMessageForScope(scope, t);

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
      <IssueViewBar
        wsId={wsId}
        scope={projectScope}
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
            useProjectIssuesViewStore.getState().toggleStatusFilter(s)
          }
          onClearPriority={(p) =>
            useProjectIssuesViewStore.getState().togglePriorityFilter(p)
          }
          onClearAssignee={(v) =>
            useProjectIssuesViewStore.getState().toggleAssigneeFilter(v)
          }
          onClearCreator={(v) =>
            useProjectIssuesViewStore.getState().toggleCreatorFilter(v)
          }
          onClearProject={(id) =>
            useProjectIssuesViewStore.getState().toggleProjectFilter(id)
          }
          onClearLabel={(id) =>
            useProjectIssuesViewStore.getState().toggleLabelFilter(id)
          }
          onClearNoAssignee={() =>
            useProjectIssuesViewStore.getState().toggleNoAssignee()
          }
          onClearNoProject={() =>
            useProjectIssuesViewStore.getState().toggleNoProject()
          }
          onClearProperty={(id) =>
            useProjectIssuesViewStore.getState().clearPropertyFilter(id)
          }
          onClearDate={() =>
            useProjectIssuesViewStore.getState().setDateFilter(null)
          }
        />
      ) : null}
      {isLoading ? (
        <IssuesLoading />
      ) : listLoadError ? (
        <View className="px-4 gap-3 pt-4">
          <Text className="text-sm text-destructive">
            {t("issues.loadError")}
            {error instanceof Error ? error.message : t("common.unknownError")}
          </Text>
          <Button variant="outline" onPress={() => refetch()}>
            <Text>{t("workspace.retry")}</Text>
          </Button>
        </View>
      ) : showEmptyState ? (
        <SurfaceEmptyState message={emptyMessage} />
      ) : view === "board" ? (
        <View className="flex-1">
          {header ? (
            // Board lanes need vertical room — keep the meta reachable but
            // capped at 40% of the surface so the columns stay usable
            // (list mode scrolls it as the ListHeaderComponent instead).
            <ScrollView
              className="flex-shrink"
              style={{ maxHeight: "40%" }}
              showsVerticalScrollIndicator={false}
            >
              {header}
            </ScrollView>
          ) : null}
          <BoardView
            issues={sorted}
            grouping={grouping}
            groupingProperty={groupingProperty}
            statusOrder={BOARD_STATUSES}
            onOpenIssue={(issue) => navigateToIssue(issue.id)}
            emptyLabel={emptyMessage}
            hiddenStatuses={boardHiddenColumns.hiddenStatuses}
            onHideStatus={boardHiddenColumns.hideStatus}
            onShowStatus={boardHiddenColumns.showStatus}
            isStatusFixed={boardHiddenColumns.isStatusFixed}
            allStatusesHidden={boardHiddenColumns.allStatusesHidden}
            sortBy={sortBy}
            sortDirection={sortDirection}
          />
        </View>
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
          search={tableSearch}
          onSearchChange={setTableSearch}
          onSort={(field, direction) => {
            useProjectIssuesViewStore.getState().setSortBy(field);
            useProjectIssuesViewStore.getState().setSortDirection(direction);
          }}
          onOpenIssue={(issue) => navigateToIssue(issue.id)}
          emptyLabel={emptyMessage}
        />
      ) : view === "gantt" ? (
        <GanttView
          issues={sorted}
          sortBy={sortBy}
          sortDirection={sortDirection}
          onOpenIssue={(issue) => navigateToIssue(issue.id)}
          emptyLabel={emptyMessage}
        />
      ) : view === "swimlane" ? (
        <SwimlaneView
          issues={sorted}
          grouping={swimlaneGrouping}
          onGroupingChange={(next) =>
            useProjectIssuesViewStore.getState().setSwimlaneGrouping(next)
          }
          statusOrder={BOARD_STATUSES}
          onOpenIssue={(issue) => navigateToIssue(issue.id)}
          emptyLabel={emptyMessage}
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
          ListHeaderComponent={header ?? null}
          contentContainerClassName={
            batchSelectionMode ? "pb-48" : "pb-6"
          }
          renderItem={({ item }) => (
            <IssueSelectionRow
              issue={item}
              onOpen={() => navigateToIssue(item.id)}
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
          refreshing={refreshing}
          onRefresh={onRefresh}
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
      return t("project.emptyIssues");
    case "members":
      return t("issues.emptyMembers");
    case "agents":
      return t("issues.emptyAgents");
  }
}