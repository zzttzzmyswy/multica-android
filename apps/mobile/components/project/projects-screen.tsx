/**
 * Shared projects browser — the list body only (loading / error / empty /
 * rows), no screen chrome. Used by both the "Projects" bottom-tab
 * (`(tabs)/projects.tsx`, which draws its own `<Header>`) and the
 * `more/projects` push screen (native Stack header). The `+` create action
 * is a prop: each host renders it where that route's header lives, so we
 * never double-draw a title bar.
 *
 * Search / filter / sort / multi-select (web projects-page parity,
 * MYS-1020): a search field, status + priority filter chips, a sort picker
 * (5 fields × direction), and a batch toolbar (pin/unpin any member, delete
 * workspace admin) that appears in long-press selection mode. Sort + filter
 * state lives in a session store; search and selection stay session-local
 * like web. Leads filtering stays web-only — the phone width has no room
 * for a lead picker and the lead column isn't rendered here.
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
import type {
  Project,
  ProjectPriority,
  ProjectStatus,
} from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { ProjectRow } from "@/components/project/project-row";
import { projectListOptions } from "@/data/queries/projects";
import { pinListOptions } from "@/data/queries/pins";
import { memberListOptions } from "@/data/queries/members";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useAuthStore } from "@/data/auth-store";
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
  sortProjects,
  toggleInList,
  type ProjectListFilters,
  type ProjectSortField,
} from "@/lib/filter-projects";

// Sort + filter dimensions persist for the session; web persists these in
// its view store but a session-scoped store keeps the phone honest when a
// teammate re-shares a filter — and matches how mobile's issue list treats
// filters (see data/stores/issue-filter-slice.ts).
interface ProjectMobileViewState {
  sortField: ProjectSortField;
  sortDirection: "asc" | "desc";
  filters: ProjectListFilters;
  setSort: (field: ProjectSortField, direction: "asc" | "desc") => void;
  toggleFilter: (key: "statuses" | "priorities", value: string) => void;
  clearFilters: () => void;
}

const DEFAULT_VIEW = {
  sortField: "created" as ProjectSortField,
  sortDirection: PROJECT_SORT_DEFAULT_DIRECTION.created,
  filters: EMPTY_PROJECT_FILTERS,
};

export const useProjectMobileViewStore = create<ProjectMobileViewState>()(
  (set) => ({
    ...DEFAULT_VIEW,
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
  const setSort = useProjectMobileViewStore((s) => s.setSort);
  const toggleFilter = useProjectMobileViewStore((s) => s.toggleFilter);
  const clearFilters = useProjectMobileViewStore((s) => s.clearFilters);

  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
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

        {visible.length !== data.length ? (
          <Text className="text-[11px] text-muted-foreground">
            {t("projects.resultsCount", { count: visible.length })}
          </Text>
        ) : null}
      </View>

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
