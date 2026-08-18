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
import { useCallback, useMemo } from "react";
import { ScrollView, SectionList, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import type { CreateIssueViewRequest, IssueView } from "@multica/core/api/schemas";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { BatchActionBar } from "@/components/issue/batch-action-bar";
import { BoardView } from "@/components/issue/board-view";
import { IssueViewBar } from "@/components/issue/issue-view-bar";
import { IssuesLoading } from "@/components/issue/issues-loading";
import {
  ActiveFilterChips,
  IssueSection,
  IssueSectionHeader,
  IssueSelectionRow,
  IssueSurfaceScopeToolbar,
  SurfaceEmptyState,
} from "@/components/issue/issue-surface-chrome";
import { projectIssuesOptions } from "@/data/queries/projects";
import { issueViewListOptions } from "@/data/queries/issue-views";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useProjectIssuesViewStore } from "@/data/stores/project-issues-view-store";
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
import { defaultIssueFilterSlice } from "@/data/stores/issue-filter-slice";
import { useClearFiltersOnWorkspaceChange } from "@/lib/use-clear-filters-on-workspace-change";
import { BOARD_STATUSES } from "@/lib/issue-status";
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
  const grouping = useProjectIssuesViewStore((s) => s.grouping);
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
  const snapshotSource = useMemo(
    () => ({ ...filterState, sortBy, sortDirection, grouping }),
    [filterState, sortBy, sortDirection, grouping],
  );
  const modifiedActive = useMemo(
    () =>
      activeView
        ? !viewMatchesSlice(activeView, snapshotSource, view)
        : false,
    [activeView, snapshotSource, view],
  );
  const applyView = useCallback(
    (v: IssueView) => {
      const snapshot = sanitizeViewQuery(v.query);
      const display = sanitizeViewDisplay(v.display, sortBy);
      useProjectIssuesViewStore.setState({
        ...snapshot,
        dateFilter: null,
        sortBy: display.sortBy,
        sortDirection: display.sortDirection,
        grouping: display.grouping,
        view: display.viewMode,
      });
      // The scope-axis a project view captured is part of the VIEW — land
      // on the right tab, while the user's own tab is untouched once the
      // view closes (same semantics as the workspace surface).
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
    useProjectIssuesViewStore.setState({
      ...defaultIssueFilterSlice(),
      scope: "all",
      view: "list",
    });
    useActiveIssueViewStore.getState().setActive(containerKey, null);
  }, [containerKey]);

  const { data, isLoading, error, refetch, isRefetching } = useQuery(
    projectIssuesOptions(wsId, projectId),
  );

  // Scope pre-filter — mirrors web issues-page.tsx:90-94. Applied before
  // the other filters so chip filters operate on the visible slice.
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
          statusFilters={filterState.statusFilters}
          priorityFilters={filterState.priorityFilters}
          assigneeFilters={filterState.assigneeFilters}
          creatorFilters={filterState.creatorFilters}
          projectFilters={filterState.projectFilters}
          labelFilters={filterState.labelFilters}
          propertyFilters={filterState.propertyFilters}
          dateFilter={filterState.dateFilter}
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
            statusOrder={BOARD_STATUSES}
            onOpenIssue={(issue) => navigateToIssue(issue.id)}
            emptyLabel={emptyMessage}
          />
        </View>
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
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
      )}

      {view === "list" && sorted.length > 0 ? (
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