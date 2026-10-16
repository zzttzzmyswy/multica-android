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
 *
 * Row actions (iteration 230, MYS-2097): each row gained the kebab web's
 * `SkillRowActions` renders — add to agent / refresh / delete. Before this the
 * row's only exit was `router.push` to the detail page, so refreshing one of
 * this deployment's 18 GitHub-sourced skills meant opening it first. The items
 * and their gates live in `lib/skill-row-actions.ts`; the writes live here so
 * the kebab and the batch bar share them.
 */
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { create } from "zustand";
import type { Agent, MemberWithUser, SkillSummary } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { HeaderSearchGroup } from "@/components/ui/header-search-button";
import { TextField } from "@/components/ui/text-field";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { AvatarStack } from "@/components/ui/avatar-stack";
import { MultiSelectSheet } from "@/components/agent/multi-select-sheet";
import { AddToAgentsSheet } from "@/components/skill/add-to-agents-sheet";
import { SkillBatchBar } from "@/components/skill/skill-batch-bar";
import { SkillRowMenu } from "@/components/skill/skill-row-menu";
import { SupportingDataWarning } from "@/components/skill/supporting-data-warning";
import { skillListOptions } from "@/data/queries/skills";
import { useDeleteSkill, useRefreshSkill } from "@/data/mutations/skills";
import { agentListOptions } from "@/data/queries/agents";
import { memberListOptions } from "@/data/queries/members";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useAuthStore } from "@/data/auth-store";
import { ORIGIN_LABEL_KEY, readOrigin } from "@/lib/skill-guards";
import { toggleId, batchOutcomeMessage, toggleSelectAllVisible } from "@/lib/skill-batch";
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
import { catalogRead, retryCatalogs } from "@/lib/catalog-read";
import { aggregateCatalogState } from "@/lib/catalog-state";
import type { CatalogState } from "@/lib/catalog-state";
import {
  skillLockCell,
  supportingDataWarningVisible,
  usedByCell,
} from "@/lib/skill-supporting-data";

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
  const agentsRead = catalogRead(useQuery(agentListOptions(wsId)));
  const membersRead = catalogRead(useQuery(memberListOptions(wsId)));
  const agents = agentsRead.items;
  const members = membersRead.items;

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
    () =>
      buildSkillRows({
        skills,
        agents,
        members,
        userId,
        role,
        // The row's cells may only state an absence once the directory they
        // resolve through answered (MYS-2192) — `error` and `loading` alike
        // leave a zero unread, and the cells say so instead of 「未使用」.
        agentsResolved: agentsRead.isResolved,
        membersResolved: membersRead.isResolved,
      }),
    [
      skills,
      agents,
      members,
      userId,
      role,
      agentsRead.isResolved,
      membersRead.isResolved,
    ],
  );

  const rows = useMemo(() => {
    const visible = filterSkillRows(allRows, { search, filters });
    return sortSkillRows(visible, sortField, sortDirection);
  }, [allRows, search, filters, sortField, sortDirection]);

  const narrowed =
    search.trim().length > 0 || countActiveSkillFilterDimensions(filters) > 0;
  const showEmpty = !isLoading && !error && skills.length === 0;

  // ── Row actions (MYS-2097) ──────────────────────────────────────────────
  // Web's list carries a per-row kebab (add to agent / refresh / delete);
  // mobile's rows had no action at all, so refreshing one of this deployment's
  // 18 GitHub-sourced skills meant opening it first. The writes live HERE so
  // the kebab and the batch bar share one implementation — web's split exactly,
  // where the dialogs are defined once and mounted by both `SkillRowActions`
  // and `SkillBatchToolbar`.
  const refreshSkill = useRefreshSkill();
  const deleteSkill = useDeleteSkill();
  // One row the shared add-to-agent sheet is open for, or `null`. The kebab is
  // the only entry point on the list that adds (the batch bar owns its own), so
  // this holds at most one row.
  const [addTarget, setAddTarget] = useState<SkillSummary | null>(null);

  /**
   * The refresh confirm, worded exactly as the detail page's `handleRefresh` —
   * the same `skills.detail.refreshConfirm*` keys, assembled the same way. The
   * warning is the load-bearing half: refreshing overwrites SKILL.md and the
   * whole file set from upstream, so local edits do not survive, and web says
   * so in an amber callout (`refresh-skill-dialog.tsx`'s `dialog.warning`).
   */
  const handleRefresh = useCallback(
    (row: SkillRow) => {
      if (refreshSkill.isPending) return;
      const skill = row.skill;
      const origin = readOrigin(skill);
      const source = t(ORIGIN_LABEL_KEY[origin.type]);
      const body = t("skills.detail.refreshConfirmBody", {
        name: skill.name,
        source,
      });
      Alert.alert(
        t("skills.detail.refreshConfirmTitle"),
        `${body}\n\n${t("skills.detail.refreshConfirmWarning")}`,
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("skills.detail.refresh"),
            onPress: () =>
              refreshSkill.mutate(skill.id, {
                onSuccess: () =>
                  Alert.alert(t("skills.detail.refreshSuccess", { source })),
                onError: (err) =>
                  Alert.alert(
                    t("skills.detail.refreshFailed"),
                    err instanceof Error
                      ? err.message
                      : t("common.unknownError"),
                  ),
              }),
          },
        ],
      );
    },
    [refreshSkill, t],
  );

  /**
   * The delete confirm. A single row reads as the singular sentence (web's
   * `DeleteSkillsDialog` branches on `rows.length === 1` for exactly this
   * reason), which is why the kebab and the batch bar's one-row case share
   * `skills.deleteTitle` / `skills.deleteMessage` rather than the batch pair.
   */
  const handleDelete = useCallback(
    (row: SkillRow) => {
      if (deleteSkill.isPending) return;
      const skill = row.skill;
      Alert.alert(
        t("skills.deleteTitle"),
        t("skills.deleteMessage", { name: skill.name }),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("skills.delete"),
            style: "destructive",
            onPress: () =>
              deleteSkill.mutate(skill.id, {
                onError: (err) =>
                  Alert.alert(
                    t("skills.deleteFailed"),
                    err instanceof Error
                      ? err.message
                      : t("common.unknownError"),
                  ),
              }),
          },
        ],
      );
    },
    [deleteSkill, t],
  );

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
    // Search survives every state here, including selection mode: unlike the
    // agents list this one keeps its "add" action while selecting, so the
    // strip is not a mode of its own.
    if (!wsSlug) return <HeaderSearchGroup />;
    return (
      <HeaderSearchGroup>
        <View className="flex-row items-center gap-2">
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
      </HeaderSearchGroup>
    );
  }, [wsSlug, t, selectionMode, exitSelection]);

  return (
    <>
      <Stack.Screen options={{ headerRight }} />
      <View className="flex-1 bg-background">
        {/* Supporting-data degradation (MYS-2192). Above every branch below —
            loading, error, empty, list — because web puts it above them too
            (`skills-page.tsx:802`): the strip explains cells that are rendered
            in the list branch, and suppressing it in the others would make the
            one failure that matters the one that goes unmentioned. */}
        {supportingDataWarningVisible({
          agents: agentsRead.state,
          members: membersRead.state,
        }) ? (
          <SupportingDataWarning
            message={t("skills.list.supportingDataWarning")}
          />
        ) : null}
        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator />
          </View>
        ) : error ? (
          <View className="px-4 gap-3 pt-4">
            <Text className="text-body text-destructive">
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
            <Text className="text-body text-muted-foreground text-center mt-2">
              {t("skills.emptyTitle")}
            </Text>
            <Text className="text-caption text-muted-foreground/70 text-center">
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
                    className="text-caption tabular-nums text-muted-foreground"
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
                <Text className="px-4 py-8 text-center text-body text-muted-foreground">
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
                  onAddToAgent={() => setAddTarget(item.skill)}
                  onRefresh={() => handleRefresh(item)}
                  onDelete={() => handleDelete(item)}
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
      {/* One row's add-to-agent sheet. Shares its implementation with the batch
          bar (`AddToAgentsSheet`), so a single row and a whole selection attach
          the same way; only the feedback channel differs (an Alert here, the
          bar's in-bar toast there), which is why this one reports its own
          outcome instead of leaving it to the bar. */}
      <AddToAgentsSheet
        visible={addTarget !== null}
        skills={addTarget ? [addTarget] : []}
        onClose={() => setAddTarget(null)}
        onResult={(outcome) => {
          const message = batchOutcomeMessage(outcome, {
            success: (done) => t("skills.usedBy.addedMulti", { count: done }),
            failure: (done, failed, first) =>
              t("skills.batch.addPartial", { done, failed, message: first }),
          });
          Alert.alert(
            outcome.failures.length === 0
              ? t("skills.usedBy.add")
              : t("skills.usedBy.addFailed"),
            message ?? t("skills.usedBy.addFailed"),
          );
        }}
        onError={(err) =>
          Alert.alert(
            t("skills.usedBy.addFailed"),
            err instanceof Error ? err.message : t("common.unknownError"),
          )
        }
      />
      <SkillFilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        rows={allRows}
        state={aggregateCatalogState([agentsRead.state, membersRead.state])}
        onRetry={() => retryCatalogs(agentsRead, membersRead)}
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
          className="text-caption font-medium tabular-nums"
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
      <Text className="text-caption text-muted-foreground" numberOfLines={1}>
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
  state,
  onRetry,
  filters,
  onToggle,
  onClear,
}: {
  visible: boolean;
  onClose: () => void;
  rows: SkillRow[];
  /** Load state over the directories the option labels resolve through (agent
   *  and member name maps). A failed read left the sheet claiming 「无匹配结果。」
   *  about a filter it had never managed to build. */
  state?: CatalogState;
  onRetry?: () => void;
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
      state={state}
      onRetry={onRetry}
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
            <Text className="text-center text-body text-destructive">
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
  onAddToAgent,
  onRefresh,
  onDelete,
}: {
  row: SkillRow;
  selectionMode: boolean;
  selected: boolean;
  onPressCheckbox: () => void;
  onPress: () => void;
  onLongPress: () => void;
  onAddToAgent: () => void;
  onRefresh: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const theme = THEME[colorScheme];
  const timeAgo = useTimeAgo();
  const { skill, agents, creator, canEdit, agentsResolved, membersResolved } = row;
  const lockVerdict = skillLockCell(canEdit, membersResolved);
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
            <Text className="text-body font-medium text-foreground" numberOfLines={1}>
              {skill.name}
            </Text>
            <View className="px-1.5 py-px rounded-full bg-secondary">
              <Text className="text-micro text-muted-foreground font-medium">
                {t(origin)}
              </Text>
            </View>
            {/* Web shows the lock on rows the viewer cannot edit and nothing on
                the ones they can; the pencil is this list's own "you may edit
                this" affordance, so the two read as a pair.

                MYS-2192: the lock is a CONCLUSION, and under a members read
                that has not answered it is an unsupported one — `canEditSkill`
                falls back to `created_by === userId`, so a failed read locks
                every skill the viewer did not create. Rather than restate that
                as fact, the row draws neither glyph (`skillLockCell`), and the
                banner above the list names the failure. Drawing the pencil
                instead would advertise an edit the server may reject. */}
            {lockVerdict === "pencil" ? (
              <Ionicons name="pencil" size={11} color={muted} />
            ) : lockVerdict === "lock" ? (
              <Ionicons
                name="lock-closed"
                size={11}
                color={muted}
                accessibilityLabel={t("skills.list.lockTooltip")}
              />
            ) : null}
          </View>
          {skill.description ? (
            <Text
              className="text-caption text-muted-foreground/70"
              numberOfLines={1}
            >
              {skill.description}
            </Text>
          ) : null}
          <View className="flex-row items-center gap-2">
            <UsedBy agents={agents} resolved={agentsResolved} />
            {creator ? (
              <Text className="text-micro text-muted-foreground/60" numberOfLines={1}>
                {t("skills.list.addedBy", { name: creator.name })}
              </Text>
            ) : null}
          </View>
          {skill.updated_at ? (
            <Text className="text-micro text-muted-foreground/60">
              {t("skills.detail.updatedAt")} {timeAgo(skill.updated_at)}
            </Text>
          ) : null}
        </View>
        {selectionMode ? null : (
          <Ionicons name="chevron-forward" size={14} color={muted} />
        )}
        {/* Row actions (MYS-2097). The trigger claims the touch responder, so
            opening the sheet never falls through to the row's own onPress —
            tapping elsewhere on the row still navigates. In selection mode the
            kebab gives way to the checkbox: a row carries one trailing control,
            and picking is what the mode is for (the same rule the autopilots
            list follows). */}
        {selectionMode ? null : (
          <SkillRowMenu
            row={row}
            onAddToAgent={onAddToAgent}
            onRefresh={onRefresh}
            onDelete={onDelete}
          />
        )}
      </View>
    </Pressable>
  );
}

/**
 * Web's Used by cell: the sole agent's avatar + name, an overlapping stack of
 * up to three plus `+N`, or an explicit "unused" — never a bare blank, which
 * would be indistinguishable from a skill whose agents have not loaded.
 *
 * MYS-2192 widened that last clause from a layout remark into a rule. Web's
 * cell renders 「unused」 for any zero-length list, and on the desktop that is
 * legible because a page-level warning strip sits above it whenever the agents
 * read failed (`skills-page.tsx:778`). A phone has the strip too now, but the
 * row must stop making the claim on its own: `resolved` is the agents
 * directory's settlement, and an unsettled directory turns the would-be
 * absence into `usedByUnknown` — the same "value not known" wording the app
 * already uses for the filter's usage facet, rather than a count nobody
 * measured.
 */
function UsedBy({ agents, resolved }: { agents: Agent[]; resolved: boolean }) {
  const { t } = useTranslation();

  const verdict = usedByCell(agents.length, resolved);

  if (verdict === "unknown") {
    return (
      <Text className="text-micro text-muted-foreground/60">
        {t("skills.list.usedByUnknown")}
      </Text>
    );
  }

  if (verdict === "unused") {
    return (
      <Text className="text-micro text-muted-foreground/60">
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
          className="text-micro text-muted-foreground/60"
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
