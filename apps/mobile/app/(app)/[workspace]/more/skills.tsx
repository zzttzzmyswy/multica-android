/**
 * Workspace skills browse page (push screen reached from the More popover).
 * Mirrors web `packages/views/skills/components/skills-page.tsx` read
 * semantics, card-listed for the phone like the labels page: each row shows
 * the name, description, provenance badge (readOrigin), who uses it (web's
 * Used by cell), who added it, the relative updated time, and a small edit
 * affordance when the current user may edit the skill — with a read-only lock
 * when they may not (canEditSkill).
 *
 * Default order is web's view-store default: `updated` descending. Pull-to-
 * refresh + friendly empty/loading/error states matching the squads/labels
 * pages. The "+" header action opens the create form.
 *
 * Search / filter / sort (iteration 168): web spreads these across a toolbar
 * with four nested filter submenus and a display popover. A phone has no hover
 * tree, so the same state is driven by a search field, a filter chip that opens
 * one grouped multi-select sheet, and a sort chip — the shape the agents list
 * already uses. The predicates themselves live in lib/filter-skills.ts.
 *
 * Multi-select (MYS-1156): the header's checkbox icon enters selection mode,
 * a long-press on any row enters it with that row already selected (the same
 * gesture the issue lists use), and `SkillBatchBar` floats the batch actions
 * while anything is selected. Selection is session-local — web keeps it in
 * component state too, deliberately outside the persisted view store.
 */
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { create } from "zustand";
import type { Agent, MemberWithUser } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { TextField } from "@/components/ui/text-field";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { AvatarStack } from "@/components/ui/avatar-stack";
import { MultiSelectSheet } from "@/components/agent/multi-select-sheet";
import { SkillBatchBar } from "@/components/skill/skill-batch-bar";
import { skillListOptions } from "@/data/queries/skills";
import { agentListOptions } from "@/data/queries/agents";
import { memberListOptions } from "@/data/queries/members";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useAuthStore } from "@/data/auth-store";
import { ORIGIN_LABEL_KEY, readOrigin } from "@/lib/skill-guards";
import { toggleId, toggleSelectAllVisible } from "@/lib/skill-batch";
import {
  EMPTY_SKILL_FILTERS,
  SKILL_ORIGIN_TYPES,
  SKILL_SORT_DEFAULT_DIRECTION,
  SKILL_SORT_FIELDS,
  buildSkillRows,
  countActiveSkillFilterDimensions,
  filterSkillRows,
  parseSkillFilterKey,
  skillFilterKey,
  sortSkillRows,
  toggleSkillFilter,
  type SkillListFilters,
  type SkillRow,
  type SkillSortDirection,
  type SkillSortField,
} from "@/lib/filter-skills";
import { useSkillRole } from "@/lib/use-skill-role";
import { useTimeAgo } from "@/lib/time-ago";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { ActionSheet } from "@/lib/action-sheet";

const SORT_LABEL_KEY: Record<SkillSortField, string> = {
  name: "skills.list.sortField.name",
  usedBy: "skills.list.sortField.usedBy",
  updated: "skills.list.sortField.updated",
  created: "skills.list.sortField.created",
};

/**
 * Session-scoped search/sort/filter choice for the skills list. Deliberately
 * not persisted, matching the agents and projects lists: a phone has no header
 * row showing the active sort or the active filters, so a narrowed list that
 * survived a restart would look like missing data.
 */
interface SkillMobileViewState {
  sortField: SkillSortField;
  sortDirection: SkillSortDirection;
  filters: SkillListFilters;
  setSort: (field: SkillSortField, direction: SkillSortDirection) => void;
  toggleFilter: (key: string) => void;
  clearFilters: () => void;
}

export const useSkillMobileViewStore = create<SkillMobileViewState>()((set) => ({
  sortField: "updated",
  sortDirection: SKILL_SORT_DEFAULT_DIRECTION.updated,
  filters: EMPTY_SKILL_FILTERS,
  setSort: (sortField, sortDirection) => set({ sortField, sortDirection }),
  toggleFilter: (key) =>
    set((state) => {
      const parsed = parseSkillFilterKey(key);
      if (!parsed) return {};
      return {
        filters: toggleSkillFilter(state.filters, parsed.dimension, parsed.value),
      };
    }),
  clearFilters: () => set({ filters: EMPTY_SKILL_FILTERS }),
}));

export default function SkillsPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const role = useSkillRole(wsId);
  const userId = useAuthStore((s) => s.user?.id);

  const { data, isLoading, error, refetch, isRefetching } = useQuery(
    skillListOptions(wsId),
  );
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: members = [] } = useQuery(memberListOptions(wsId));

  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const sortField = useSkillMobileViewStore((s) => s.sortField);
  const sortDirection = useSkillMobileViewStore((s) => s.sortDirection);
  const filters = useSkillMobileViewStore((s) => s.filters);
  const setSort = useSkillMobileViewStore((s) => s.setSort);
  const toggleFilter = useSkillMobileViewStore((s) => s.toggleFilter);
  const clearFilters = useSkillMobileViewStore((s) => s.clearFilters);

  const skills = useMemo(() => data ?? [], [data]);

  const allRows = useMemo(
    () => buildSkillRows({ skills, agents, members, userId, role }),
    [skills, agents, members, userId, role],
  );

  const rows = useMemo(() => {
    const visible = filterSkillRows(allRows, { search, filters });
    return sortSkillRows(visible, sortField, sortDirection);
  }, [allRows, search, filters, sortField, sortDirection]);

  const narrowed =
    search.trim().length > 0 || countActiveSkillFilterDimensions(filters) > 0;
  const showEmpty = !isLoading && !error && skills.length === 0;

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const visibleIds = useMemo(() => rows.map((r) => r.skill.id), [rows]);
  // Selected rows are intersected with the visible set, so a row that left
  // the list (refetch, delete) can never ride along into a batch write.
  const selectedSkills = useMemo(
    () => rows.filter((r) => selectedIds.has(r.skill.id)).map((r) => r.skill),
    [rows, selectedIds],
  );

  const enterSelection = useCallback((id: string) => {
    setSelectionMode(true);
    setSelectedIds(new Set([id]));
  }, []);

  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggleRow = useCallback((id: string) => {
    setSelectedIds((prev) => toggleId(prev, id));
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds((prev) => toggleSelectAllVisible(visibleIds, prev));
  }, [visibleIds]);

  const headerRight = useCallback(() => {
    if (!wsSlug) return null;
    return (
      <View className="flex-row items-center">
        <IconButton
          name={selectionMode ? "close" : "checkbox-outline"}
          onPress={() => {
            if (selectionMode) exitSelection();
            else setSelectionMode(true);
          }}
          accessibilityLabel={
            selectionMode
              ? t("skills.batch.exitSelection")
              : t("skills.batch.enterSelection")
          }
        />
        <IconButton
          name="add"
          onPress={() => router.push(`/${wsSlug}/more/skills/new`)}
          accessibilityLabel={t("skills.createButton")}
        />
      </View>
    );
  }, [wsSlug, t, selectionMode, exitSelection]);

  return (
    <>
      <Stack.Screen options={{ headerRight }} />
      <View className="flex-1 bg-background">
        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator />
          </View>
        ) : error ? (
          <View className="px-4 gap-3 pt-4">
            <Text className="text-sm text-destructive">
              {t("skills.loadError")}
              {error instanceof Error ? error.message : t("common.unknownError")}
            </Text>
            <Button variant="outline" onPress={() => refetch()}>
              <Text>{t("workspace.retry")}</Text>
            </Button>
          </View>
        ) : showEmpty ? (
          <View className="flex-1 items-center justify-center px-6 gap-1">
            <Ionicons name="extension-puzzle-outline" size={32} color={muted} />
            <Text className="text-sm text-muted-foreground text-center mt-2">
              {t("skills.emptyTitle")}
            </Text>
            <Text className="text-xs text-muted-foreground/70 text-center">
              {t("skills.emptyDescription")}
            </Text>
            {wsSlug ? (
              <Button
                variant="outline"
                className="mt-3"
                onPress={() => router.push(`/${wsSlug}/more/skills/new`)}
              >
                <Ionicons name="add" size={15} color={muted} />
                <Text>{t("skills.createButton")}</Text>
              </Button>
            ) : null}
          </View>
        ) : (
          <>
            {/* Hidden in selection mode, like the batch bar's other hosts —
                the toolbar would compete with the actions for the same space. */}
            {!selectionMode ? (
              <View className="flex-row items-center gap-2 px-3 pt-2 pb-2">
                <View className="flex-1">
                  <TextField
                    value={search}
                    onChangeText={setSearch}
                    placeholder={t("skills.list.searchPlaceholder")}
                    autoCorrect={false}
                    autoCapitalize="none"
                    returnKeyType="search"
                    className="h-9"
                  />
                </View>
                {narrowed ? (
                  <Text
                    className="text-xs tabular-nums text-muted-foreground"
                    accessibilityLabel={t("skills.list.resultCount", {
                      visible: rows.length,
                      total: allRows.length,
                    })}
                  >
                    {t("skills.list.resultCount", {
                      visible: rows.length,
                      total: allRows.length,
                    })}
                  </Text>
                ) : null}
                <SkillFilterChip
                  activeCount={countActiveSkillFilterDimensions(filters)}
                  onPress={() => setFilterOpen(true)}
                />
                <SkillSortChip
                  sortField={sortField}
                  sortDirection={sortDirection}
                  onChange={setSort}
                />
              </View>
            ) : null}
            <FlatList
              data={rows}
              keyExtractor={(item) => item.skill.id}
              ItemSeparatorComponent={() => <View className="h-px bg-border ml-4" />}
              contentContainerStyle={{
                // Room for the floating batch bar so the last row stays tappable.
                paddingBottom:
                  selectionMode && selectedSkills.length > 0 ? 132 : 24,
              }}
              ListEmptyComponent={
                <Text className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {t("skills.list.noMatches")}
                </Text>
              }
              renderItem={({ item }) => (
                <SkillRowItem
                  row={item}
                  selectionMode={selectionMode}
                  selected={selectedIds.has(item.skill.id)}
                  onPressCheckbox={() => {
                    if (selectionMode) toggleRow(item.skill.id);
                    else enterSelection(item.skill.id);
                  }}
                  onPress={() => {
                    if (selectionMode) {
                      toggleRow(item.skill.id);
                    } else if (wsSlug) {
                      router.push(`/${wsSlug}/more/skills/${item.skill.id}`);
                    }
                  }}
                  onLongPress={() => enterSelection(item.skill.id)}
                />
              )}
              refreshing={isRefetching}
              onRefresh={refetch}
            />
          </>
        )}
        {selectionMode ? (
          <SkillBatchBar
            selectedSkills={selectedSkills}
            visibleIds={visibleIds}
            onToggleSelectAll={selectAll}
            onExit={exitSelection}
            onClear={() => setSelectedIds(new Set())}
          />
        ) : null}
      </View>
      <SkillFilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        rows={allRows}
        filters={filters}
        onToggle={toggleFilter}
        onClear={clearFilters}
      />
    </>
  );
}

/**
 * Filter chip. Carries only the number of active dimensions, never a label —
 * web does the same below `md`, and "1 filters" is what a phone would read
 * otherwise (the app's `translate` does not resolve plurals).
 */
function SkillFilterChip({
  activeCount,
  onPress,
}: {
  activeCount: number;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const active = activeCount > 0;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("skills.list.filter")}
      className={
        active
          ? "flex-row items-center gap-1 rounded-md border border-transparent bg-brand px-2 py-1.5 active:opacity-70"
          : "flex-row items-center gap-1 rounded-md border border-border bg-secondary/50 px-2 py-1.5 active:opacity-70"
      }
    >
      <Ionicons
        name="filter"
        size={14}
        color={active ? THEME[colorScheme].primaryForeground : muted}
      />
      {active ? (
        <Text
          className="text-xs font-medium tabular-nums"
          style={{ color: THEME[colorScheme].primaryForeground }}
        >
          {activeCount}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Sort chip — same field+direction pairing the agents list's picker uses, so
 *  the two lists offer their sort the same way. */
function SkillSortChip({
  sortField,
  sortDirection,
  onChange,
}: {
  sortField: SkillSortField;
  sortDirection: SkillSortDirection;
  onChange: (field: SkillSortField, direction: SkillSortDirection) => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;

  const options: {
    field: SkillSortField;
    direction: SkillSortDirection;
    label: string;
  }[] = [];
  for (const field of SKILL_SORT_FIELDS) {
    const defaultDir = SKILL_SORT_DEFAULT_DIRECTION[field];
    options.push({ field, direction: defaultDir, label: t(SORT_LABEL_KEY[field]) });
    if (sortField === field) {
      options.push({
        field,
        direction: defaultDir === "asc" ? "desc" : "asc",
        label: `${t(SORT_LABEL_KEY[field])} (${
          defaultDir === "asc"
            ? t("skills.list.sortDescending")
            : t("skills.list.sortAscending")
        })`,
      });
    }
  }

  const openSortPicker = () => {
    const labels = options.map((o) => o.label);
    ActionSheet.showActionSheetWithOptions(
      {
        title: t("skills.list.sort"),
        options: [...labels, t("common.cancel")],
        cancelButtonIndex: labels.length,
      },
      (index) => {
        if (index === undefined || index < 0 || index >= options.length) return;
        const option = options[index]!;
        onChange(option.field, option.direction);
      },
    );
  };

  const defaultDir = SKILL_SORT_DEFAULT_DIRECTION[sortField];
  const activeLabel =
    sortDirection === defaultDir
      ? t(SORT_LABEL_KEY[sortField])
      : `${t(SORT_LABEL_KEY[sortField])} (${
          sortDirection === "asc"
            ? t("skills.list.sortAscending")
            : t("skills.list.sortDescending")
        })`;

  return (
    <Pressable
      onPress={openSortPicker}
      accessibilityRole="button"
      accessibilityLabel={t("skills.list.sort")}
      className="flex-row items-center gap-1 rounded-md border border-border bg-secondary/50 px-2 py-1.5 active:opacity-70"
    >
      <Ionicons name="swap-vertical" size={14} color={muted} />
      <Text className="text-xs text-muted-foreground" numberOfLines={1}>
        {activeLabel}
      </Text>
    </Pressable>
  );
}

/**
 * The four filter dimensions as one grouped multi-select sheet.
 *
 * Web nests them under a Filter dropdown; on a phone they become labelled
 * groups of a single sheet, which is also what makes a cross-dimension search
 * possible. Option lists and their counts come from the *unfiltered* rows, so
 * toggling one dimension never makes the others' options vanish (web's
 * `allRows` contract).
 */
function SkillFilterSheet({
  visible,
  onClose,
  rows,
  filters,
  onToggle,
  onClear,
}: {
  visible: boolean;
  onClose: () => void;
  rows: SkillRow[];
  filters: SkillListFilters;
  onToggle: (key: string) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();

  const groups = useMemo(() => {
    const usedCount = rows.filter((r) => r.agents.length > 0).length;

    const originCounts = new Map<string, number>();
    const agentOptions = new Map<string, { agent: Agent; count: number }>();
    const creatorOptions = new Map<
      string,
      { member: MemberWithUser; count: number }
    >();
    for (const row of rows) {
      originCounts.set(row.originType, (originCounts.get(row.originType) ?? 0) + 1);
      for (const agent of row.agents) {
        const entry = agentOptions.get(agent.id);
        if (entry) entry.count += 1;
        else agentOptions.set(agent.id, { agent, count: 1 });
      }
      if (row.creator) {
        const entry = creatorOptions.get(row.creator.user_id);
        if (entry) entry.count += 1;
        else creatorOptions.set(row.creator.user_id, { member: row.creator, count: 1 });
      }
    }

    const withCount = (label: string, count: number) => `${label} · ${count}`;

    return [
      {
        label: t("skills.list.filterGroupUsage"),
        rows: [
          {
            key: skillFilterKey("usage", "used"),
            title: withCount(t("skills.list.usageUsed"), usedCount),
          },
          {
            key: skillFilterKey("usage", "unused"),
            title: withCount(t("skills.list.usageUnused"), rows.length - usedCount),
          },
        ],
      },
      {
        label: t("skills.list.filterGroupSource"),
        // Origins nobody uses are omitted rather than shown at 0 — web filters
        // its origin submenu the same way.
        rows: SKILL_ORIGIN_TYPES.filter((type) => originCounts.has(type)).map(
          (type) => ({
            key: skillFilterKey("origins", type),
            title: withCount(t(ORIGIN_LABEL_KEY[type]), originCounts.get(type) ?? 0),
          }),
        ),
      },
      {
        label: t("skills.list.filterGroupAgents"),
        rows: [...agentOptions.values()].map(({ agent, count }) => ({
          key: skillFilterKey("agents", agent.id),
          title: withCount(agent.name, count),
        })),
      },
      {
        label: t("skills.list.filterGroupCreators"),
        rows: [...creatorOptions.values()].map(({ member, count }) => ({
          key: skillFilterKey("creators", member.user_id),
          title: withCount(member.name, count),
        })),
      },
    ].filter((group) => group.rows.length > 0);
  }, [rows, t]);

  const selectedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const value of filters.usage) keys.add(skillFilterKey("usage", value));
    for (const value of filters.origins) keys.add(skillFilterKey("origins", value));
    for (const value of filters.agents) keys.add(skillFilterKey("agents", value));
    for (const value of filters.creators) keys.add(skillFilterKey("creators", value));
    return keys;
  }, [filters]);

  const hasActiveFilters = countActiveSkillFilterDimensions(filters) > 0;

  return (
    <MultiSelectSheet
      visible={visible}
      title={t("skills.list.filterTitle")}
      groups={groups}
      selectedKeys={selectedKeys}
      searchPlaceholder={t("skills.list.filterSearch")}
      emptyText={t("skills.list.noMatches")}
      noMatchText={t("skills.list.filterNoMatch")}
      leading={(row) => {
        const parsed = parseSkillFilterKey(row.key);
        if (!parsed || parsed.dimension === "usage" || parsed.dimension === "origins") {
          return null;
        }
        return (
          <ActorAvatar
            type={parsed.dimension === "agents" ? "agent" : "member"}
            id={parsed.value}
            size={24}
          />
        );
      }}
      onToggle={onToggle}
      onClose={onClose}
      footer={
        hasActiveFilters ? (
          <Pressable
            onPress={onClear}
            accessibilityRole="button"
            className="py-3 active:opacity-70"
          >
            <Text className="text-center text-sm text-destructive">
              {t("skills.list.filterClear")}
            </Text>
          </Pressable>
        ) : null
      }
    />
  );
}

function SkillRowItem({
  row,
  selectionMode,
  selected,
  onPressCheckbox,
  onPress,
  onLongPress,
}: {
  row: SkillRow;
  selectionMode: boolean;
  selected: boolean;
  onPressCheckbox: () => void;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const theme = THEME[colorScheme];
  const timeAgo = useTimeAgo();
  const { skill, agents, creator, canEdit } = row;
  const origin = ORIGIN_LABEL_KEY[readOrigin(skill).type];

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      className={selected ? "px-4 py-3 bg-secondary/60" : "px-4 py-3 active:bg-secondary"}
    >
      <View className="flex-row items-center gap-3">
        {selectionMode ? (
          <Pressable
            onPress={onPressCheckbox}
            hitSlop={8}
            accessibilityLabel={t("skills.batch.selectOne", { name: skill.name })}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected }}
          >
            <Ionicons
              name={selected ? "checkbox" : "square-outline"}
              size={20}
              color={selected ? theme.primary : muted}
            />
          </Pressable>
        ) : (
          <View className="size-8 rounded-lg bg-secondary items-center justify-center">
            <Ionicons name="extension-puzzle" size={16} color={muted} />
          </View>
        )}
        <View className="flex-1 min-w-0 gap-0.5">
          <View className="flex-row items-center gap-1.5">
            <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
              {skill.name}
            </Text>
            <View className="px-1.5 py-px rounded-full bg-secondary">
              <Text className="text-[10px] text-muted-foreground font-medium">
                {t(origin)}
              </Text>
            </View>
            {/* Web shows the lock on rows the viewer cannot edit and nothing on
                the ones they can; the pencil is this list's own "you may edit
                this" affordance, so the two read as a pair. */}
            {canEdit ? (
              <Ionicons name="pencil" size={11} color={muted} />
            ) : (
              <Ionicons
                name="lock-closed"
                size={11}
                color={muted}
                accessibilityLabel={t("skills.list.lockTooltip")}
              />
            )}
          </View>
          {skill.description ? (
            <Text
              className="text-xs text-muted-foreground/70"
              numberOfLines={1}
            >
              {skill.description}
            </Text>
          ) : null}
          <View className="flex-row items-center gap-2">
            <UsedBy agents={agents} />
            {creator ? (
              <Text className="text-[11px] text-muted-foreground/60" numberOfLines={1}>
                {t("skills.list.addedBy", { name: creator.name })}
              </Text>
            ) : null}
          </View>
          {skill.updated_at ? (
            <Text className="text-[11px] text-muted-foreground/60">
              {t("skills.detail.updatedAt")} {timeAgo(skill.updated_at)}
            </Text>
          ) : null}
        </View>
        {selectionMode ? null : (
          <Ionicons name="chevron-forward" size={14} color={muted} />
        )}
      </View>
    </Pressable>
  );
}

/**
 * Web's Used by cell: the sole agent's avatar + name, an overlapping stack of
 * up to three plus `+N`, or an explicit "unused" — never a bare blank, which
 * would be indistinguishable from a skill whose agents have not loaded.
 */
function UsedBy({ agents }: { agents: Agent[] }) {
  const { t } = useTranslation();

  if (agents.length === 0) {
    return (
      <Text className="text-[11px] text-muted-foreground/60">
        {t("skills.list.unused")}
      </Text>
    );
  }

  const sole = agents.length === 1 ? agents[0]! : null;
  if (sole) {
    return (
      <View className="flex-row items-center gap-1">
        <ActorAvatar type="agent" id={sole.id} size={16} />
        <Text
          className="text-[11px] text-muted-foreground/60"
          numberOfLines={1}
        >
          {sole.name}
        </Text>
      </View>
    );
  }

  return (
    <AvatarStack
      actors={agents.map((agent) => ({ type: "agent" as const, id: agent.id }))}
      max={3}
      size={16}
      ringClassName="bg-background"
    />
  );
}
