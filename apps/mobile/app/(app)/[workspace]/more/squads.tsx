/**
 * Squads browse page (push screen reached from the More popover). Mirrors
 * web `packages/views/squads/components/squads-page.tsx` read semantics,
 * card-listed for the phone: one row per squad — name, leader agent, member
 * count. Archived squads render dimmed and sort last. Pull-to-refresh +
 * friendly empty state. Tapping a row pushes the squad detail page.
 *
 * Scope pills (iteration-127) mirror web's toolbar scope switcher: `mine` /
 * `all`, keyed on `creator_id` (web's ownership lens — a squad's creator is
 * not its leader and holds no management rights), badge counts computed over
 * the unfiltered list so they don't move on switch. Defaults to `mine`, like
 * web's `DEFAULTS.scope`. The scope is session-local (not persisted): a
 * stored `mine` on a phone that later switches account would open an
 * unexplained empty list, the same reasoning web applies to
 * `agentRunningFilter`.
 *
 * Sort / filter / count (iteration-178) port the rest of web's
 * `SquadListToolbar`. A phone has no header row to click and no columns to
 * hide, so the toolbar becomes the shape the agents and skills lists already
 * use: a sort chip that opens an ActionSheet of field + direction options, a
 * filter chip that opens one grouped multi-select sheet, and the `n / total`
 * indicator web shows once a filter is active. The predicates and comparators
 * live in `lib/filter-squads.ts`; only sort + filters persist (see
 * `data/stores/squads-view-store.ts` for why scope and columns do not).
 *
 * The header "+" (create) only shows for workspace owner/admin — matching
 * the iteration-27 scope; the server remains the real gate for who may
 * create (any member may create server-side, but mobile keeps the surface
 * admin-facing per MYS-304).
 */
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Squad } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { MultiSelectSheet } from "@/components/agent/multi-select-sheet";
import { squadListOptions } from "@/data/queries/squads";
import { memberListOptions } from "@/data/queries/members";
import { agentListAllOptions } from "@/data/queries/agents";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useAuthStore } from "@/data/auth-store";
import { useActorLookup } from "@/data/use-actor-name";
import { useSquadsView, useSquadsViewStore } from "@/data/stores/squads-view-store";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { ActionSheet } from "@/lib/action-sheet";
import {
  SQUAD_SCOPES,
  SQUAD_SCOPE_LABEL_KEYS,
  SQUAD_SORT_DEFAULT_DIRECTION,
  SQUAD_SORT_FIELDS,
  countActiveSquadFilterDimensions,
  filterSquadsByFilters,
  filterSquadsByScope,
  isSquadArchived,
  parseSquadFilterKey,
  squadCreatorOptions,
  squadFilterKey,
  squadLeaderOptions,
  squadMemberCount,
  squadScopeCounts,
  sortSquads,
  type SquadSortDirection,
  type SquadSortField,
  type SquadsScope,
} from "@/lib/filter-squads";

const SORT_LABEL_KEY: Record<SquadSortField, string> = {
  name: "squads.list.sortField.name",
  members: "squads.list.sortField.members",
  created: "squads.list.sortField.created",
};

export default function SquadsPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const user = useAuthStore((s) => s.user);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const { getName } = useActorLookup();

  const { data, isLoading, error, refetch, isRefetching } = useQuery(
    squadListOptions(wsId),
  );
  const members = useQuery(memberListOptions(wsId));
  // Archived-inclusive, so a filter option for a retired leader agent still
  // renders its real name instead of an id stub.
  const { data: agents = [] } = useQuery(agentListAllOptions(wsId));
  const currentMember = members.data?.find((m) => m.user_id === user?.id);
  const isAdmin =
    currentMember?.role === "owner" || currentMember?.role === "admin";

  const [scope, setScope] = useState<SquadsScope>("mine");
  const [filterOpen, setFilterOpen] = useState(false);

  const view = useSquadsView(wsId);
  const { sortField, sortDirection, filters } = view;
  const setSortInStore = useSquadsViewStore((s) => s.setSort);
  const toggleFilterInStore = useSquadsViewStore((s) => s.toggleFilter);
  const clearFiltersInStore = useSquadsViewStore((s) => s.clearFilters);

  const setSort = useCallback(
    (field: SquadSortField, direction: SquadSortDirection) => {
      if (wsId) setSortInStore(wsId, field, direction);
    },
    [wsId, setSortInStore],
  );
  const toggleFilter = useCallback(
    (key: string) => {
      if (wsId) toggleFilterInStore(wsId, key);
    },
    [wsId, toggleFilterInStore],
  );
  const clearFilters = useCallback(() => {
    if (wsId) clearFiltersInStore(wsId);
  }, [wsId, clearFiltersInStore]);

  // Rows within the scope, unfiltered — the option lists and the "n / total"
  // denominator both read this (web's `scopeRows`), so unchecking a leader
  // never makes the other leader options disappear.
  const scopeRows = useMemo(
    () => filterSquadsByScope(data ?? [], scope, user?.id ?? null),
    [data, scope, user?.id],
  );

  const sorted = useMemo(() => {
    const visible = filterSquadsByFilters(scopeRows, filters);
    return sortSquads(visible, sortField, sortDirection);
  }, [scopeRows, filters, sortField, sortDirection]);

  // Filter-option names resolve through raw maps rather than `useActorLookup`,
  // which substitutes "Unknown Agent" / "Unknown" for a missing id — web falls
  // back to the id stub (`id.slice(0, 8)`) instead, and an option list reading
  // "Unknown Agent · 3" three times is worse than a short id.
  const agentNames = useMemo(
    () => new Map(agents.map((a) => [a.id, a.name])),
    [agents],
  );
  const memberNames = useMemo(
    () => new Map((members.data ?? []).map((m) => [m.user_id, m.name])),
    [members.data],
  );

  const leaderOptions = useMemo(
    () => squadLeaderOptions(scopeRows, (id) => agentNames.get(id)),
    [scopeRows, agentNames],
  );
  const creatorOptions = useMemo(
    () => squadCreatorOptions(scopeRows, (id) => memberNames.get(id)),
    [scopeRows, memberNames],
  );

  // Counts run over the FULL list — switching scope must not move a badge.
  const scopeCounts = useMemo(
    () => squadScopeCounts(data ?? [], user?.id ?? null),
    [data, user?.id],
  );

  const activeFilterCount = countActiveSquadFilterDimensions(filters);
  const loaded = !isLoading && !error;
  const totalCount = (data ?? []).length;
  // Two distinct empty screens: nothing in the workspace at all, vs. nothing
  // the user made. The second one names the scope that produced it and points
  // at the way out, so an empty list is never unexplained.
  const showEmpty = loaded && totalCount === 0;
  const showScopeEmpty = loaded && totalCount > 0 && sorted.length === 0;

  const headerRight = useCallback(() => {
    if (!wsSlug || !isAdmin) return null;
    return (
      <IconButton
        name="add"
        onPress={() => router.push(`/${wsSlug}/more/squads/new`)}
        accessibilityLabel={t("squads.new.title")}
      />
    );
  }, [wsSlug, isAdmin, t]);

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
              {t("squads.loadError")}
              {error instanceof Error ? error.message : t("common.unknownError")}
            </Text>
            <Button variant="outline" onPress={() => refetch()}>
              <Text>{t("workspace.retry")}</Text>
            </Button>
          </View>
        ) : showEmpty ? (
          <View className="flex-1 items-center justify-center px-6 gap-1">
            <Ionicons name="people-circle-outline" size={32} color={muted} />
            <Text className="text-sm text-muted-foreground text-center mt-2">
              {t("squads.emptyTitle")}
            </Text>
            <Text className="text-xs text-muted-foreground/70 text-center">
              {t("squads.emptyDescription")}
            </Text>
            {isAdmin && wsSlug ? (
              <Button
                variant="outline"
                className="mt-3"
                onPress={() => router.push(`/${wsSlug}/more/squads/new`)}
              >
                <Ionicons name="add" size={15} color={muted} />
                <Text>{t("squads.createButton")}</Text>
              </Button>
            ) : null}
          </View>
        ) : (
          <View className="flex-1">
            <SquadScopeBar
              scope={scope}
              counts={scopeCounts}
              onChange={setScope}
            />
            {/* Toolbar sits under the scope pills so a phone keeps the same
                reading order as web's single toolbar row: lens, then the
                controls that narrow the rows it produced. */}
            <View className="flex-row items-center gap-2 px-4 pb-2">
              {activeFilterCount > 0 ? (
                <Text
                  className="text-xs tabular-nums text-muted-foreground"
                  accessibilityLabel={t("squads.list.resultCount", {
                    visible: sorted.length,
                    total: scopeRows.length,
                  })}
                >
                  {t("squads.list.resultCount", {
                    visible: sorted.length,
                    total: scopeRows.length,
                  })}
                </Text>
              ) : null}
              <View className="flex-1" />
              <SquadFilterChip
                activeCount={activeFilterCount}
                onPress={() => setFilterOpen(true)}
                onClear={clearFilters}
              />
              <SquadSortChip
                sortField={sortField}
                sortDirection={sortDirection}
                onChange={setSort}
              />
            </View>
            {showScopeEmpty ? (
              <View className="flex-1 items-center justify-center px-6 gap-1">
                <Ionicons name="people-circle-outline" size={32} color={muted} />
                <Text className="text-sm text-muted-foreground text-center mt-2">
                  {activeFilterCount > 0
                    ? t("squads.list.noMatches")
                    : t("squads.scopeEmptyMine")}
                </Text>
                {activeFilterCount > 0 ? (
                  <Button
                    variant="outline"
                    className="mt-3"
                    onPress={clearFilters}
                  >
                    <Text>{t("squads.list.filterClear")}</Text>
                  </Button>
                ) : (
                  <>
                    <Text className="text-xs text-muted-foreground/70 text-center">
                      {scope === "mine"
                        ? t("squads.scopeEmptyMineHint")
                        : t("squads.emptyDescription")}
                    </Text>
                    {scope === "mine" ? (
                      <Button
                        variant="outline"
                        className="mt-3"
                        onPress={() => setScope("all")}
                      >
                        <Text>{t("squads.scope.all")}</Text>
                      </Button>
                    ) : null}
                  </>
                )}
              </View>
            ) : (
              <FlatList
                data={sorted}
                keyExtractor={(item) => item.id}
                ItemSeparatorComponent={() => <View className="h-px bg-border ml-4" />}
                contentContainerClassName="pb-6"
                renderItem={({ item }) => (
                  <SquadRow
                    squad={item}
                    leaderName={getName("agent", item.leader_id)}
                    onPress={() => {
                      if (wsSlug) router.push(`/${wsSlug}/more/squads/${item.id}`);
                    }}
                  />
                )}
                refreshing={isRefetching}
                onRefresh={refetch}
              />
            )}
          </View>
        )}
      </View>
      <SquadFilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        leaderOptions={leaderOptions}
        creatorOptions={creatorOptions}
        filters={filters}
        onToggle={toggleFilter}
        onClear={clearFilters}
      />
    </>
  );
}

/**
 * Scope switcher, mirroring web's `SquadListToolbar` pill group (the
 * desktop variant; web's phone-width dropdown has no mobile analogue since
 * two pills fit at any phone width). Each pill carries its count over the
 * full list.
 */
function SquadScopeBar({
  scope,
  counts,
  onChange,
}: {
  scope: SquadsScope;
  counts: Record<SquadsScope, number>;
  onChange: (next: SquadsScope) => void;
}) {
  const { t } = useTranslation();
  return (
    <View className="px-4 pt-3 pb-1">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 6, alignItems: "center" }}
      >
        {SQUAD_SCOPES.map((value) => {
          const active = value === scope;
          return (
            <Button
              key={value}
              variant="outline"
              size="sm"
              onPress={() => onChange(value)}
              className={active ? "bg-accent" : ""}
              accessibilityState={{ selected: active }}
            >
              <Text
                numberOfLines={1}
                className={active ? "text-accent-foreground" : "text-muted-foreground"}
              >
                {t(SQUAD_SCOPE_LABEL_KEYS[value])}
              </Text>
              <Text
                className={cn(
                  "text-xs tabular-nums",
                  active ? "text-accent-foreground" : "text-muted-foreground",
                )}
              >
                {counts[value]}
              </Text>
            </Button>
          );
        })}
      </ScrollView>
    </View>
  );
}

/**
 * Filter chip. Carries only the number of active dimensions, never a label —
 * the shape the skills list already uses, and what web does below `md`.
 * Tapping the count clears (web's inline `X` inside the trigger); tapping the
 * rest opens the sheet.
 */
function SquadFilterChip({
  activeCount,
  onPress,
  onClear,
}: {
  activeCount: number;
  onPress: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const active = activeCount > 0;

  return (
    <View
      className={cn(
        "flex-row items-center rounded-md border",
        active
          ? "border-transparent bg-brand"
          : "border-border bg-secondary/50",
      )}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={t("squads.list.filter")}
        accessibilityState={{ expanded: active }}
        className="flex-row items-center gap-1 px-2 py-1.5 active:opacity-70"
      >
        <Ionicons
          name="filter"
          size={14}
          color={active ? theme.primaryForeground : theme.mutedForeground}
        />
        {active ? (
          <Text
            className="text-xs font-medium tabular-nums"
            style={{ color: theme.primaryForeground }}
          >
            {activeCount}
          </Text>
        ) : null}
      </Pressable>
      {active ? (
        <Pressable
          onPress={onClear}
          accessibilityRole="button"
          accessibilityLabel={t("squads.list.filterClear")}
          hitSlop={6}
          className="pl-1 pr-2 py-1.5 active:opacity-70"
        >
          <Ionicons name="close" size={13} color={theme.primaryForeground} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Sort chip — the field+direction pairing the agents and skills lists use,
 *  so every list offers its sort the same way. */
function SquadSortChip({
  sortField,
  sortDirection,
  onChange,
}: {
  sortField: SquadSortField;
  sortDirection: SquadSortDirection;
  onChange: (field: SquadSortField, direction: SquadSortDirection) => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;

  const options: {
    field: SquadSortField;
    direction: SquadSortDirection;
    label: string;
  }[] = [];
  for (const field of SQUAD_SORT_FIELDS) {
    const defaultDir = SQUAD_SORT_DEFAULT_DIRECTION[field];
    options.push({ field, direction: defaultDir, label: t(SORT_LABEL_KEY[field]) });
    if (sortField === field) {
      options.push({
        field,
        direction: defaultDir === "asc" ? "desc" : "asc",
        label: `${t(SORT_LABEL_KEY[field])} (${
          defaultDir === "asc"
            ? t("squads.list.sortDescending")
            : t("squads.list.sortAscending")
        })`,
      });
    }
  }

  const openSortPicker = () => {
    const labels = options.map((o) => o.label);
    ActionSheet.showActionSheetWithOptions(
      {
        title: t("squads.list.sort"),
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

  const defaultDir = SQUAD_SORT_DEFAULT_DIRECTION[sortField];
  const activeLabel =
    sortDirection === defaultDir
      ? t(SORT_LABEL_KEY[sortField])
      : `${t(SORT_LABEL_KEY[sortField])} (${
          sortDirection === "asc"
            ? t("squads.list.sortAscending")
            : t("squads.list.sortDescending")
        })`;

  return (
    <Pressable
      onPress={openSortPicker}
      accessibilityRole="button"
      accessibilityLabel={t("squads.list.sort")}
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
 * The two filter dimensions as one grouped multi-select sheet. Web nests them
 * under a Filter dropdown; on a phone they become labelled groups of a single
 * sheet, which is also what makes a cross-dimension search possible. Option
 * lists and their counts come from the *unfiltered* scope rows, so toggling
 * one dimension never makes the other's options vanish (web's `scopeRows`
 * contract).
 */
function SquadFilterSheet({
  visible,
  onClose,
  leaderOptions,
  creatorOptions,
  filters,
  onToggle,
  onClear,
}: {
  visible: boolean;
  onClose: () => void;
  leaderOptions: { id: string; name: string; count: number }[];
  creatorOptions: { id: string; name: string; count: number }[];
  filters: { leaders: string[]; creators: string[] };
  onToggle: (key: string) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();

  const withCount = (label: string, count: number) => `${label} · ${count}`;

  const groups = useMemo(
    () =>
      [
        {
          label: t("squads.list.filterGroupLeaders"),
          rows: leaderOptions.map((option) => ({
            key: squadFilterKey("leaders", option.id),
            title: withCount(option.name, option.count),
          })),
        },
        {
          label: t("squads.list.filterGroupCreators"),
          rows: creatorOptions.map((option) => ({
            key: squadFilterKey("creators", option.id),
            title: withCount(option.name, option.count),
          })),
        },
      ].filter((group) => group.rows.length > 0),
    [leaderOptions, creatorOptions, t],
  );

  const selectedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const id of filters.leaders) keys.add(squadFilterKey("leaders", id));
    for (const id of filters.creators) keys.add(squadFilterKey("creators", id));
    return keys;
  }, [filters]);

  const hasActiveFilters = countActiveSquadFilterDimensions(filters) > 0;

  return (
    <MultiSelectSheet
      visible={visible}
      title={t("squads.list.filterTitle")}
      groups={groups}
      selectedKeys={selectedKeys}
      searchPlaceholder={t("squads.list.filterSearch")}
      emptyText={t("squads.list.noMatches")}
      noMatchText={t("squads.list.filterNoMatch")}
      leading={(row) => {
        const parsed = parseSquadFilterKey(row.key);
        if (!parsed) return null;
        return (
          <ActorAvatar
            type={parsed.dimension === "leaders" ? "agent" : "member"}
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
              {t("squads.list.filterClear")}
            </Text>
          </Pressable>
        ) : null
      }
    />
  );
}

function SquadRow({
  squad,
  leaderName,
  onPress,
}: {
  squad: Squad;
  leaderName: string;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const archived = isSquadArchived(squad);
  const count = squadMemberCount(squad);

  return (
    <Pressable onPress={onPress} className="px-4 py-3 active:bg-secondary">
      <View className={cn("flex-row items-center gap-3", archived && "opacity-60")}>
        <ActorAvatar type="squad" id={squad.id} size={40} />
        <View className="flex-1 min-w-0 gap-0.5">
          <View className="flex-row items-center gap-2">
            <Text
              className="flex-1 text-sm font-medium text-foreground"
              numberOfLines={1}
            >
              {squad.name}
            </Text>
            {archived ? (
              <View className="px-2 py-0.5 rounded-full border border-border bg-muted text-muted-foreground">
                <Text className="text-[11px] text-muted-foreground font-medium">
                  {t("squads.archived")}
                </Text>
              </View>
            ) : null}
          </View>
          <View className="flex-row items-center gap-1.5">
            <Ionicons name="medal-outline" size={12} color={muted} />
            <Text className="text-xs text-muted-foreground" numberOfLines={1}>
              {leaderName}
            </Text>
          </View>
          <Text className="text-xs text-muted-foreground/70">
            {t("squads.memberCount", { count })}
          </Text>
        </View>
        {!archived ? (
          <Ionicons name="chevron-forward" size={14} color={muted} />
        ) : null}
      </View>
    </Pressable>
  );
}
