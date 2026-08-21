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
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Agent } from "@multica/core/types";
import { isAgentRuntimeBound, type AgentPresenceDetail } from "@multica/core/agents";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { PresenceDot } from "@/components/ui/presence-dot";
import { agentListAllOptions } from "@/data/queries/agents";
import { memberListOptions } from "@/data/queries/members";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useWorkspacePresenceMap } from "@/lib/use-agent-presence";
import { useAuthStore } from "@/data/auth-store";
import { api } from "@/data/api";
import {
  AgentAccessBatchSheet,
  type AccessChangePick,
} from "@/components/agent/agent-access-batch-sheet";
import {
  accessScopeOfAgent,
  buildAgentBatchSelection,
  matchesAccessFilter,
} from "@/lib/agent-list-access";
import type { AccessScope } from "@/lib/agent-access";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

function isArchived(agent: {
  archived_at?: string | null;
  status?: string;
}): boolean {
  // `status` is server-driven lifecycle (active/archived) but typed as the
  // legacy AgentStatus union — compare through String() to stay honest about
  // runtime values while keeping the archived_at signal authoritative.
  return !!agent.archived_at || String(agent.status) === "archived";
}

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

export default function AgentsPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const qc = useQueryClient();
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);

  const { data, isLoading, error, refetch, isRefetching } = useQuery(
    agentListAllOptions(wsId),
  );
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const presence = useWorkspacePresenceMap(wsId);
  const currentMember = members.find((m) => m.user_id === currentUserId);

  const sorted = useMemo(() => {
    const list = data ?? [];
    const byAgent = presence.byAgent;
    return [...list].sort((a, b) => {
      const aArchived = isArchived(a);
      const bArchived = isArchived(b);
      if (aArchived !== bArchived) return aArchived ? 1 : -1;
      const aCount = byAgent.get(a.id)?.runningCount ?? 0;
      const bCount = byAgent.get(b.id)?.runningCount ?? 0;
      if (bCount !== aCount) return bCount - aCount;
      return a.name.localeCompare(b.name);
    });
  }, [data, presence.byAgent]);

  // ---- Selection / batch state (iteration-84 A8, MUL-4302 parity) ----
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [batchAccess, setBatchAccess] = useState(false);
  const [applyingAccess, setApplyingAccess] = useState(false);
  const [scopeFilter, setScopeFilter] = useState<AccessScope | "all">("all");

  const batch = useMemo(
    () =>
      buildAgentBatchSelection({
        agents: sorted,
        selectedIds,
        currentUserId,
        currentRole: currentMember?.role,
      }),
    [sorted, selectedIds, currentUserId, currentMember?.role],
  );
  const canBatchArchive = batch.manageableIds.length > 0;
  const ownedAccessed = batch.ownedIds.length > 0;

  const filtered = useMemo(() => {
    if (scopeFilter === "all") return sorted;
    return sorted.filter((a) =>
      matchesAccessFilter(a, new Set<AccessScope>([scopeFilter])),
    );
  }, [sorted, scopeFilter]);

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
      current.size === filtered.length
        ? new Set()
        : new Set(filtered.map((a) => a.id)),
    );
  };

  const confirmArchive = () => {
    if (batch.archivableIds.length === 0) return;
    Alert.alert(
      t("agents.batch.confirmArchiveTitle"),
      t("agents.batch.confirmArchiveMessage", { count: batch.selection.length }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("agents.batch.actions.archive"),
          style: "destructive",
          onPress: async () => {
            const res = await runBatch(
              (id) => api.archiveAgent(id),
              batch.archivableIds,
            );
            if (res.failed > 0) Alert.alert(t("common.unknownError"));
          },
        },
      ],
    );
  };

  const restoreBatch = async () => {
    if (batch.archivedIds.length === 0) return;
    const res = await runBatch(
      (id) => api.restoreAgent(id),
      batch.archivedIds,
    );
    if (res.failed > 0) Alert.alert(t("common.unknownError"));
  };

  const applyAccess = async (change: AccessChangePick) => {
    if (!change || applyingAccess || !ownedAccessed) return;
    setApplyingAccess(true);
    try {
      const res = await runBatch(
        (id) => api.updateAgent(id, change),
        batch.ownedIds,
      );
      setApplyingAccess(false);
      setBatchAccess(false);
      Alert.alert(
        t("agents.batch.resultPartial", {
          succeeded: res.succeeded,
          skipped: batch.accessSkipCount,
        }),
      );
    } catch {
      setApplyingAccess(false);
      setBatchAccess(false);
      Alert.alert(t("common.unknownError"));
    }
  };

  const showEmpty = !isLoading && !error && (data ?? []).length === 0;

  // "New" header action — opens the create-method chooser (mirrors the
  // skills/autopilots "+" header action). Selection mode swaps the compose
  // actions for a Done control that exits the mode.
  const headerRight = useCallback(() => {
    if (!wsSlug) return null;
    if (selectionMode) {
      return (
        <Pressable
          onPress={() => {
            setSelectionMode(false);
            setSelectedIds(new Set());
          }}
          accessibilityLabel={t("agents.batch.done")}
        >
          <Text className="text-sm font-medium text-brand">
            {t("agents.batch.done")}
          </Text>
        </Pressable>
      );
    }
    return (
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
            <Text className="text-sm text-destructive">
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
            <Text className="text-sm text-muted-foreground text-center mt-2">
              {t("agents.emptyTitle")}
            </Text>
            <Text className="text-xs text-muted-foreground/70 text-center">
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
                  <Ionicons name="add" size={15} color={THEME[colorScheme].primaryForeground} />
                  <Text>{t("agents.createButton")}</Text>
                </Button>
              </View>
            ) : null}
          </View>
        ) : (
          <>
            {!selectionMode ? (
              <ScopeFilterChips
                value={scopeFilter}
                onChange={setScopeFilter}
              />
            ) : null}
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.id}
              ItemSeparatorComponent={() => <View className="h-px bg-border ml-4" />}
              contentContainerClassName="pb-24"
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
                    onPress={() => {
                      if (wsSlug) router.push(`/${wsSlug}/more/agents/${item.id}`);
                    }}
                  />
                )
              }
              refreshing={isRefetching}
              onRefresh={refetch}
            />
            {selectionMode && batch.selection.length > 0 ? (
              <BatchBar
                count={batch.selection.length}
                allSelected={selectedIds.size === filtered.length}
                anyArchived={batch.archivedIds.length > 0}
                canArchive={canBatchArchive}
                busy={applyingAccess}
                onClear={() => setSelectedIds(new Set())}
                onSelectAll={toggleSelectAll}
                onArchive={confirmArchive}
                onRestore={() => void restoreBatch()}
                onSetAccess={() => {
                  if (!ownedAccessed) {
                    Alert.alert(t("agents.batch.noOwnedSelected"));
                    return;
                  }
                  setBatchAccess(true);
                }}
              />
            ) : null}
          </>
        )}
      </View>
      <AgentAccessBatchSheet
        visible={batchAccess}
        members={members.filter((m) => m.user_id !== currentUserId)}
        applying={applyingAccess}
        onApply={(change) => void applyAccess(change)}
        onClose={() => setBatchAccess(false)}
      />
    </>
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
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="flex-grow-0"
      contentContainerClassName="px-3 py-2 gap-1.5"
    >
      {OPTIONS.map((o) => {
        const active = value === o.value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            className={cn(
              "px-2.5 py-1 rounded-full border",
              active
                ? "bg-secondary border-border"
                : "border-transparent",
            )}
          >
            <Text
              className={cn(
                "text-xs",
                active ? "text-foreground font-medium" : "text-muted-foreground",
              )}
            >
              {t(o.labelKey)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function BatchBar({
  count,
  allSelected,
  anyArchived,
  canArchive,
  busy,
  onClear,
  onSelectAll,
  onArchive,
  onRestore,
  onSetAccess,
}: {
  count: number;
  allSelected: boolean;
  anyArchived: boolean;
  canArchive: boolean;
  busy: boolean;
  onClear: () => void;
  onSelectAll: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onSetAccess: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <View className="absolute bottom-4 left-0 right-0 px-4">
      <View className="flex-row items-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5 shadow-lg">
        <Text className="text-sm font-medium text-foreground tabular-nums">
          {t("agents.batch.selectedCount", { count })}
        </Text>
        {!allSelected ? (
          <Pressable onPress={onSelectAll} disabled={busy} className="px-1.5">
            <Text className="text-xs font-medium text-brand">
              {t("agents.batch.selectAll")}
            </Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onClear} disabled={busy} className="px-1.5">
          <Ionicons name="close" size={16} color={theme.mutedForeground} />
        </Pressable>
        <View className="flex-1" />
        {anyArchived ? (
          <IconButton
            name="refresh-outline"
            onPress={onRestore}
            disabled={!canArchive || busy}
            accessibilityLabel={t("agents.batch.actions.restore")}
          />
        ) : null}
        <IconButton
          name="archive-outline"
          onPress={onArchive}
          disabled={!canArchive || busy}
          accessibilityLabel={t("agents.batch.actions.archive")}
        />
        <IconButton
          name="people-outline"
          onPress={onSetAccess}
          disabled={busy}
          accessibilityLabel={t("agents.batch.actions.setAccess")}
        />
      </View>
    </View>
  );
}

function AgentRow({
  agent,
  presenceDetail,
  onPress,
}: {
  agent: Agent;
  presenceDetail: AgentPresenceDetail | undefined;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const archived = isArchived(agent);
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
              className="flex-1 text-sm font-medium text-foreground"
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
              <Text className="text-[11px] font-medium">
                {t(pill.label)}
              </Text>
            </View>
          </View>
          {agent.description ? (
            <Text className="text-xs text-muted-foreground" numberOfLines={2}>
              {agent.description}
            </Text>
          ) : null}
          <View className="flex-row items-center gap-1.5">
            <PresenceDot availability={availability} size={7} />
            <Text className="text-xs text-muted-foreground">
              {availabilityLabel}
            </Text>
            {!archived && !needsRuntime && activeCount > 0 ? (
              <Text className="text-xs text-muted-foreground">
                · {t("agents.taskCount", { count: activeCount })}
              </Text>
            ) : null}
            {!archived && needsRuntime ? (
              <Text className="text-xs text-amber-600 dark:text-amber-400">
                · {t("agents.needsRuntime")}
              </Text>
            ) : null}
            {!archived && agent.model ? (
              <Text className="text-xs text-muted-foreground/70">
                · {agent.model}
              </Text>
            ) : null}
            {!archived ? (
              <View className="px-1.5 py-px rounded-full border border-border bg-secondary/60">
                <Text className="text-[10px] text-muted-foreground">
                  {t(SCOPE_BADGE_KEY[scopeBadge(agent)])}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
        {!archived ? (
          <Ionicons name="chevron-forward" size={14} color={muted} />
        ) : null}
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
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const theme = THEME[colorScheme];
  const archived = isArchived(agent);
  const availability = archived
    ? "archived"
    : (presenceDetail?.availability ?? "offline");
  const availabilityLabel = AVAILABILITY_KEY[availability]
    ? t(AVAILABILITY_KEY[availability])
    : availability;

  return (
    <Pressable
      onPress={onToggle}
      className={cn("px-4 py-3", !archived && "active:bg-secondary")}
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
            className="text-sm font-medium text-foreground"
            numberOfLines={1}
          >
            {agent.name}
          </Text>
          {agent.description ? (
            <Text className="text-xs text-muted-foreground" numberOfLines={1}>
              {agent.description}
            </Text>
          ) : null}
          <View className="flex-row items-center gap-1.5">
            <PresenceDot availability={availability} size={7} />
            <Text className="text-xs text-muted-foreground">
              {availabilityLabel}
            </Text>
          </View>
        </View>
        {!archived ? (
          <View className="px-1.5 py-px rounded-full border border-border bg-secondary/60">
            <Text className="text-[10px] text-muted-foreground">
              {t(SCOPE_BADGE_KEY[scopeBadge(agent)])}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}