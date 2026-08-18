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
import { useMemo } from "react";
import { Pressable, SectionList, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useIsFocused } from "@react-navigation/native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Issue, IssuePriority, IssueStatus } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/ui/header";
import { HeaderActions } from "@/components/ui/app-header-actions";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { StatusIcon } from "@/components/ui/status-icon";
import { IssueRow } from "@/components/issue/issue-row";
import { BatchActionBar } from "@/components/issue/batch-action-bar";
import { BoardView } from "@/components/issue/board-view";
import { ViewModeToggle } from "@/components/issue/view-mode-toggle";
import { IssuesLoading } from "@/components/issue/issues-loading";
import {
  buildMyIssuesFilter,
  myIssueListOptions,
} from "@/data/queries/my-issues";
import type { MyIssuesScope } from "@/data/queries/issue-keys";
import { projectListOptions } from "@/data/queries/projects";
import { labelListOptions } from "@/data/queries/labels";
import { propertyActiveOptions } from "@/data/queries/properties";
import { useIssueBatchSelectionStore } from "@/data/stores/issue-batch-selection-store";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useMyIssuesViewStore } from "@/data/stores/my-issues-view-store";
import { buildIssueWindow } from "@/data/stores/issue-filter-slice";
import { useClearFiltersOnWorkspaceChange } from "@/lib/use-clear-filters-on-workspace-change";
import { BOARD_STATUSES } from "@/lib/issue-status";
import {
  applyIssueFilters,
  groupIssues,
  sortIssues,
  type IssueFilterState,
} from "@/lib/filter-issues";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n/react";
import { translate } from "@/lib/i18n";
import { useActorLookup } from "@/data/use-actor-name";

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

type IssueSection = {
  key: string;
  data: Issue[];
  status?: IssueStatus;
  assigneeType?: "member" | "agent" | "squad";
  assigneeId?: string;
  unassigned?: boolean;
};

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
      <ScopeToolbar
        scopes={SCOPES}
        scope={scope}
        onChange={(v) => setScope(v)}
        onOpenFilter={openFilter}
        hasActiveFilters={hasActiveFilterChips}
        view={view}
        onViewChange={setView}
        t={t}
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
        <EmptyState
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
            <SectionHeader section={section} />
          )}
          contentContainerClassName={
            batchSelectionMode ? "pb-48" : "pb-6"
          }
          renderItem={({ item }) => (
            <IssueRowCell
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

/**
 * Row cell wired to the batch-selection store: in selection mode the row
 * toggles membership on tap instead of navigating, and long-press enters
 * selection mode pre-selecting this row. Non-selecting callers (project
 * related issues, workspace-wide issues) don't opt in and keep native
 * tap-to-navigate.
 */
function IssueRowCell({
  issue,
  onOpen,
}: {
  issue: Issue;
  onOpen: () => void;
}) {
  const selectionMode = useIssueBatchSelectionStore((s) => s.selectionMode);
  const selected = useIssueBatchSelectionStore((s) =>
    s.selectedIds.has(issue.id),
  );
  const toggle = useIssueBatchSelectionStore((s) => s.toggle);
  const enterSelection = useIssueBatchSelectionStore((s) => s.enterSelection);
  return (
    <IssueRow
      issue={issue}
      selectionMode={selectionMode}
      selected={selected}
      onPress={() => {
        if (selectionMode) toggle(issue.id);
        else onOpen();
      }}
      onLongPress={() => enterSelection(issue.id)}
    />
  );
}

/**
 * Outline icon button matching the pill height so the toolbar row reads as
 * one visual group. Mirrors web `IssuesHeader` / `MyIssuesHeader` filter
 * trigger (`packages/views/my-issues/components/my-issues-header.tsx:174`),
 * which is also `variant="outline"` + icon-sized — NOT the ghost-style we'd
 * get from <IconButton>. Square (`w-9`) with `px-0` to suppress the sm
 * default `px-3`.
 */
function FilterButton({
  onPress,
  hasActiveFilters,
}: {
  onPress: () => void;
  hasActiveFilters: boolean;
}) {
  const { colorScheme } = useColorScheme();
  const { t } = useTranslation();
  return (
    <View style={{ position: "relative" }} className="ml-2">
      <Button
        variant="outline"
        size="sm"
        onPress={onPress}
        accessibilityLabel={t("a11y.filter")}
        className="w-9 px-0"
      >
        <Ionicons
          name="options-outline"
          size={16}
          color={THEME[colorScheme].mutedForeground}
        />
      </Button>
      {hasActiveFilters ? (
        <View
          pointerEvents="none"
          className="absolute top-1 right-1 size-1.5 rounded-full bg-brand"
        />
      ) : null}
    </View>
  );
}

/**
 * Toolbar row mirroring web `MyIssuesHeader` / `IssuesHeader`
 * (`packages/views/my-issues/components/my-issues-header.tsx:138-163`):
 * left-aligned scope pill group + right-side Filter icon (red dot when
 * filters are active). Replaces the previous full-width segmented tabs +
 * Filter-in-title-bar split — keeps scope and the filter affordance in the
 * same row, because they both control the list directly below.
 */
function ScopeToolbar<S extends string>({
  scopes,
  scope,
  onChange,
  onOpenFilter,
  hasActiveFilters,
  view,
  onViewChange,
  t,
}: {
  scopes: { value: S; labelKey: string }[];
  scope: S;
  onChange: (value: S) => void;
  onOpenFilter: () => void;
  hasActiveFilters: boolean;
  view: "list" | "board";
  onViewChange: (view: "list" | "board") => void;
  t: (id: string, params?: Record<string, string | number>) => string;
}) {
  return (
    <View className="flex-row items-center justify-between px-4 pt-2 pb-2">
      <View className="flex-row items-center gap-1 flex-shrink min-w-0">
        {scopes.map((s) => {
          const active = scope === s.value;
          return (
            <Button
              key={s.value}
              variant="outline"
              size="sm"
              onPress={() => onChange(s.value)}
              className={active ? "bg-accent" : ""}
              accessibilityState={{ selected: active }}
            >
              <Text
                numberOfLines={1}
                className={active ? "text-accent-foreground" : "text-muted-foreground"}
              >
                {t(s.labelKey)}
              </Text>
            </Button>
          );
        })}
      </View>
      <View className="flex-row items-center gap-1.5 ml-2">
        <ViewModeToggle view={view} onChange={onViewChange} />
        <FilterButton
          onPress={onOpenFilter}
          hasActiveFilters={hasActiveFilters}
        />
      </View>
    </View>
  );
}

/**
 * Chips bar — one chip per selected value, each clears only that value
 * (web filter-chips-bar semantics). Project/label chips resolve names from
 * the workspace catalogs; actor chips reuse `useActorLookup`.
 */
function ActiveFilterChips({
  filterState,
  statusFilters,
  priorityFilters,
  assigneeFilters,
  creatorFilters,
  projectFilters,
  labelFilters,
  propertyFilters,
  dateFilter,
  onClearStatus,
  onClearPriority,
  onClearAssignee,
  onClearCreator,
  onClearProject,
  onClearLabel,
  onClearNoAssignee,
  onClearNoProject,
  onClearProperty,
  onClearDate,
}: {
  filterState: IssueFilterState;
  statusFilters: IssueStatus[];
  priorityFilters: IssuePriority[];
  assigneeFilters: { type: "member" | "agent" | "squad"; id: string }[];
  creatorFilters: { type: "member" | "agent" | "squad"; id: string }[];
  projectFilters: string[];
  labelFilters: string[];
  propertyFilters: Record<string, string[]>;
  dateFilter: IssueFilterState["dateFilter"];
  onClearStatus: (s: IssueStatus) => void;
  onClearPriority: (p: IssuePriority) => void;
  onClearAssignee: (v: { type: "member" | "agent" | "squad"; id: string }) => void;
  onClearCreator: (v: { type: "member" | "agent" | "squad"; id: string }) => void;
  onClearProject: (id: string) => void;
  onClearLabel: (id: string) => void;
  onClearNoAssignee: () => void;
  onClearNoProject: () => void;
  onClearProperty: (id: string) => void;
  onClearDate: () => void;
}) {
  const { getName } = useActorLookup();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: projects = [] } = useQuery(projectListOptions(wsId));
  const { data: labels = [] } = useQuery(labelListOptions(wsId));
  const { data: properties = [] } = useQuery(propertyActiveOptions(wsId));
  const projectName = (id: string) =>
    projects.find((p) => p.id === id)?.title ?? id.slice(0, 8);
  const labelName = (id: string) =>
    labels.find((l) => l.id === id)?.name ?? id.slice(0, 8);
  // Property chips mirror web filter-chips-bar.tsx: one chip per DEFINITION
  // carrying the definition name and its selected options (checkbox renders
  // the true/false pseudo-option labels). Clear removes that definition only.
  const propertyChip = (propertyId: string, selected: string[]) => {
    const definition = properties.find((p) => p.id === propertyId);
    if (!definition) return null;
    const optionName = (optionId: string) => {
      if (definition.type === "checkbox") {
        return optionId === "true"
          ? translate("filter.propertyTrue")
          : translate("filter.propertyFalse");
      }
      return (
        definition.config.options?.find((o) => o.id === optionId)?.name ??
        optionId
      );
    };
    return {
      label: `${definition.name}: ${selected.map(optionName).join(", ")}`,
      onClear: () => onClearProperty(propertyId),
    };
  };
  const dateShort = (dateOnly: string) => {
    const [, m, d] = dateOnly.split("-");
    return `${Number(m)}/${Number(d)}`;
  };

  return (
    <View className="flex-row flex-wrap gap-1.5 px-4 pb-2">
      {statusFilters.map((s) => (
        <Chip key={`s-${s}`} label={translate(`enum.status.${s}`)} onClear={() => onClearStatus(s)} />
      ))}
      {priorityFilters.map((p) => (
        <Chip key={`p-${p}`} label={translate(`enum.priority.${p}`)} onClear={() => onClearPriority(p)} />
      ))}
      {assigneeFilters.map((a) => (
        <Chip
          key={`a-${a.type}:${a.id}`}
          label={getName(a.type, a.id)}
          onClear={() => onClearAssignee(a)}
        />
      ))}
      {filterState.includeNoAssignee ? (
        <Chip
          key="no-assignee"
          label={translate("filter.noAssignee")}
          onClear={onClearNoAssignee}
        />
      ) : null}
      {creatorFilters.map((c) => (
        <Chip
          key={`c-${c.type}:${c.id}`}
          label={getName(c.type, c.id)}
          onClear={() => onClearCreator(c)}
        />
      ))}
      {projectFilters.map((id) => (
        <Chip key={`pr-${id}`} label={projectName(id)} onClear={() => onClearProject(id)} />
      ))}
      {filterState.includeNoProject ? (
        <Chip
          key="no-project"
          label={translate("filter.noProject")}
          onClear={onClearNoProject}
        />
      ) : null}
      {labelFilters.map((id) => (
        <Chip key={`l-${id}`} label={labelName(id)} onClear={() => onClearLabel(id)} />
      ))}
      {Object.entries(propertyFilters).map(([propertyId, selected]) => {
        if (selected.length === 0) return null;
        const chip = propertyChip(propertyId, selected);
        if (!chip) return null;
        return (
          <Chip key={`prop-${propertyId}`} label={chip.label} onClear={chip.onClear} />
        );
      })}
      {dateFilter ? (
        <Chip
          key="date"
          label={`${translate(
            dateFilter.field === "created_at"
              ? "filter.dateCreated"
              : "filter.dateUpdated",
          )}: ${
            dateFilter.from === dateFilter.to
              ? dateShort(dateFilter.from)
              : `${dateShort(dateFilter.from)} - ${dateShort(dateFilter.to)}`
          }`}
          onClear={onClearDate}
        />
      ) : null}
    </View>
  );
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  const { colorScheme } = useColorScheme();
  return (
    <Pressable
      onPress={onClear}
      className="flex-row items-center gap-1 pl-2.5 pr-2 py-1 rounded-full border border-border bg-secondary/40 active:bg-secondary"
    >
      <Text className="text-xs text-foreground">{label}</Text>
      <Ionicons
        name="close"
        size={12}
        color={THEME[colorScheme].mutedForeground}
      />
    </Pressable>
  );
}

/**
 * Section header for both grouping modes. Assignee lanes render actor
 * avatar + name; the unassigned lane renders "Unassigned".
 */
function SectionHeader({ section }: { section: IssueSection }) {
  const { getName } = useActorLookup();
  if (section.status) {
    return (
      <View className="flex-row items-center gap-2 px-4 py-2 bg-background">
        <StatusIcon status={section.status} size={14} />
        <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          {translate(`enum.status.${section.status}`)}
        </Text>
        <Text className="text-xs text-muted-foreground/60">
          {section.data.length}
        </Text>
      </View>
    );
  }
  return (
    <View className="flex-row items-center gap-2 px-4 py-2 bg-background">
      {section.unassigned ? (
        <>
          <View className="w-[18px]" />
          <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
            {translate("filter.noAssignee")}
          </Text>
        </>
      ) : (
        <>
          <ActorAvatar
            type={section.assigneeType}
            id={section.assigneeId}
            size={18}
          />
          <Text
            numberOfLines={1}
            className="flex-1 text-xs font-medium text-muted-foreground"
          >
            {getName(section.assigneeType, section.assigneeId)}
          </Text>
        </>
      )}
      <Text className="text-xs text-muted-foreground/60">
        {section.data.length}
      </Text>
    </View>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <View className="flex-1 items-center justify-center px-6">
      <Text className="text-sm text-muted-foreground text-center">
        {message}
      </Text>
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