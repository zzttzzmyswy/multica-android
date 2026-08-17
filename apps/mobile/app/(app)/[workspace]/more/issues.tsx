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
import { useMemo } from "react";
import { Pressable, SectionList, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Issue, IssuePriority, IssueStatus } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { ActorAvatar } from "@/components/ui/actor-avatar";
// Header chrome (back + "Issues" title) comes from the parent Stack
// (`apps/mobile/app/(app)/[workspace]/_layout.tsx:269`). The Filter
// affordance now lives in <ScopeToolbar> below, matching web's
// IssuesHeader pattern (scope + filter share a row).
import { StatusIcon } from "@/components/ui/status-icon";
import { IssueRow } from "@/components/issue/issue-row";
import { IssuesLoading } from "@/components/issue/issues-loading";
import { issueListOptions } from "@/data/queries/issues";
import { projectListOptions } from "@/data/queries/projects";
import { labelListOptions } from "@/data/queries/labels";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  useIssuesViewStore,
  type IssuesScope,
} from "@/data/stores/issues-view-store";
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

type IssueSection = {
  key: string;
  data: Issue[];
  status?: IssueStatus;
  /** Assignee-grouping lane identity (absent for status grouping). */
  assigneeType?: "member" | "agent" | "squad";
  assigneeId?: string;
  unassigned?: boolean;
};

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
  const { t } = useTranslation();

  const scope = useIssuesViewStore((s) => s.scope);
  const setScope = useIssuesViewStore((s) => s.setScope);
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
      f.labelFilters.length > 0
    );
  }, [filterState]);

  const showEmptyState = !isLoading && !error && sorted.length === 0;

  return (
    <View className="flex-1 bg-background">
      <ScopeToolbar
        scopes={SCOPES}
        scope={scope}
        onChange={(v) => setScope(v)}
        onOpenFilter={openFilter}
        hasActiveFilters={hasActiveFilterChips}
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
        <EmptyState
          message={
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
            <IssuesSectionHeader section={section} />
          )}
          contentContainerClassName="pb-6"
          renderItem={({ item }) => (
            <IssueRow
              issue={item}
              onPress={() => {
                if (wsSlug) router.push(`/${wsSlug}/issue/${item.id}`);
              }}
            />
          )}
          refreshing={isRefetching}
          onRefresh={refetch}
        />
      )}
    </View>
  );
}

/**
 * Section header for both grouping modes. Assignee lanes render the actor
 * avatar + name through the same actor lookup the filter picker uses; the
 * unassigned lane renders "Unassigned" (web filter includeNoAssignee label).
 */
function IssuesSectionHeader({ section }: { section: IssueSection }) {
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
          <ActorAvatar type={section.assigneeType} id={section.assigneeId} size={18} />
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

/**
 * Outline icon button matching the pill height. Identical to the helper in
 * `(tabs)/my-issues.tsx` for the same reason ScopeToolbar is duplicated:
 * two callers don't justify a shared primitive yet.
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
 * Toolbar row mirroring web `IssuesHeader`
 * (`packages/views/issues/components/issues-header.tsx:516-543`): left-aligned
 * scope pill group + right-side Filter icon (red dot on active filters).
 * Identical to the equivalent in `(tabs)/my-issues.tsx` — kept duplicated
 * because the threshold for a shared `components/ui/` primitive is 3 callers,
 * and two callers don't justify the abstraction yet.
 */
function ScopeToolbar<S extends string>({
  scopes,
  scope,
  onChange,
  onOpenFilter,
  hasActiveFilters,
  t,
}: {
  scopes: { value: S; labelKey: string }[];
  scope: S;
  onChange: (value: S) => void;
  onOpenFilter: () => void;
  hasActiveFilters: boolean;
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
      <FilterButton
        onPress={onOpenFilter}
        hasActiveFilters={hasActiveFilters}
      />
    </View>
  );
}

/**
 * Chips bar — one chip per selected value, each clears THAT value only
 * (web filter-chips-bar semantics). Project / label chips resolve names
 * from their workspace catalogs; the actor chips reuse the same
 * `useActorLookup` the filter panel does.
 */
function ActiveFilterChips({
  filterState,
  statusFilters,
  priorityFilters,
  assigneeFilters,
  creatorFilters,
  projectFilters,
  labelFilters,
  onClearStatus,
  onClearPriority,
  onClearAssignee,
  onClearCreator,
  onClearProject,
  onClearLabel,
  onClearNoAssignee,
  onClearNoProject,
}: {
  filterState: IssueFilterState;
  statusFilters: IssueStatus[];
  priorityFilters: IssuePriority[];
  assigneeFilters: { type: "member" | "agent" | "squad"; id: string }[];
  creatorFilters: { type: "member" | "agent" | "squad"; id: string }[];
  projectFilters: string[];
  labelFilters: string[];
  onClearStatus: (s: IssueStatus) => void;
  onClearPriority: (p: IssuePriority) => void;
  onClearAssignee: (v: { type: "member" | "agent" | "squad"; id: string }) => void;
  onClearCreator: (v: { type: "member" | "agent" | "squad"; id: string }) => void;
  onClearProject: (id: string) => void;
  onClearLabel: (id: string) => void;
  onClearNoAssignee: () => void;
  onClearNoProject: () => void;
}) {
  const { getName } = useActorLookup();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: projects = [] } = useQuery(projectListOptions(wsId));
  const { data: labels = [] } = useQuery(labelListOptions(wsId));
  const projectName = (id: string) =>
    projects.find((p) => p.id === id)?.title ?? id.slice(0, 8);
  const labelName = (id: string) =>
    labels.find((l) => l.id === id)?.name ?? id.slice(0, 8);

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