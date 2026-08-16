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
import { useCallback, useMemo } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
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
import { useWorkspaceStore } from "@/data/workspace-store";
import { useWorkspacePresenceMap } from "@/lib/use-agent-presence";
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

export default function AgentsPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;

  const { data, isLoading, error, refetch, isRefetching } = useQuery(
    agentListAllOptions(wsId),
  );
  const presence = useWorkspacePresenceMap(wsId);

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

  const showEmpty = !isLoading && !error && (data ?? []).length === 0;

  // "New" header action — opens the create-method chooser (mirrors the
  // skills/autopilots "+" header action).
  const headerRight = useCallback(() => {
    if (!wsSlug) return null;
    return (
      <IconButton
        name="add"
        onPress={() => router.push(`/${wsSlug}/more/agents/new`)}
        accessibilityLabel={t("agents.createButton")}
      />
    );
  }, [wsSlug, t]);

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
          <FlatList
            data={sorted}
            keyExtractor={(item) => item.id}
            ItemSeparatorComponent={() => <View className="h-px bg-border ml-4" />}
            contentContainerClassName="pb-6"
            renderItem={({ item }) => (
              <AgentRow
                agent={item}
                presenceDetail={presence.byAgent.get(item.id)}
                onPress={() => {
                  if (wsSlug) router.push(`/${wsSlug}/more/agents/${item.id}`);
                }}
              />
            )}
            refreshing={isRefetching}
            onRefresh={refetch}
          />
        )}
      </View>
    </>
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
          </View>
        </View>
        {!archived ? (
          <Ionicons name="chevron-forward" size={14} color={muted} />
        ) : null}
      </View>
    </Pressable>
  );
}