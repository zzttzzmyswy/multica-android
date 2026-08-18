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
import { useCallback, useMemo } from "react";
import { SectionList, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
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
import { IssueViewBar } from "@/components/issue/issue-view-bar";
import { IssueTableView } from "@/components/issue/table-view";
import { IssuesLoading } from "@/components/issue/issues-loading";
import {
  ActiveFilterChips,
  IssueSection,
  IssueSectionHeader,
  IssueSelectionRow,
  IssueSurfaceScopeToolbar,
  SurfaceEmptyState,
} from "@/components/issue/issue-surface-chrome";
import { issueListOptions } from "@/data/queries/issues";
import { issueViewListOptions } from "@/data/queries/issue-views";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  useIssuesViewStore,
  type IssuesScope,
} from "@/data/stores/issues-view-store";
import { useIssueBatchSelectionStore } from "@/data/stores/issue-batch-selection-store";
import {
  issueViewContainerKey,
  useActiveIssueViewStore,
} from "@/data/stores/active-issue-view-store";
import {
  sanitizeViewDisplay,
  sanitizeViewQuery,
  viewMatchesSlice,
} from "@/data/stores/issue-view-codec";
import {
  buildIssueWindow,
  defaultIssueFilterSlice,
} from "@/data/stores/issue-filter-slice";
import { useClearFiltersOnWorkspaceChange } from "@/lib/use-clear-filters-on-workspace-change";
import { BOARD_STATUSES } from "@/lib/issue-status";
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
  const tableColumns = useIssuesViewStore((s) => s.tableColumns);
  const toggleTableColumn = useIssuesViewStore((s) => s.toggleTableColumn);
  const grouping = useIssuesViewStore((s) => s.grouping);
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
    ],
  );

  const openFilter = () => {
    if (!wsSlug) return;
    router.push({
      pathname: "/[workspace]/issues-filter",
      params: { workspace: wsSlug, scope: "all" },
    });
  };

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
  // Union of the filter dims + display defaults the views save/compare.
  const snapshotSource = useMemo(
    () => ({ ...filterState, sortBy, sortDirection, grouping }),
    [filterState, sortBy, sortDirection, grouping],
  );
  const modifiedActive = useMemo(
    () => (activeView ? !viewMatchesSlice(activeView, snapshotSource, view) : false),
    [activeView, snapshotSource, view],
  );
  const applyView = useCallback(
    (v: IssueView) => {
      const snapshot = sanitizeViewQuery(v.query);
      const display = sanitizeViewDisplay(v.display, sortBy);
      useIssuesViewStore.setState({
        ...snapshot,
        dateFilter: null,
        sortBy: display.sortBy,
        sortDirection: display.sortDirection,
        grouping: display.grouping,
        view: display.viewMode,
      });
      // The scope axis a workspace view captured is part of the VIEW (web
      // semantics) — switching to it lands on the right tab, but the
      // user's own tab is exactly where they left it once the view closes.
      setScope(
        v.scope_variant === "members"
          ? "members"
          : v.scope_variant === "agents"
            ? "agents"
            : "all",
      );
      useActiveIssueViewStore.getState().setActive(containerKey, v.id);
    },
    [containerKey, setScope, sortBy],
  );
  const exitView = useCallback(() => {
    useIssuesViewStore.setState({
      ...defaultIssueFilterSlice(),
      scope: "all",
      view: "list",
    });
    useActiveIssueViewStore.getState().setActive(containerKey, null);
  }, [containerKey]);

  // The active window travels as server params → filter/sort changes refetch
  // and the cache is keyed per window (issueKeys.listFiltered). Identity is
  // memoized on the slice values so the query key stays stable.
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
      }),
    [filterState, sortBy, sortDirection],
  );

  const { data, isLoading, error, refetch, isRefetching } = useQuery(
    issueListOptions(wsId, window),
  );

  // Scope pre-filter — mirrors web `issues-page.tsx:90-94`. Applied before
  // other filtering so chip filters operate on the visible slice.
  const scopedIssues = useMemo(() => {
    const allIssues = data ?? [];
    if (scope === "members") {
      return allIssues.filter((i) => i.assignee_type === "member");
    }
    if (scope === "agents") {
      return allIssues.filter(
        (i) => i.assignee_type === "agent" || i.assignee_type === "squad",
      );
    }
    return allIssues;
  }, [data, scope]);

  // Client predicate — the same filters the server window applied, re-run
  // so rows that drifted out of the window via WS patches drop at render.
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

  const showEmptyState = !isLoading && !error && sorted.length === 0;

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
          statusFilters={filterState.statusFilters}
          priorityFilters={filterState.priorityFilters}
          assigneeFilters={filterState.assigneeFilters}
          creatorFilters={filterState.creatorFilters}
          projectFilters={filterState.projectFilters}
          labelFilters={filterState.labelFilters}
          propertyFilters={filterState.propertyFilters}
          dateFilter={filterState.dateFilter}
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
      {isLoading ? (
        <IssuesLoading />
      ) : error ? (
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
        <SurfaceEmptyState
          message={
            hasActiveFilterChips
              ? t("issues.filterEmpty")
              : emptyMessageForScope(scope, t)
          }
        />
      ) : view === "board" ? (
        <BoardView
          issues={sorted}
          grouping={grouping}
          statusOrder={BOARD_STATUSES}
          onOpenIssue={(issue) => {
            if (wsSlug) router.push(`/${wsSlug}/issue/${issue.id}`);
          }}
          emptyLabel={
            hasActiveFilterChips
              ? t("issues.filterEmpty")
              : emptyMessageForScope(scope, t)
          }
        />
      ) : view === "table" ? (
        <IssueTableView
          issues={sorted}
          columns={tableColumns}
          onToggleColumn={toggleTableColumn}
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
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          stickySectionHeadersEnabled={false}
          ItemSeparatorComponent={() => (
            <View className="h-px bg-border ml-4" />
          )}
          renderSectionHeader={({ section }) => (
            <IssueSectionHeader section={section} />
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
          refreshing={isRefetching}
          onRefresh={refetch}
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