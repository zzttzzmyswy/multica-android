/**
 * Shared projects browser — the list body only (loading / error / empty /
 * rows), no screen chrome. Used by both the "Projects" bottom-tab
 * (`(tabs)/projects.tsx`, which draws its own `<Header>`) and the
 * `more/projects` push screen (native Stack header). The `+` create action
 * is a prop: each host renders it where that route's header lives, so we
 * never double-draw a title bar.
 *
 * Search / filter / sort / multi-select (web projects-page parity,
 * MYS-1020): a search field, status + priority + lead filter chips, a sort
 * picker (5 fields × direction), and a batch toolbar (pin/unpin any member,
 * delete workspace admin) that appears in long-press selection mode. Sort +
 * filter state lives in a session store; search and selection stay
 * session-local like web.
 *
 * Lead chips (iter-130) mirror web's `leads` dimension
 * (projects-page.tsx:855-865,1076-1098): the option set is derived from the
 * loaded projects themselves — composite `type:id` refs with an occurrence
 * count — so a project with no lead contributes no option (web has no
 * "unassigned" row either), and the chips stay empty until a project
 * actually carries a lead.
 *
 * WS `project:*` events keep the cache fresh via the listing-level
 * realtime hook (`useProjectsRealtime` in `_layout.tsx`), so
 * pull-to-refresh is rarely needed but kept for the cellular-edge case
 * where a WS reconnect missed events.
 */
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { create } from "zustand";
import type { ProjectPriority, ProjectStatus } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { ProjectRow } from "@/components/project/project-row";
import { projectListOptions } from "@/data/queries/projects";
import { pinListOptions } from "@/data/queries/pins";
import { memberListOptions } from "@/data/queries/members";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useAuthStore } from "@/data/auth-store";
import { useActorLookup } from "@/data/use-actor-name";
import {
  useBatchDeleteProjects,
  useBatchPinToggle,
} from "@/data/mutations/project-batch";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { ActionSheet } from "@/lib/action-sheet";
import {
  projectPriorityLabel,
  projectStatusLabel,
} from "@/lib/project-status";
import { cn } from "@/lib/utils";
import {
  countActiveProjectFilters,
  EMPTY_PROJECT_FILTERS,
  filterProjects,
  PROJECT_PRIORITIES,
  PROJECT_SORT_DEFAULT_DIRECTION,
  PROJECT_SORT_FIELDS,
  PROJECT_STATUSES,
  leadFilterValue,
  sortProjects,
  toggleInList,
  type ProjectListFilters,
  type ProjectSortField,
} from "@/lib/filter-projects";
import { ProjectTableView } from "@/components/project/project-table-view";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useProjectTableColumnsStore } from "@/data/stores/project-table-columns";

// Sort + filter dimensions persist for the session; web persists these in
// its view store but a session-scoped store keeps the phone honest when a
// teammate re-shares a filter — and matches how mobile's issue list treats
// filters (see data/stores/issue-filter-slice.ts).
//
// `viewMode` joins them in iteration 135. It is the mobile spelling of web's
// `ProjectViewMode` (`packages/core/projects/stores/view-store.ts:13`, whose
// values are the density names `compact` / `comfortable`): on the phone the
// choice reads as "table or cards", which is what the toggle's own labels
// say, and nothing else branches on the identifier but this screen. The
// default matches web's — `compact`, i.e. the table.
interface ProjectMobileViewState {
  viewMode: ProjectViewMode;
  sortField: ProjectSortField;
  sortDirection: "asc" | "desc";
  filters: ProjectListFilters;
  setViewMode: (mode: ProjectViewMode) => void;
  setSort: (field: ProjectSortField, direction: "asc" | "desc") => void;
  toggleFilter: (key: "statuses" | "priorities" | "leads", value: string) => void;
  clearFilters: () => void;
}

export type ProjectViewMode = "table" | "cards";

const DEFAULT_VIEW = {
  viewMode: "table" as ProjectViewMode,
  sortField: "created" as ProjectSortField,
  sortDirection: PROJECT_SORT_DEFAULT_DIRECTION.created,
  filters: EMPTY_PROJECT_FILTERS,
};

export const useProjectMobileViewStore = create<ProjectMobileViewState>()(
  (set) => ({
    ...DEFAULT_VIEW,
    setViewMode: (viewMode) => set({ viewMode }),
    setSort: (field, direction) =>
      set({ sortField: field, sortDirection: direction }),
    toggleFilter: (key, value) =>
      set((state) => ({
        filters: {
          ...state.filters,
          [key]: toggleInList(state.filters[key], value),
        },
      })),
    clearFilters: () => set({ filters: { ...EMPTY_PROJECT_FILTERS } }),
  }),
);

function ProjectSeparator() {
  return <View className="h-px bg-border ml-4" />;
}

export function ProjectsScreen({
  onCreate,
}: {
  /** Called when the "+" header action is pressed. */
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);
  const { getName } = useActorLookup();

  const { data = [], isLoading, error, refetch, isRefetching } = useQuery(
    projectListOptions(wsId),
  );
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const { data: pins = [] } = useQuery({
    ...pinListOptions(wsId, currentUserId),
    enabled: !!wsId && !!currentUserId,
  });

  const sortField = useProjectMobileViewStore((s) => s.sortField);
  const sortDirection = useProjectMobileViewStore((s) => s.sortDirection);
  const filters = useProjectMobileViewStore((s) => s.filters);
  const viewMode = useProjectMobileViewStore((s) => s.viewMode);
  const setViewMode = useProjectMobileViewStore((s) => s.setViewMode);
  const setSort = useProjectMobileViewStore((s) => s.setSort);
  const toggleFilter = useProjectMobileViewStore((s) => s.toggleFilter);
  const clearFilters = useProjectMobileViewStore((s) => s.clearFilters);

  // Column configuration lives in its own store so a column hidden here never
  // touches the issue table's same-named columns (see
  // data/stores/project-table-columns.ts).
  const tableColumns = useProjectTableColumnsStore((s) => s.projectTableColumns);
  const tableColumnWidths = useProjectTableColumnsStore(
    (s) => s.projectTableColumnWidths,
  );
  const toggleTableColumn = useProjectTableColumnsStore(
    (s) => s.toggleProjectTableColumn,
  );
  const setTableColumnWidth = useProjectTableColumnsStore(
    (s) => s.setProjectTableColumnWidth,
  );
  const reorderTableColumn = useProjectTableColumnsStore(
    (s) => s.reorderProjectTableColumn,
  );
  const resetTableColumns = useProjectTableColumnsStore(
    (s) => s.resetProjectTableColumns,
  );

  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());

  const isWorkspaceAdmin = useMemo(() => {
    if (!currentUserId) return false;
    return members.some(
      (m) =>
        m.user_id === currentUserId &&
        (m.role === "owner" || m.role === "admin"),
    );
  }, [members, currentUserId]);

  const pinnedProjectIds = useMemo(() => {
    const s = new Set<string>();
    for (const pin of pins) if (pin.item_type === "project") s.add(pin.item_id);
    return s;
  }, [pins]);

  const visible = useMemo(
    () =>
      sortProjects(
        filterProjects(data, search, filters),
        sortField,
        sortDirection,
      ),
    [data, search, filters, sortField, sortDirection],
  );

  // Lead filter options derive from the FULL project set (not `visible`) so
  // toggling another dimension never makes a lead chip disappear — same rule
  // as web's `leadOptions` useMemo. A project without a lead contributes
  // nothing, which is why there is no "unassigned" chip: web's loop
  // `continue`s on the same condition.
  //
  // `getName` is a per-render closure from `useActorLookup`, so this memo
  // recomputes on every render of the list — cheap at project-list scale
  // (one pass over `data`) and the alternative is an unstable-dependency
  // lint escape hatch.
  const leadOptions = useMemo(() => {
    const byValue = new Map<
      string,
      { type: "member" | "agent"; id: string; count: number }
    >();
    for (const p of data) {
      const v = leadFilterValue(p);
      if (!v || !p.lead_type || !p.lead_id) continue;
      const entry = byValue.get(v);
      if (entry) entry.count += 1;
      else byValue.set(v, { type: p.lead_type, id: p.lead_id, count: 1 });
    }
    return [...byValue.entries()]
      .map(([value, { type, id, count }]) => ({
        value,
        // Named through the shared resolver, which falls back to the same
        // "Unknown Agent" / "Unknown" copy web's useActorName uses — a lead
        // held by an archived agent must not render as a raw UUID.
        label: getName(type, id),
        count,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [data, getName]);

  const activeFilterCount = countActiveProjectFilters(filters);

  const selectedProjects = useMemo(
    () => visible.filter((p) => selectedIds.has(p.id)),
    [visible, selectedIds],
  );
  const allSelected =
    visible.length > 0 && selectedProjects.length === visible.length;

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds(allSelected ? new Set() : new Set(visible.map((p) => p.id)));
  }, [allSelected, visible]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const batchPin = useBatchPinToggle();
  const batchDelete = useBatchDeleteProjects();

  const confirmBatchDelete = useCallback(() => {
    const ids = selectedProjects.map((p) => p.id);
    if (ids.length === 0) return;
    Alert.alert(
      t("projects.batchDeleteTitle"),
      t("projects.batchDeleteMessage", { count: ids.length }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("projects.batchDelete"),
          style: "destructive",
          onPress: () =>
            batchDelete.mutate(ids, {
              onSuccess: clearSelection,
              onError: (err) =>
                Alert.alert(
                  t("projects.batchDeleteFailed"),
                  err instanceof Error
                    ? err.message
                    : t("common.unknownError"),
                ),
            }),
        },
      ],
    );
  }, [selectedProjects, batchDelete, clearSelection, t]);

  const anyUnpinnedSelected = selectedProjects.some(
    (p) => !pinnedProjectIds.has(p.id),
  );

  const handleBatchPin = useCallback(() => {
    for (const p of selectedProjects) {
      if (anyUnpinnedSelected && !pinnedProjectIds.has(p.id)) {
        batchPin.pin(p.id);
      } else if (!anyUnpinnedSelected && pinnedProjectIds.has(p.id)) {
        batchPin.unpin(p.id);
      }
    }
  }, [selectedProjects, anyUnpinnedSelected, pinnedProjectIds, batchPin]);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    clearSelection();
  }, [clearSelection]);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator />
      </View>
    );
  }

  if (error) {
    return (
      <View className="px-4 gap-3 pt-4">
        <Text className="text-sm text-destructive">
          {t("projects.loadFailed")}
          {error instanceof Error ? error.message : t("common.unknownError")}
        </Text>
        <Button variant="outline" onPress={() => refetch()}>
          <Text>{t("common.retry")}</Text>
        </Button>
      </View>
    );
  }

  if (data.length === 0) {
    return <EmptyState onCreate={onCreate} t={t} />;
  }

  return (
    <View className="flex-1">
      {/* Search + toolbar row */}
      <View className="px-4 pt-2 pb-2 gap-2 border-b border-border">
        <View className="flex-row items-center gap-2">
          <View className="flex-1">
            <TextField
              value={search}
              onChangeText={setSearch}
              placeholder={t("projects.searchPlaceholder")}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              className="h-9"
            />
          </View>
          <FilterChip
            label={t("projects.filter")}
            active={activeFilterCount > 0}
            badge={activeFilterCount}
            icon="filter-outline"
            onPress={() => setFilterOpen((v) => !v)}
          />
          <SortPicker
            sortField={sortField}
            sortDirection={sortDirection}
            onChange={(field, direction) => setSort(field, direction)}
          />
        </View>

        {filterOpen ? (
          <View className="gap-2">
            <FilterRow
              label={t("projects.filterStatus")}
              options={PROJECT_STATUSES}
              selected={filters.statuses}
              onToggle={(v) => toggleFilter("statuses", v)}
              labelFor={(v) => projectStatusLabel(v as ProjectStatus)}
            />
            <FilterRow
              label={t("projects.filterPriority")}
              options={PROJECT_PRIORITIES}
              selected={filters.priorities}
              onToggle={(v) => toggleFilter("priorities", v)}
              labelFor={(v) => projectPriorityLabel(v as ProjectPriority)}
            />
            {leadOptions.length > 0 ? (
              <FilterRow
                label={t("projects.filterLead")}
                options={leadOptions.map((o) => o.value)}
                selected={filters.leads}
                onToggle={(v) => toggleFilter("leads", v)}
                labelFor={(v) => {
                  const opt = leadOptions.find((o) => o.value === v);
                  return opt ? `${opt.label} (${opt.count})` : v;
                }}
              />
            ) : null}
            {activeFilterCount > 0 ? (
              <Pressable
                onPress={clearFilters}
                accessibilityRole="button"
                className="self-start active:opacity-70"
              >
                <Text className="text-xs text-brand">
                  {t("projects.clearFilters")}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* View + column controls. The toggle is web's `viewMode` Tabs
            (projects-page.tsx:1210-1219) as a two-target segmented control;
            `列` only exists for the table, so a user who never leaves the card
            view is not shown a control that does nothing.
            The control sits in a `flex-1` wrapper rather than being sized by
            `justify-between`: its segments are `flexBasis: 0`, so left to
            itself it has no intrinsic width to divide and instead eats the
            row, pushing `列` off the right edge. */}
        <View className="flex-row items-center gap-2">
          <View className="flex-1">
            <SegmentedControl
              options={[
                {
                  value: "table",
                  label: t("projects.viewTable"),
                  a11yLabel: t("a11y.projectsViewTable"),
                  icon: "grid-outline",
                },
                {
                  value: "cards",
                  label: t("projects.viewCards"),
                  a11yLabel: t("a11y.projectsViewCards"),
                  icon: "albums-outline",
                },
              ]}
              value={viewMode}
              onChange={setViewMode}
            />
          </View>
          {viewMode === "table" ? (
            <Pressable
              onPress={() => setColumnMenuOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={t("table.columns")}
              className="flex-row items-center gap-1 rounded-md border border-border bg-secondary/50 px-2.5 py-1.5 active:opacity-70"
            >
              <Ionicons name="options-outline" size={14} color={theme.mutedForeground} />
              <Text className="text-xs text-muted-foreground">
                {t("table.columns")}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {visible.length !== data.length ? (
          <Text className="text-[11px] text-muted-foreground">
            {t("projects.resultsCount", { count: visible.length })}
          </Text>
        ) : null}
      </View>

      {viewMode === "table" ? (
        <ProjectTableView
          projects={visible}
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={setSort}
          columns={tableColumns}
          columnWidths={tableColumnWidths}
          onToggleColumn={toggleTableColumn}
          onResizeColumn={setTableColumnWidth}
          onReorderColumn={reorderTableColumn}
          onResetColumns={resetTableColumns}
          columnMenuOpen={columnMenuOpen}
          onColumnMenuClose={() => setColumnMenuOpen(false)}
          onOpenProject={(project) => {
            if (wsSlug) router.push(`/${wsSlug}/project/${project.id}`);
          }}
          selectionMode={selectionMode}
          selectedIds={selectedIds}
          onToggleSelected={toggleSelected}
          onEnterSelection={(id) => {
            if (!selectionMode) setSelectionMode(true);
            toggleSelected(id);
          }}
          refreshing={isRefetching}
          onRefresh={refetch}
        />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.id}
          ItemSeparatorComponent={ProjectSeparator}
          initialNumToRender={12}
          windowSize={9}
          maxToRenderPerBatch={10}
          updateCellsBatchingPeriod={40}
          ListEmptyComponent={
            <Text className="px-4 py-8 text-center text-sm text-muted-foreground">
              {t("projects.noMatches")}
            </Text>
          }
          renderItem={({ item }) => (
            <ProjectRow
              project={item}
              selectionMode={selectionMode}
              selected={selectedIds.has(item.id)}
              onLongPress={() => {
                if (!selectionMode) setSelectionMode(true);
                toggleSelected(item.id);
              }}
              onPress={() => {
                if (selectionMode) {
                  toggleSelected(item.id);
                  return;
                }
                if (wsSlug) router.push(`/${wsSlug}/project/${item.id}`);
              }}
            />
          )}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
          }
          contentContainerClassName="pb-6"
        />
      )}

      {/* Batch toolbar — pinned above the tab bar, mirrors the other lists */}
      {selectionMode ? (
        <View className="absolute bottom-4 left-4 right-4 rounded-lg border border-border bg-background px-3 py-2 shadow-lg flex-row items-center gap-3">
          <Pressable
            onPress={toggleSelectAll}
            accessibilityRole="button"
            className="active:opacity-70"
          >
            <Text className="text-xs text-brand">
              {allSelected
                ? t("projects.clearSelection")
                : t("projects.selectAll")}
            </Text>
          </Pressable>
          <Text className="text-xs text-muted-foreground">
            {t("projects.selectedCount", { count: selectedIds.size })}
          </Text>
          <View className="flex-1" />
          <Pressable
            onPress={handleBatchPin}
            accessibilityRole="button"
            disabled={batchPin.isPending || selectedIds.size === 0}
            className="p-1 active:opacity-70"
          >
            <Ionicons
              name="pin"
              size={18}
              color={anyUnpinnedSelected ? theme.brand : theme.mutedForeground}
            />
          </Pressable>
          {isWorkspaceAdmin ? (
            <Pressable
              onPress={confirmBatchDelete}
              accessibilityRole="button"
              disabled={batchDelete.isPending || selectedIds.size === 0}
              className="p-1 active:opacity-70"
            >
              <Ionicons
                name="trash-outline"
                size={18}
                color={theme.destructive}
              />
            </Pressable>
          ) : null}
          <Pressable
            onPress={exitSelectionMode}
            accessibilityRole="button"
            className="p-1 active:opacity-70"
          >
            <Ionicons name="close" size={18} color={theme.mutedForeground} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function FilterChip({
  label,
  active,
  badge,
  icon,
  onPress,
}: {
  label: string;
  active: boolean;
  badge: number;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
}) {
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={cn(
        "flex-row items-center gap-1 rounded-md border px-2 py-1.5 active:opacity-70",
        active ? "border-brand bg-brand/10" : "border-border bg-secondary/50",
      )}
    >
      <Ionicons
        name={icon}
        size={14}
        color={active ? THEME[colorScheme].brand : muted}
      />
      <Text
        className={cn(
          "text-xs",
          active ? "text-brand font-medium" : "text-muted-foreground",
        )}
      >
        {label}
        {badge > 0 ? ` (${badge})` : ""}
      </Text>
    </Pressable>
  );
}

const SORT_FIELD_LABEL: Record<ProjectSortField, string> = {
  name: "projects.sortName",
  priority: "projects.sortPriority",
  status: "projects.sortStatus",
  progress: "projects.sortProgress",
  created: "projects.sortCreated",
};

function SortPicker({
  sortField,
  sortDirection,
  onChange,
}: {
  sortField: ProjectSortField;
  sortDirection: "asc" | "desc";
  onChange: (field: ProjectSortField, direction: "asc" | "desc") => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;

  const options: {
    field: ProjectSortField;
    direction: "asc" | "desc";
    label: string;
  }[] = [];
  for (const field of PROJECT_SORT_FIELDS) {
    const defaultDir = PROJECT_SORT_DEFAULT_DIRECTION[field];
    options.push({ field, direction: defaultDir, label: t(SORT_FIELD_LABEL[field]) });
    if (sortField === field) {
      options.push({
        field,
        direction: defaultDir === "asc" ? "desc" : "asc",
        label: `${t(SORT_FIELD_LABEL[field])} (${defaultDir === "asc" ? t("projects.sortDescending") : t("projects.sortAscending")})`,
      });
    }
  }

  const openSortPicker = () => {
    const labels = options.map((o) => o.label);
    const cancelLabel = t("common.cancel");
    const cancelButtonIndex = labels.length;
    ActionSheet.showActionSheetWithOptions(
      {
        title: t("projects.sort"),
        options: [...labels, cancelLabel],
        cancelButtonIndex,
      },
      (index) => {
        if (index === undefined || index < 0 || index >= options.length) return;
        const option = options[index];
        onChange(option.field, option.direction);
      },
    );
  };

  const activeLabel =
    sortField === "created" && sortDirection === "desc"
      ? t(SORT_FIELD_LABEL.created)
      : `${t(SORT_FIELD_LABEL[sortField])} (${sortDirection === "asc" ? t("projects.sortAscending") : t("projects.sortDescending")})`;

  return (
    <Pressable
      onPress={openSortPicker}
      accessibilityRole="button"
      accessibilityLabel={t("projects.sort")}
      className="flex-row items-center gap-1 rounded-md border border-border bg-secondary/50 px-2 py-1.5 active:opacity-70"
    >
      <Ionicons name="swap-vertical" size={14} color={muted} />
      <Text className="text-xs text-muted-foreground" numberOfLines={1}>
        {activeLabel}
      </Text>
    </Pressable>
  );
}

function FilterRow({
  label,
  options,
  selected,
  onToggle,
  labelFor,
}: {
  label: string;
  options: readonly string[];
  selected: readonly string[];
  onToggle: (value: string) => void;
  labelFor: (value: string) => string;
}) {
  return (
    <View className="flex-row items-start gap-2">
      <Text className="mt-1.5 w-12 text-[11px] text-muted-foreground">
        {label}
      </Text>
      <View className="flex-1 flex-row flex-wrap gap-1.5">
        {options.map((value) => {
          const active = selected.includes(value);
          return (
            <Pressable
              key={value}
              onPress={() => onToggle(value)}
              accessibilityRole="button"
              accessibilityLabel={labelFor(value)}
              className={cn(
                "rounded-full border px-2.5 py-1 active:opacity-70",
                active
                  ? "border-brand bg-brand/10"
                  : "border-border bg-secondary/50",
              )}
            >
              <Text
                className={cn(
                  "text-[11px]",
                  active ? "text-brand font-medium" : "text-muted-foreground",
                )}
              >
                {labelFor(value)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function EmptyState({
  onCreate,
  t,
}: {
  onCreate: () => void;
  t: (id: string) => string;
}) {
  return (
    <View className="flex-1 items-center justify-center px-6 gap-4">
      <Text className="text-base font-medium text-foreground">
        {t("projects.emptyTitle")}
      </Text>
      <Text className="text-sm text-muted-foreground text-center">
        {t("projects.emptyMessage")}
      </Text>
      <Button variant="default" onPress={onCreate}>
        <Text>{t("projects.create")}</Text>
      </Button>
    </View>
  );
}

export function useCreateProject() {
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  return useCallback(() => {
    if (wsSlug) router.push(`/${wsSlug}/project/new`);
  }, [wsSlug]);
}
