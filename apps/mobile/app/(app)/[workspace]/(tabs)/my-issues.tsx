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
import { useCallback, useMemo } from "react";
import { SectionList, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useIsFocused } from "@react-navigation/native";
import { router } from "expo-router";
import type { CreateIssueViewRequest, IssueView } from "@multica/core/api/schemas";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/ui/header";
import { HeaderActions } from "@/components/ui/app-header-actions";
import { BatchActionBar } from "@/components/issue/batch-action-bar";
import { BoardView } from "@/components/issue/board-view";
import { IssueViewBar } from "@/components/issue/issue-view-bar";
import { IssuesLoading } from "@/components/issue/issues-loading";
import {
  ActiveFilterChips,
  IssueSectionHeader,
  IssueSelectionRow,
  IssueSection,
  IssueSurfaceScopeToolbar,
  SurfaceEmptyState,
} from "@/components/issue/issue-surface-chrome";
import {
  buildMyIssuesFilter,
  myIssueListOptions,
} from "@/data/queries/my-issues";
import { issueViewListOptions } from "@/data/queries/issue-views";
import type { MyIssuesScope } from "@/data/queries/issue-keys";
import { useIssueBatchSelectionStore } from "@/data/stores/issue-batch-selection-store";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useMyIssuesViewStore } from "@/data/stores/my-issues-view-store";
import {
  issueViewContainerKey,
  useActiveIssueViewStore,
} from "@/data/stores/active-issue-view-store";
import {
  sanitizeViewDisplay,
  sanitizeViewQuery,
  viewMatchesSlice,
} from "@/data/stores/issue-view-codec";
import { buildIssueWindow, defaultIssueFilterSlice } from "@/data/stores/issue-filter-slice";
import { useClearFiltersOnWorkspaceChange } from "@/lib/use-clear-filters-on-workspace-change";
import { BOARD_STATUSES } from "@/lib/issue-status";
import {
  applyIssueFilters,
  groupIssues,
  sortIssues,
  type IssueFilterState,
} from "@/lib/filter-issues";
import { useTranslation } from "@/lib/i18n/react";

// Mobile pill row has tight width on SE3 (375pt). Three pills + Filter icon
// must fit in 343pt usable space, so the agents scope renders "Agents" — the
// full "Agents and Squads" label (~135pt) blows past safe limits and breaks
// under Dynamic Type. Semantics unchanged: same backend predicate
// (`involves_user_id`, MUL-2397) covers owned agents + related squads; the
// empty state copy still says "agents or squads".
const SCOPES: { value: MyIssuesScope; labelKey: string }[] = [
  { value: "assigned", labelKey: "myIssues.scopeAssigned" },
  { value: "created", labelKey: "myIssues.scopeCreated" },
  { value: "agents", labelKey: "myIssues.scopeAgents" },
];

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
  const grouping = useMyIssuesViewStore((s) => s.grouping);
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
      params: { workspace: wsSlug, scope: "my" },
    });
  };

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
  // involved — mobile "agents" ≈ web "involved"); applying a view resets the
  // slice + display defaults and lands on the scope axis the view captured.
  const myScope = useMemo(() => ({ scope_type: "my" as const }), []);
  const scopeVariant = useMemo<CreateIssueViewRequest["scope_variant"]>(
    () =>
      scope === "assigned"
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
      useMyIssuesViewStore.setState({
        ...snapshot,
        dateFilter: null,
        sortBy: display.sortBy,
        sortDirection: display.sortDirection,
        grouping: display.grouping,
        view: display.viewMode,
      });
      // The scope axis a my-view captured is part of the VIEW — landing on
      // the right tab, while the user's own tab stays untouched once the
      // view closes.
      setScope(
        v.scope_variant === "created"
          ? "created"
          : v.scope_variant === "involved"
            ? "agents"
            : "assigned",
      );
      useActiveIssueViewStore.getState().setActive(containerKey, v.id);
    },
    [containerKey, setScope, sortBy],
  );
  const exitView = useCallback(() => {
    useMyIssuesViewStore.setState({
      ...defaultIssueFilterSlice(),
      scope: "assigned",
      view: "list",
    });
    useActiveIssueViewStore.getState().setActive(containerKey, null);
  }, [containerKey]);

  const filter = useMemo(
    () => (userId ? buildMyIssuesFilter(scope, userId) : { assignee_id: "" }),
    [scope, userId],
  );

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
      }),
    [filterState, sortBy, sortDirection],
  );

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    ...myIssueListOptions(wsId, scope, filter, window),
    enabled: !!wsId && !!userId,
  });

  // Client predicate — same window re-applied so WS-patched rows that fell
  // out of it drop at render time (mirrors the workspace Issues page).
  const filtered = useMemo(
    () => applyIssueFilters(data ?? [], filterState),
    [data, filterState],
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
          statusFilters={filterState.statusFilters}
          priorityFilters={filterState.priorityFilters}
          assigneeFilters={filterState.assigneeFilters}
          creatorFilters={filterState.creatorFilters}
          projectFilters={filterState.projectFilters}
          labelFilters={filterState.labelFilters}
          propertyFilters={filterState.propertyFilters}
          dateFilter={filterState.dateFilter}
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
      {isLoading ? (
        <IssuesLoading />
      ) : error ? (
        <View className="px-4 gap-3 pt-4">
          <Text className="text-sm text-destructive">
            {t("myIssues.loadError")}
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
              ? t("myIssues.filterEmpty")
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
              ? t("myIssues.filterEmpty")
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
          refreshing={isFocused && isRefetching}
          onRefresh={refetch}
        />
      )}

      {view === "list" && sorted.length > 0 ? (
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
    case "assigned":
      return t("myIssues.emptyAssigned");
    case "created":
      return t("myIssues.emptyCreated");
    case "agents":
      return t("myIssues.emptyAgents");
  }
}