/**
 * Agents browse page (push screen reached from the More popover and from the
 * chat no-agent banner). Mirrors web `packages/views/agents` semantics: one
 * row per agent — avatar, name, lifecycle pill (active / archived), 2-line
 * description, and a presence line (availability dot + label, active task
 * count, model).
 *
 * The "New" action (header + empty state) opens the create-method chooser
 * (more/agents/new), which leads to the manual form — mirroring web's agents
 * page toolbar (packages/views/agents).
 *
 * Task count + availability come from the shared derive-presence pipeline
 * (`@multica/core/agents` → `useWorkspacePresenceMap`), so the numbers read
 * identically to web: active = running + queued from the workspace task
 * snapshot, dot = runtime reachability (archived agents always render the
 * archived dot).
 *
 * Sort order (matches web "recently active first"): active agents before
 * archived; within a tier, more active tasks first, then name. Archived
 * rows are dimmed so a retired agent is never missed.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { create } from "zustand";
import type { Agent } from "@multica/core/types";
import { isAgentRuntimeBound, type AgentPresenceDetail } from "@multica/core/agents";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { HeaderSearchGroup } from "@/components/ui/header-search-button";
import { SearchField } from "@/components/ui/search-field";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { PresenceDot } from "@/components/ui/presence-dot";
import {
  agentListAllOptions,
  agentRunCounts30dOptions,
} from "@/data/queries/agents";
import { agentActivity30dOptions } from "@/data/queries/agent-activity";
import { buildActivityMap, type AgentActivity } from "@/lib/agent-activity";
import {
  AGENT_SCOPES,
  AGENT_SORT_DEFAULT_DIRECTION,
  AGENT_SORT_FIELDS,
  DEFAULT_AGENTS_SCOPE,
  agentMatchesScope,
  buildAgentFilterOptions,
  countActiveAgentFilters,
  countAgentsByScope,
  EMPTY_AGENT_FILTERS,
  isArchivedAgent,
  lastActiveDaysAgo,
  rowMatchesAgentFilters,
  sortAgentRows,
  type AgentFilterRow,
  type AgentListFilters,
  type AgentsScope,
  type AgentsScopeCounts,
  type AgentSortDirection,
  type AgentSortField,
} from "@/lib/filter-agents";
import { AgentFilterSheet } from "@/components/agent/agent-filter-sheet";
import { runtimeDisplayLabel } from "@multica/core/runtimes";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { memberListOptions } from "@/data/queries/members";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useWorkspacePresenceMap } from "@/lib/use-agent-presence";
import { useAuthStore } from "@/data/auth-store";
import { api } from "@/data/api";
import { ActionSheet } from "@/lib/action-sheet";
import { AgentRowMenu } from "@/components/agent/agent-row-menu";
import {
  AgentAccessBatchSheet,
  type AccessChangePick,
} from "@/components/agent/agent-access-batch-sheet";
import {
  accessScopeOfAgent,
  areAllVisibleAgentsSelected,
  buildAgentBatchSelection,
  matchesAccessFilter,
  retainConfirmedAgentIds,
} from "@/lib/agent-list-access";
import type { AccessScope } from "@/lib/agent-access";
import { useTranslation } from "@/lib/i18n/react";
import { cn } from "@/lib/utils";
import { useThemePalette } from "@/lib/appearance-a11y-runtime";

// Server-driven enum: unknown statuses degrade to the neutral pill (a future
// value must not collapse the list — backend is the gate).
const STATUS_PILL: Record<string, { label: string; className: string }> = {
  active: {
    label: "agents.status.active",
    className:
      "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  archived: {
    label: "agents.status.archived",
    className: "bg-muted text-muted-foreground",
  },
};

// availability enum → i18n key. Unknown values fall through to the raw
// string (never a crash, never a concatenated key).
const AVAILABILITY_KEY: Record<string, string> = {
  online: "agents.availability.online",
  unstable: "agents.availability.unstable",
  offline: "agents.availability.offline",
  archived: "agents.availability.archived",
};

// Effective access scope → list badge label (iteration-84 A8, MUL-3963
// parity): derived from permission_mode + invocation_targets, not the lossy
// legacy visibility field.
const SCOPE_BADGE_KEY: Record<AccessScope, string> = {
  workspace: "agents.scope.workspace",
  "specific-people": "agents.scope.specificPeople",
  "owner-only": "agents.scope.ownerOnly",
};

const scopeBadge = accessScopeOfAgent;

// Ownership / lifecycle scope → i18n key. These are `agents.scopeMine` /
// `agents.scopeAll` / `agents.scopeArchived` — deliberately NOT the
// `agents.scope.workspace` family above, which labels the ACCESS scope badge.
// Both axes are called "scope" in web's vocabulary; keeping the key families
// separate stops one from silently overwriting the other.
const AGENT_SCOPE_LABEL_KEY: Record<AgentsScope, string> = {
  mine: "agents.scopeMine",
  all: "agents.scopeAll",
  archived: "agents.scopeArchived",
};

/**
 * Session-scoped view choice for the agents list (sort + scope). Deliberately
 * not persisted: web keeps both in a per-workspace view store, but the phone's
 * other lists (projects, issues) scope the same choices to the session, and
 * this page follows that convention rather than splitting it.
 */
interface AgentMobileViewState {
  sortField: AgentSortField;
  sortDirection: AgentSortDirection;
  scope: AgentsScope;
  setSort: (field: AgentSortField, direction: AgentSortDirection) => void;
  setScope: (scope: AgentsScope) => void;
}

export const useAgentMobileViewStore = create<AgentMobileViewState>()((set) => ({
  sortField: "lastActive",
  sortDirection: AGENT_SORT_DEFAULT_DIRECTION.lastActive,
  scope: DEFAULT_AGENTS_SCOPE,
  setSort: (sortField, sortDirection) => set({ sortField, sortDirection }),
  setScope: (scope) => set({ scope }),
}));

export default function AgentsPage() {
  const palette = useThemePalette();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { t } = useTranslation();
  const muted = palette.mutedForeground;
  const qc = useQueryClient();
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);

  const { data, isLoading, error, refetch, isRefetching } = useQuery(
    agentListAllOptions(wsId),
  );
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const presence = useWorkspacePresenceMap(wsId);
  const currentMember = members.find((m) => m.user_id === currentUserId);

  // ---- Search + sort (iteration 129, MYS-1060) ----
  const [search, setSearch] = useState("");
  const sortField = useAgentMobileViewStore((s) => s.sortField);
  const sortDirection = useAgentMobileViewStore((s) => s.sortDirection);
  const setSort = useAgentMobileViewStore((s) => s.setSort);

  // ---- Ownership / lifecycle scope (web's `mine` / `all` / `archived`) ----
  const scope = useAgentMobileViewStore((s) => s.scope);
  const setScopeRaw = useAgentMobileViewStore((s) => s.setScope);

  // ---- Multi-dimension filters (iteration 181, MYS-1564 / G27) ----
  // Session-scoped, like the sort above: web keeps these in a per-workspace
  // view store, but a filter the user cannot see as a chip on the row (only
  // as a badge count) must not silently survive a restart.
  const [filters, setFilters] = useState<AgentListFilters>(EMPTY_AGENT_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const { data: runtimes = [] } = useQuery(runtimeListOptions(wsId));

  // Both extra datasets are gated on the sort that reads them: the RUNS metric
  // is the workspace 30-day run count and "last active" is derived from the
  // same 30-day buckets, so a list sorted by name or creation date fetches
  // neither. `lastActive` also uses the run count as its tiebreak (web
  // parity), which is why one sort needs both.
  const needsRunCounts = sortField === "runs" || sortField === "lastActive";
  const { data: runCounts = [] } = useQuery(
    agentRunCounts30dOptions(wsId, needsRunCounts),
  );
  const runCountById = useMemo(
    () => new Map(runCounts.map((r) => [r.agent_id, r.run_count])),
    [runCounts],
  );
  const { data: activityBuckets } = useQuery({
    ...agentActivity30dOptions(wsId),
    enabled: !!wsId && sortField === "lastActive",
  });
  const activityByAgent = useMemo(() => {
    const agents = data ?? [];
    if (!activityBuckets) return new Map<string, AgentActivity>();
    return buildActivityMap(agents, activityBuckets, Date.now());
  }, [data, activityBuckets]);

  // Scope partition runs FIRST — before the sort, before the access chips and
  // before the filter sheet's option lists. Web builds its `scopeRows` at this
  // same layer, and the order is load-bearing: everything downstream (option
  // lists, the access-chip result, the empty states) is defined over the
  // scoped set, so a scope applied only at render time would leave the sheet
  // counting agents the user cannot see.
  const scopedAgents = useMemo(
    () => (data ?? []).filter((a) => agentMatchesScope(a, scope, currentUserId)),
    [data, scope, currentUserId],
  );

  // Per-scope totals for the pills — counted over the FULL set and ignoring
  // the filters, so the numbers never collapse as filters narrow the list
  // (web's `scopeCounts`, agents-page.tsx:848-867).
  const scopeCounts = useMemo(
    () => countAgentsByScope(data ?? [], currentUserId),
    [data, currentUserId],
  );

  const sorted = useMemo(() => {
    const rows = scopedAgents.map((agent) => ({
      agent,
      archived: isArchivedAgent(agent),
      runCount: runCountById.get(agent.id) ?? 0,
      lastActiveDays: lastActiveDaysAgo(activityByAgent.get(agent.id) ?? null),
    }));
    return sortAgentRows(rows, sortField, sortDirection).map((r) => r.agent);
  }, [scopedAgents, runCountById, activityByAgent, sortField, sortDirection]);

  // ---- Selection / batch state (iteration-84 A8, MUL-4302 parity) ----
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [batchAccess, setBatchAccess] = useState<{
    workspaceId: typeof wsId; ids: string[]; count: number;
  } | null>(null);
  const [applyingAccess, setApplyingAccess] = useState(false);
  const [scopeFilter, setScopeFilter] = useState<AccessScope | "all">("all");

  // Scope rows: the access chip's result, BEFORE the sheet's filters and the
  // search box. Web's `scopeRows` (agents-page.tsx:1050-1067) is the same
  // layer, and it is deliberately what the option lists are derived from
  // (`allRows={scopeRows}`) — see `buildAgentFilterOptions` for why deriving
  // from the filtered result would make each dimension erase its siblings.
  const scopeRows = useMemo(
    () =>
      scopeFilter === "all"
        ? sorted
        : sorted.filter((a) =>
            matchesAccessFilter(a, new Set<AccessScope>([scopeFilter])),
          ),
    [sorted, scopeFilter],
  );

  // The filter predicate reads a row's DERIVED availability (the dot's own
  // value), so the filter and the dot can never disagree. Archived rows carry
  // `archived`, which is in no availability option — matching web, whose
  // AVAILABILITY_VALUES stops at the three runtime states.
  const filterRows: AgentFilterRow<Agent>[] = useMemo(
    () =>
      scopeRows.map((agent) => ({
        agent,
        availability: presence.byAgent.get(agent.id)?.availability ?? null,
      })),
    [scopeRows, presence.byAgent],
  );

  const activeFilterCount = countActiveAgentFilters(filters);

  const filterOptions = useMemo(() => {
    const runtimeById = new Map(runtimes.map((r) => [r.id, r]));
    const memberById = new Map(members.map((m) => [m.user_id, m]));
    return buildAgentFilterOptions(filterRows, {
      // Web falls back to the raw id when the runtime row is unknown
      // (agent-list-toolbar.tsx:158-163 keeps the id as the Map key and only
      // prettifies when it can resolve one).
      runtime: (id) => {
        const rt = runtimeById.get(id);
        return rt ? runtimeDisplayLabel(rt) : id;
      },
      owner: (id) => memberById.get(id)?.name ?? id.slice(0, 8),
    });
  }, [filterRows, runtimes, members]);

  const toggleFilter = useCallback(
    (dimension: keyof AgentListFilters, value: string) => {
      setFilters((current) => {
        const list = current[dimension];
        return {
          ...current,
          [dimension]: list.includes(value)
            ? list.filter((v) => v !== value)
            : [...list, value],
        };
      });
    },
    [],
  );

  const clearFilters = useCallback(() => setFilters(EMPTY_AGENT_FILTERS), []);

  // Entering `mine` clears the sheet filters, exactly as web's store does
  // (`view-store.ts:113-116`): `mine` is the clean personal view and never
  // carries filters, while leaving it for `all` / `archived` keeps whatever
  // the user had applied. The access chips are a separate axis and are left
  // alone, matching web, whose `setScope` only resets `filters`.
  const setScope = useCallback(
    (next: AgentsScope) => {
      setScopeRaw(next);
      if (next === "mine") clearFilters();
    },
    [setScopeRaw, clearFilters],
  );

  const filtered = useMemo(() => {
    const query = search.trim();
    if (activeFilterCount === 0 && !query) return scopeRows;
    return filterRows
      .filter((row) => rowMatchesAgentFilters(row, filters, query))
      .map((row) => row.agent);
  }, [scopeRows, filterRows, filters, search, activeFilterCount]);

  const batch = useMemo(
    () => buildAgentBatchSelection({
      agents: filtered,
      selectedIds,
      currentUserId,
      currentRole: currentMember?.role,
    }),
    [filtered, selectedIds, currentUserId, currentMember?.role],
  );
  const latestBatch = useRef({ workspaceId: wsId, batch });
  useLayoutEffect(() => {
    latestBatch.current = { workspaceId: wsId, batch };
  }, [wsId, batch]);

  const invalidateAgents = () =>
    void qc.invalidateQueries({
      queryKey: agentListAllOptions(wsId).queryKey,
    });

  const runBatch = async (
    fn: (id: string) => Promise<unknown>,
    targets: string[],
  ): Promise<{ succeeded: number; failed: number }> => {
    const settled = await Promise.allSettled(targets.map((id) => fn(id)));
    const failed = settled.filter((s) => s.status === "rejected").length;
    invalidateAgents();
    setSelectedIds(new Set());
    setSelectionMode(false);
    return { succeeded: settled.length - failed, failed };
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((current) =>
      areAllVisibleAgentsSelected(filtered, current)
        ? new Set()
        : new Set(filtered.map((a) => a.id)),
    );
  };

  const confirmArchive = () => {
    const confirmed = batch.archivableIds;
    if (confirmed.length === 0) return;
    Alert.alert(
      t("agents.batch.confirmArchiveTitle"),
      t("agents.batch.confirmArchiveMessage", { count: confirmed.length }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("agents.batch.actions.archive"),
          style: "destructive",
          onPress: async () => {
            const current = latestBatch.current;
            if (current.workspaceId !== wsId) return;
            const ids = retainConfirmedAgentIds(confirmed, current.batch.archivableIds);
            if (ids.length === 0) return;
            const res = await runBatch((id) => api.archiveAgent(id), ids);
            if (res.failed > 0) Alert.alert(t("common.unknownError"));
          },
        },
      ],
    );
  };

  const restoreBatch = async () => {
    if (batch.restorableIds.length === 0) return;
    const res = await runBatch(
      (id) => api.restoreAgent(id),
      batch.restorableIds,
    );
    if (res.failed > 0) Alert.alert(t("common.unknownError"));
  };

  const applyAccess = async (change: AccessChangePick) => {
    if (!change || applyingAccess || !batchAccess) return;
    const current = latestBatch.current;
    if (current.workspaceId !== batchAccess.workspaceId) {
      setBatchAccess(null);
      return;
    }
    const ids = retainConfirmedAgentIds(batchAccess.ids, current.batch.ownedIds);
    if (ids.length === 0) {
      setBatchAccess(null);
      return;
    }
    setApplyingAccess(true);
    try {
      const res = await runBatch(
        (id) => api.updateAgent(id, change),
        ids,
      );
      setApplyingAccess(false);
      setBatchAccess(null);
      Alert.alert(
        t("agents.batch.resultPartial", {
          succeeded: res.succeeded,
          skipped: batchAccess.count - ids.length,
        }),
      );
    } catch {
      setApplyingAccess(false);
      setBatchAccess(null);
      Alert.alert(t("common.unknownError"));
    }
  };

  const showEmpty = !isLoading && !error && (data ?? []).length === 0;

  // Empty-list copy, branched the way web branches it
  // (`agents-page.tsx:941-952`): the archived scope and an active filter each
  // get their own wording, because "no agents match your search" is wrong when
  // the user never searched — they are simply looking at an empty scope.
  const noMatchText = useMemo(() => {
    if (search.trim()) {
      return scope === "archived"
        ? t("agents.noMatchesSearchArchived", { query: search.trim() })
        : t("agents.noMatchesSearch", { query: search.trim() });
    }
    if (scope === "archived") return t("agents.noMatchesArchived");
    if (activeFilterCount > 0) return t("agents.noMatchesFilter");
    return t("agents.noMatches");
  }, [search, scope, activeFilterCount, t]);

  // Row-menu gate, web's `canManage: isWorkspaceAdmin || isOwner`
  // (agents-page.tsx:890): managing ANY agent needs workspace admin/owner,
  // managing your OWN needs nothing.
  const isWorkspaceManager =
    currentMember?.role === "owner" || currentMember?.role === "admin";
  const canManageRow = useCallback(
    (agent: Agent) =>
      isWorkspaceManager || (!!currentUserId && agent.owner_id === currentUserId),
    [isWorkspaceManager, currentUserId],
  );

  // "New" header action — opens the create-method chooser (mirrors the
  // skills/autopilots "+" header action). Selection mode swaps the compose
  // actions for a Done control that exits the mode.
  const headerRight = useCallback(() => {
    if (!wsSlug) return null;
    if (selectionMode) {
      // Selection mode deliberately drops the search entry: it replaces the
      // browse actions with the mode's own exit, and search would leave the
      // mode (its panel is a different route) while the selection stayed
      // behind. Same reasoning as the batch toolbar owning the screen.
      return (
        <Pressable
          onPress={() => {
            setSelectionMode(false);
            setSelectedIds(new Set());
          }}
          accessibilityLabel={t("agents.batch.done")}
        >
          <Text className="text-body font-medium text-brand">
            {t("agents.batch.done")}
          </Text>
        </Pressable>
      );
    }
    return (
      <HeaderSearchGroup>
        <View className="flex-row items-center gap-3">
          <IconButton
            name="checkbox-outline"
            onPress={() => setSelectionMode(true)}
            accessibilityLabel={t("agents.batch.enterSelection")}
          />
          <IconButton
            name="add"
            onPress={() => router.push(`/${wsSlug}/more/agents/new`)}
            accessibilityLabel={t("agents.createButton")}
          />
        </View>
      </HeaderSearchGroup>
    );
  }, [wsSlug, t, selectionMode]);

  return (
    <>
      <Stack.Screen options={{ title: t("screen.agents"), headerRight }} />
      <View className="flex-1 bg-background">
        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator />
          </View>
        ) : error ? (
          <View className="px-4 gap-3 pt-4">
            <Text className="text-body text-destructive">
              {t("agents.loadError")}
              {error instanceof Error ? error.message : t("common.unknownError")}
            </Text>
            <Button variant="outline" onPress={() => refetch()}>
              <Text>{t("workspace.retry")}</Text>
            </Button>
          </View>
        ) : showEmpty ? (
          <View className="flex-1 items-center justify-center px-6 gap-1">
            <Ionicons name="hardware-chip-outline" size={32} color={muted} />
            <Text className="text-body text-muted-foreground text-center mt-2">
              {t("agents.emptyTitle")}
            </Text>
            <Text className="text-caption text-muted-foreground/70 text-center">
              {t("agents.emptyDescription")}
            </Text>
            {wsSlug ? (
              <View className="flex-row gap-2 mt-3">
                <Button
                  variant="outline"
                  onPress={() => router.push(`/${wsSlug}/chat-sessions`)}
                >
                  <Ionicons name="chatbubbles-outline" size={15} color={muted} />
                  <Text>{t("agents.goChat")}</Text>
                </Button>
                <Button onPress={() => router.push(`/${wsSlug}/more/agents/new`)}>
                  <Ionicons name="add" size={15} color={palette.primaryForeground} />
                  <Text>{t("agents.createButton")}</Text>
                </Button>
              </View>
            ) : null}
          </View>
        ) : (
          <>
            {!selectionMode ? (
              <>
                {/* Ownership / lifecycle scope, then the ACCESS-scope chips.
                    Two different axes that both read as "scope" on screen:
                    the pills partition archiving + ownership, the chips
                    filter effective access. Web carries them in one toolbar
                    too (scope buttons beside the filters). */}
                <AgentsScopeTabs
                  scope={scope}
                  counts={scopeCounts}
                  onChange={setScope}
                />
                <ScopeFilterChips
                  value={scopeFilter}
                  onChange={setScopeFilter}
                />
                {/* Search + sort toolbar — same shape as the projects list's
                    (search field, then a sort chip opening an ActionSheet
                    that pairs each field with its direction). Hidden in
                    selection mode, like the scope chips, to leave room for
                    the batch bar. */}
                <SearchField
                  value={search}
                  onChange={setSearch}
                  placeholder={t("agents.searchPlaceholder")}
                  className="mx-3 mb-2"
                />
                <View className="flex-row flex-wrap items-center gap-2 px-3 pb-2">
                  <AgentSortPicker
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onChange={setSort}
                  />
                  <AgentFilterButton
                    activeCount={activeFilterCount}
                    onPress={() => setFilterOpen(true)}
                  />
                </View>
              </>
            ) : null}
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.id}
              ItemSeparatorComponent={() => <View className="h-px bg-border ml-4" />}
              contentContainerClassName="pb-4"
              ListEmptyComponent={
                <Text className="px-4 py-8 text-center text-body text-muted-foreground">
                  {noMatchText}
                </Text>
              }
              renderItem={({ item }) =>
                selectionMode ? (
                  <SelectableAgentRow
                    agent={item}
                    presenceDetail={presence.byAgent.get(item.id)}
                    selected={selectedIds.has(item.id)}
                    onToggle={() => toggleSelection(item.id)}
                  />
                ) : (
                  <AgentRow
                    agent={item}
                    presenceDetail={presence.byAgent.get(item.id)}
                    canManage={canManageRow(item)}
                    onPress={() => {
                      if (wsSlug) router.push(`/${wsSlug}/more/agents/${item.id}`);
                    }}
                  />
                )
              }
              refreshing={isRefetching}
              onRefresh={refetch}
            />
            {selectionMode ? (
              <BatchBar
                count={batch.selection.length}
                allSelected={areAllVisibleAgentsSelected(filtered, selectedIds)}
                hasVisibleRows={filtered.length > 0}
                anyArchived={batch.archivedIds.length > 0}
                canArchive={batch.archivableIds.length > 0}
                canRestore={batch.restorableIds.length > 0}
                busy={applyingAccess}
                onClear={() => setSelectedIds(new Set())}
                onSelectAll={toggleSelectAll}
                onArchive={confirmArchive}
                onRestore={() => void restoreBatch()}
                onSetAccess={() => {
                  if (batch.ownedIds.length === 0) {
                    Alert.alert(t("agents.batch.noOwnedSelected"));
                    return;
                  }
                  setBatchAccess({
                    workspaceId: wsId,
                    ids: batch.ownedIds,
                    count: batch.selection.length,
                  });
                }}
              />
            ) : null}
          </>
        )}
      </View>
      <AgentAccessBatchSheet
        visible={batchAccess !== null}
        members={members.filter((m) => m.user_id !== currentUserId)}
        applying={applyingAccess}
        onApply={(change) => void applyAccess(change)}
        onClose={() => setBatchAccess(null)}
      />
      <AgentFilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        filters={filters}
        options={filterOptions}
        activeCount={activeFilterCount}
        onToggle={toggleFilter}
        onClear={clearFilters}
      />
    </>
  );
}

const AGENT_SORT_LABEL_KEY: Record<AgentSortField, string> = {
  lastActive: "agents.sortLastActive",
  name: "agents.sortName",
  runs: "agents.sortRuns",
  created: "agents.sortCreated",
};

/**
 * Sort chip + ActionSheet, the same interaction as the projects list's
 * `SortPicker`: every field is offered once with its natural direction, and
 * the ACTIVE field is offered a second time with the opposite direction, so
 * flipping direction is one tap rather than a separate toggle.
 */
function AgentSortPicker({
  sortField,
  sortDirection,
  onChange,
}: {
  sortField: AgentSortField;
  sortDirection: AgentSortDirection;
  onChange: (field: AgentSortField, direction: AgentSortDirection) => void;
}) {
  const palette = useThemePalette();
  const { t } = useTranslation();
  const muted = palette.mutedForeground;

  const options: {
    field: AgentSortField;
    direction: AgentSortDirection;
    label: string;
  }[] = [];
  for (const field of AGENT_SORT_FIELDS) {
    const defaultDir = AGENT_SORT_DEFAULT_DIRECTION[field];
    options.push({
      field,
      direction: defaultDir,
      label: t(AGENT_SORT_LABEL_KEY[field]),
    });
    if (sortField === field) {
      options.push({
        field,
        direction: defaultDir === "asc" ? "desc" : "asc",
        label: `${t(AGENT_SORT_LABEL_KEY[field])} (${
          defaultDir === "asc"
            ? t("agents.sortDescending")
            : t("agents.sortAscending")
        })`,
      });
    }
  }

  const openSortPicker = () => {
    const labels = options.map((o) => o.label);
    ActionSheet.showActionSheetWithOptions(
      {
        title: t("agents.sort"),
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

  const defaultDir = AGENT_SORT_DEFAULT_DIRECTION[sortField];
  const activeLabel =
    sortDirection === defaultDir
      ? t(AGENT_SORT_LABEL_KEY[sortField])
      : `${t(AGENT_SORT_LABEL_KEY[sortField])} (${
          sortDirection === "asc"
            ? t("agents.sortAscending")
            : t("agents.sortDescending")
        })`;

  return (
    <Pressable
      onPress={openSortPicker}
      accessibilityRole="button"
      accessibilityLabel={t("agents.sort")}
      className="min-h-12 max-w-full flex-row items-center gap-2 rounded-xl border border-border bg-secondary/50 px-3 py-2 active:opacity-70"
    >
      <Ionicons name="swap-vertical" size={14} color={muted} />
      <Text className="shrink text-caption text-muted-foreground">
        {activeLabel}
      </Text>
    </Pressable>
  );
}

/**
 * Filter chip that opens `AgentFilterSheet`. Mirrors web's Filter trigger
 * (`agent-list-toolbar.tsx:296-334`): a funnel glyph plus, once anything is
 * active, the active-dimension count — web shows "N filters" on desktop and
 * the bare number on small screens (`md:hidden` tabular-nums span), and the
 * phone is always that small screen.
 */
function AgentFilterButton({
  activeCount,
  onPress,
}: {
  activeCount: number;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const theme = useThemePalette();
  const active = activeCount > 0;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        active
          ? `${t("agents.filter.open")}, ${t("agents.filter.activeCount", {
              count: activeCount,
            })}`
          : t("agents.filter.open")
      }
      className={cn(
        "min-h-12 max-w-full flex-row items-center gap-2 rounded-xl border px-3 py-2 active:opacity-70",
        active ? "border-primary bg-primary/10" : "border-border bg-secondary/50",
      )}
    >
      <Ionicons
        name="funnel-outline"
        size={14}
        color={active ? theme.primary : theme.mutedForeground}
      />
      {active ? (
        <Text
          className="text-caption font-medium tabular-nums"
          style={{ color: theme.primary }}
        >
          {activeCount}
        </Text>
      ) : (
        <Text className="text-caption text-muted-foreground" numberOfLines={1}>
          {t("agents.filter.open")}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * Ownership / lifecycle scope pills — the mobile counterpart of web's scope
 * segmented control (`agent-list-toolbar.tsx:226-256`). Web renders scope
 * buttons on desktop and a `Select` below `md`; mobile uses wrapping pills
 * so the choices and counts remain visible at larger text sizes.
 *
 * Each pill carries its total from the FULL set (`scopeCounts`), so the
 * numbers stay put while the search box and the filter sheet narrow the list —
 * web's own behaviour, and the reason the counts are computed off `data`
 * rather than the filtered result.
 */
function AgentsScopeTabs({
  scope,
  counts,
  onChange,
}: {
  scope: AgentsScope;
  counts: AgentsScopeCounts;
  onChange: (scope: AgentsScope) => void;
}) {
  const { t } = useTranslation();
  return (
    <View className="flex-row flex-wrap px-3 pt-2 gap-1.5">
      {AGENT_SCOPES.map((value) => {
        const active = scope === value;
        return (
          <Pressable
            key={value}
            onPress={() => onChange(value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            className={cn(
              "min-h-12 max-w-full justify-center rounded-full border px-3 py-2",
              active ? "bg-secondary border-border" : "border-transparent",
            )}
          >
            <Text
              className={cn(
                "text-caption tabular-nums",
                active ? "text-foreground font-medium" : "text-muted-foreground",
              )}
            >
              {t(AGENT_SCOPE_LABEL_KEY[value])} {counts[value]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ScopeFilterChips({
  value,
  onChange,
}: {
  value: AccessScope | "all";
  onChange: (v: AccessScope | "all") => void;
}) {
  const { t } = useTranslation();
  const OPTIONS: { value: AccessScope | "all"; labelKey: string }[] = [
    { value: "all", labelKey: "agents.batch.filterAll" },
    { value: "workspace", labelKey: "agents.scope.workspace" },
    { value: "specific-people", labelKey: "agents.scope.specificPeople" },
    { value: "owner-only", labelKey: "agents.scope.ownerOnly" },
  ];
  return (
    <View className="flex-row flex-wrap px-3 py-2 gap-1.5">
      {OPTIONS.map((o) => {
        const active = value === o.value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            className={cn(
              "min-h-12 max-w-full justify-center rounded-full border px-3 py-2",
              active
                ? "bg-secondary border-border"
                : "border-transparent",
            )}
          >
            <Text
              className={cn(
                "text-caption",
                active ? "text-foreground font-medium" : "text-muted-foreground",
              )}
            >
              {t(o.labelKey)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function BatchBar({
  count,
  allSelected,
  hasVisibleRows,
  anyArchived,
  canArchive,
  canRestore,
  busy,
  onClear,
  onSelectAll,
  onArchive,
  onRestore,
  onSetAccess,
}: {
  count: number;
  allSelected: boolean;
  hasVisibleRows: boolean;
  anyArchived: boolean;
  canArchive: boolean;
  canRestore: boolean;
  busy: boolean;
  onClear: () => void;
  onSelectAll: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onSetAccess: () => void;
}) {
  const { t } = useTranslation();
  const theme = useThemePalette();
  return (
    <View className="px-3 pb-3 pt-1">
      <View className="flex-row flex-wrap items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 shadow-lg">
        <Text className="text-body font-medium text-foreground tabular-nums">
          {t("agents.batch.selectedCount", { count })}
        </Text>
        {hasVisibleRows && !allSelected ? (
          <Pressable onPress={onSelectAll} disabled={busy} accessibilityRole="button" className="min-h-12 justify-center px-2">
            <Text className="text-caption font-medium text-brand">
              {t("agents.batch.selectAll")}
            </Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onClear} disabled={busy || count === 0} accessibilityRole="button" accessibilityLabel={t("common.clear")} className="size-12 items-center justify-center">
          <Ionicons name="close" size={16} color={theme.mutedForeground} />
        </Pressable>
        <View className="flex-1" />
        {anyArchived ? (
          <IconButton
            name="refresh-outline"
            onPress={onRestore}
            disabled={!canRestore || busy}
            className="size-12"
            accessibilityLabel={t("agents.batch.actions.restore")}
          />
        ) : null}
        <IconButton
          name="archive-outline"
          onPress={onArchive}
          disabled={!canArchive || busy}
          className="size-12"
          accessibilityLabel={t("agents.batch.actions.archive")}
        />
        <IconButton
          name="people-outline"
          onPress={onSetAccess}
          disabled={busy || count === 0}
          className="size-12"
          accessibilityLabel={t("agents.batch.actions.setAccess")}
        />
      </View>
    </View>
  );
}

function AgentRow({
  agent,
  presenceDetail,
  canManage,
  onPress,
}: {
  agent: Agent;
  presenceDetail: AgentPresenceDetail | undefined;
  canManage: boolean;
  onPress: () => void;
}) {
  const palette = useThemePalette();
  const { t } = useTranslation();
  const muted = palette.mutedForeground;
  const archived = isArchivedAgent(agent);
  const pill = STATUS_PILL[archived ? "archived" : "active"];
  // Archived wins over runtime health — mirrors deriveAgentPresenceDetail.
  const availability = archived
    ? "archived"
    : (presenceDetail?.availability ?? "offline");
  const activeCount =
    (presenceDetail?.runningCount ?? 0) + (presenceDetail?.queuedCount ?? 0);
  const needsRuntime = !isAgentRuntimeBound(agent);
  const availabilityLabel = AVAILABILITY_KEY[availability]
    ? t(AVAILABILITY_KEY[availability])
    : availability;

  return (
    <Pressable onPress={onPress} className={cn("px-4 py-3", !archived && "active:bg-secondary")}>
      <View className={cn("flex-row items-center gap-3", archived && "opacity-60")}>
        <ActorAvatar type="agent" id={agent.id} size={40} />
        <View className="flex-1 min-w-0 gap-0.5">
          <View className="flex-row items-center gap-2">
            <Text
              className="flex-1 text-body font-medium text-foreground"
              numberOfLines={1}
            >
              {agent.name}
            </Text>
            <View
              className={cn(
                "px-2 py-0.5 rounded-full border border-border",
                pill.className,
              )}
            >
              <Text className="text-micro font-medium">
                {t(pill.label)}
              </Text>
            </View>
          </View>
          {agent.description ? (
            <Text className="text-caption text-muted-foreground" numberOfLines={2}>
              {agent.description}
            </Text>
          ) : null}
          <View className="flex-row items-center gap-1.5">
            <PresenceDot availability={availability} size={7} />
            <Text className="text-caption text-muted-foreground">
              {availabilityLabel}
            </Text>
            {!archived && !needsRuntime && activeCount > 0 ? (
              <Text className="text-caption text-muted-foreground">
                · {t("agents.taskCount", { count: activeCount })}
              </Text>
            ) : null}
            {!archived && needsRuntime ? (
              <Text className="text-caption text-amber-600 dark:text-amber-400">
                · {t("agents.needsRuntime")}
              </Text>
            ) : null}
            {!archived && agent.model ? (
              <Text className="text-caption text-muted-foreground/70">
                · {agent.model}
              </Text>
            ) : null}
            {!archived ? (
              <View className="px-1.5 py-px rounded-full border border-border bg-secondary/60">
                <Text className="text-micro text-muted-foreground">
                  {t(SCOPE_BADGE_KEY[scopeBadge(agent)])}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
        {!archived ? (
          <Ionicons name="chevron-forward" size={14} color={muted} />
        ) : null}
        {/* Row actions (iteration 129). The trigger claims the touch
            responder, so opening the sheet never falls through to the row's
            own onPress — tapping elsewhere on the row still navigates. */}
        <AgentRowMenu
          agent={agent}
          presence={presenceDetail}
          canManage={canManage}
        />
      </View>
    </Pressable>
  );
}

/** Selection-mode row — checkbox in place of chevron, no navigation. */
function SelectableAgentRow({
  agent,
  presenceDetail,
  selected,
  onToggle,
}: {
  agent: Agent;
  presenceDetail: AgentPresenceDetail | undefined;
  selected: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const theme = useThemePalette();
  const muted = theme.mutedForeground;
  const archived = isArchivedAgent(agent);
  const availability = archived
    ? "archived"
    : (presenceDetail?.availability ?? "offline");
  const availabilityLabel = AVAILABILITY_KEY[availability]
    ? t(AVAILABILITY_KEY[availability])
    : availability;

  return (
    <Pressable
      onPress={onToggle}
      className="min-h-12 px-4 py-3 active:bg-secondary"
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={agent.name}
    >
      <View className={cn("flex-row items-center gap-3", archived && "opacity-60")}>
        <Ionicons
          name={selected ? "checkmark-circle" : "ellipse-outline"}
          size={22}
          color={selected ? theme.brand : muted}
        />
        <ActorAvatar type="agent" id={agent.id} size={40} />
        <View className="flex-1 min-w-0 gap-0.5">
          <Text
            className="text-body font-medium text-foreground"
            numberOfLines={1}
          >
            {agent.name}
          </Text>
          {agent.description ? (
            <Text className="text-caption text-muted-foreground" numberOfLines={1}>
              {agent.description}
            </Text>
          ) : null}
          <View className="flex-row items-center gap-1.5">
            <PresenceDot availability={availability} size={7} />
            <Text className="text-caption text-muted-foreground">
              {availabilityLabel}
            </Text>
          </View>
        </View>
        {!archived ? (
          <View className="px-1.5 py-px rounded-full border border-border bg-secondary/60">
            <Text className="text-micro text-muted-foreground">
              {t(SCOPE_BADGE_KEY[scopeBadge(agent)])}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}