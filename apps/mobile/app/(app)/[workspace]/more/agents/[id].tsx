/**
 * Agent detail screen. Reached from the agents list row. Mirrors
 * `packages/views/agents` semantics — the management surface (edit / archive /
 * restore / environment) lives behind the header "⋯" menu (MYS-330):
 *
 *  - Header: avatar + name + lifecycle pill + "⋯" action menu + 2-line
 *    description. Archived agents show a banner with a Restore action.
 *  - Profile: model, visibility, runtime mode, runtime presence (dot +
 *    availability label), owner, created date.
 *  - Running tasks: the workspace agent-task snapshot filtered to this agent
 *    — every active task plus each agent's most recent terminal task. Rows
 *    carry the task status (share `enum.taskStatus` vocabulary with the issue
 *    runs sheet) and the trigger summary; rows with an issue_id link into the
 *    issue. Order: running → dispatched → queued → terminal, then time.
 *
 * Archived agents render dimmed with the archived availability; their
 * leftover snapshot tasks would still read as stale, so the task section
 * hides them (a retired agent can't have "running" work).
 */
import { useMemo } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  View,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { AgentTask } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { PresenceDot } from "@/components/ui/presence-dot";
import { AgentDetailActions } from "@/components/agent/agent-detail-actions";
import { AgentMcpSection } from "@/components/agent/agent-mcp-section";
import { agentListAllOptions } from "@/data/queries/agents";
import { agentTaskSnapshotOptions } from "@/data/queries/agent-task-snapshot";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { useRestoreAgent } from "@/data/mutations/agents";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useActorLookup } from "@/data/use-actor-name";
import { useWorkspacePresenceMap } from "@/lib/use-agent-presence";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { formatDateTime } from "@/lib/autopilot-format";
import { cn } from "@/lib/utils";

function isArchived(agent: { archived_at?: string | null; status?: string }) {
  return !!agent.archived_at || String(agent.status) === "archived";
}

// availability enum → i18n key + text color for the detail presence line.
const AVAILABILITY: Record<
  string,
  { label: string; className: string }
> = {
  online: { label: "agents.availability.online", className: "text-success" },
  unstable: { label: "agents.availability.unstable", className: "text-warning" },
  offline: { label: "agents.availability.offline", className: "text-muted-foreground" },
  archived: { label: "agents.availability.archived", className: "text-muted-foreground" },
};

function availabilityVisual(a: string) {
  return AVAILABILITY[a] ?? {
    label: "agents.availability.offline",
    className: "text-muted-foreground",
  };
}

const RUNTIME_MODE_KEY: Record<string, string> = {
  local: "agents.runtime.local",
  cloud: "agents.runtime.cloud",
};

const VISIBILITY_KEY: Record<string, string> = {
  workspace: "agents.visibility.workspace",
  private: "agents.visibility.private",
};

// Task status → sort tier + status color (shares the runs-sheet vocabulary).
const TASK_ORDER: Record<string, number> = {
  running: 0,
  dispatched: 1,
  queued: 2,
  completed: 3,
  failed: 4,
  cancelled: 5,
};
const TASK_CLASS: Record<string, string> = {
  queued: "text-muted-foreground",
  dispatched: "text-brand",
  waiting_local_directory: "text-muted-foreground",
  running: "text-brand",
  completed: "text-muted-foreground",
  failed: "text-destructive",
  cancelled: "text-muted-foreground",
};

const ACTIVE_STATUSES: ReadonlySet<string> = new Set([
  "queued",
  "dispatched",
  "waiting_local_directory",
  "running",
]);

export default function AgentDetailPage() {
  const { id } = useLocalSearchParams<{ id: string; workspace: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const { getName } = useActorLookup();

  const agents = useQuery(agentListAllOptions(wsId));
  const tasks = useQuery(agentTaskSnapshotOptions(wsId));
  const runtimes = useQuery(runtimeListOptions(wsId));
  const presence = useWorkspacePresenceMap(wsId);
  const restoreAgent = useRestoreAgent();

  const agent = agents.data?.find((a) => a.id === id);
  const archived = agent != null && isArchived(agent);
  const restoreWithFeedback = () => {
    if (!agent) return;
    restoreAgent.mutate(agent.id, {
      onError: (err) =>
        Alert.alert(
          t("agents.detail.restoreFailedTitle"),
          err instanceof Error && err.message
            ? err.message
            : t("agents.detail.restoreFailedMessage"),
        ),
    });
  };
  const detail = agent ? presence.byAgent.get(agent.id) : undefined;
  const availability = archived
    ? "archived"
    : (detail?.availability ?? "offline");
  const visual = availabilityVisual(availability);

  const agentTasks = useMemo(() => {
    const filtered = (tasks.data ?? []).filter((task) => task.agent_id === id);
    if (archived) return [];
    return [...filtered].sort((a, b) => {
      const oa = TASK_ORDER[a.status] ?? 9;
      const ob = TASK_ORDER[b.status] ?? 9;
      if (oa !== ob) return oa - ob;
      return (a.created_at ?? "").localeCompare(b.created_at ?? "");
    });
  }, [tasks.data, id, archived]);

  const runtime = runtimes.data?.find((r) => r.id === agent?.runtime_id) ?? null;
  const runtimeBound = runtime != null;

  if (agents.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (!agent) {
    return (
      <View className="flex-1 items-center justify-center px-6 bg-background">
        <Text className="text-sm text-muted-foreground text-center">
          {t("agents.emptyTitle")}
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      className="flex-1 bg-background"
      contentContainerClassName="pb-8"
      data={agentTasks}
      keyExtractor={(task) => task.id}
      refreshControl={
        <RefreshControl
          refreshing={agents.isRefetching || tasks.isRefetching}
          onRefresh={() => {
            void agents.refetch();
            void tasks.refetch();
            void runtimes.refetch();
          }}
          tintColor={theme.mutedForeground}
        />
      }
      ListHeaderComponent={
        <>
          {/* Header */}
          <View className="px-4 pt-4 flex-row items-center gap-3">
            <View className={cn(archived && "opacity-60")}>
              <ActorAvatar type="agent" id={agent.id} size={56} />
            </View>
            <View className={cn("flex-1 min-w-0 gap-0.5", archived && "opacity-60")}>
              <Text className="text-base font-semibold text-foreground">
                {agent.name}
              </Text>
              <View className="flex-row items-center gap-1.5">
                <PresenceDot availability={availability} size={8} />
                <Text className={cn("text-xs", visual.className)}>
                  {t(visual.label)}
                </Text>
              </View>
            </View>
            {archived ? (
              <View className="px-2 py-0.5 rounded-full border border-border bg-muted">
                <Text className="text-[11px] font-medium text-muted-foreground">
                  {t("agents.status.archived")}
                </Text>
              </View>
            ) : null}
            <AgentDetailActions agent={agent} />
          </View>
          {agent.description ? (
            <Text className="px-4 pt-2 text-sm text-muted-foreground">
              {agent.description}
            </Text>
          ) : null}
          {archived ? (
            <View className="mx-4 mt-3 flex-row items-center justify-between gap-3 rounded-md border border-border bg-secondary/50 px-3 py-2.5">
              <Text className="flex-1 text-xs text-muted-foreground leading-5">
                {t("agents.detail.archivedBanner")}
              </Text>
              <Pressable
                onPress={restoreWithFeedback}
                disabled={restoreAgent.isPending}
                accessibilityRole="button"
                accessibilityLabel={t("agents.detail.menu.restore")}
                className="active:opacity-70"
              >
                <Text className="text-xs font-semibold text-brand">
                  {restoreAgent.isPending
                    ? t("agents.detail.restoring")
                    : t("agents.detail.menu.restore")}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {/* Profile */}
          <SectionTitle>{t("agents.detail.properties")}</SectionTitle>
          <View className="px-4 gap-3">
            {agent.model ? (
              <PropertyRow label={t("agents.detail.fieldModel")} icon="cog-outline">
                <Text className="flex-1 text-sm text-foreground">
                  {agent.model}
                </Text>
              </PropertyRow>
            ) : null}
            <PropertyRow label={t("agents.detail.fieldVisibility")} icon="eye-outline">
              <Text className="flex-1 text-sm text-foreground">
                {VISIBILITY_KEY[agent.visibility]
                  ? t(VISIBILITY_KEY[agent.visibility])
                  : agent.visibility}
              </Text>
            </PropertyRow>
            <PropertyRow label={t("agents.detail.fieldRuntimeMode")} icon="git-branch-outline">
              <Text className="flex-1 text-sm text-foreground">
                {RUNTIME_MODE_KEY[agent.runtime_mode]
                  ? t(RUNTIME_MODE_KEY[agent.runtime_mode])
                  : agent.runtime_mode}
              </Text>
            </PropertyRow>
            <PropertyRow label={t("agents.detail.fieldRuntime")} icon="hardware-chip-outline">
              {runtimeBound ? (
                <View className="flex-1 flex-row items-center gap-1.5">
                  <PresenceDot availability={availability} size={7} />
                  <Text className="shrink text-sm text-foreground" numberOfLines={1}>
                    {runtime.name}
                  </Text>
                </View>
              ) : (
                <Text className="flex-1 text-sm text-muted-foreground">
                  {t("agents.runtime.unbound")}
                </Text>
              )}
            </PropertyRow>
            {agent.owner_id ? (
              <PropertyRow label={t("agents.detail.fieldOwner")} icon="person-outline">
                <Text className="flex-1 text-sm text-foreground">
                  {getName("member", agent.owner_id)}
                </Text>
              </PropertyRow>
            ) : null}
            {agent.created_at ? (
              <PropertyRow label={t("agents.detail.fieldCreated")} icon="time-outline">
                <Text className="flex-1 text-sm text-foreground tabular-nums">
                  {formatDateTime(agent.created_at)}
                </Text>
              </PropertyRow>
            ) : null}
          </View>

          {/* MCP servers — archived agents render none (a retired agent can't
              be assigned MCP servers). */}
          {!archived ? <AgentMcpSection agent={agent} /> : null}

          {/* Tasks */}
          <SectionTitle>{t("agents.detail.tasks")}</SectionTitle>
          {agentTasks.length === 0 ? (
            <Text className="px-4 text-sm text-muted-foreground">
              {t("agents.detail.noTasks")}
            </Text>
          ) : null}
        </>
      }
      renderItem={({ item }) => (
        <TaskRow task={item} wsSlug={wsSlug} theme={theme} />
      )}
      ItemSeparatorComponent={() => <View className="h-px bg-border ml-4" />}
    />
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text className="px-4 pt-5 pb-2 text-xs uppercase tracking-wider text-muted-foreground font-medium">
      {children}
    </Text>
  );
}

function PropertyRow({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  children: React.ReactNode;
}) {
  const { colorScheme } = useColorScheme();
  return (
    <View className="flex-row items-center gap-2">
      <Ionicons
        name={icon}
        size={15}
        color={THEME[colorScheme].mutedForeground}
      />
      <Text className="w-20 text-xs text-muted-foreground">{label}</Text>
      <View className="flex-1 flex-row items-center">{children}</View>
    </View>
  );
}

function TaskRow({
  task,
  wsSlug,
  theme,
}: {
  task: AgentTask;
  wsSlug: string | null;
  theme: (typeof THEME)["light"];
}) {
  const { t } = useTranslation();
  const statusLabel = t(`enum.taskStatus.${task.status}`);
  const statusClass = TASK_CLASS[task.status] ?? "text-muted-foreground";
  const active = ACTIVE_STATUSES.has(task.status);
  const hasIssue = Boolean(task.issue_id);
  const summary = task.trigger_summary?.trim();
  const time = task.completed_at || task.created_at;

  const content = (
    <View className="flex-row items-center gap-3 px-4 py-2.5">
      <View
        className={cn(
          "size-2 rounded-full",
          active ? "bg-brand" : task.status === "failed" ? "bg-destructive" : "bg-muted",
        )}
      />
      <View className="flex-1 min-w-0 gap-0.5">
        <Text className={cn("text-xs font-medium", statusClass)}>
          {statusLabel}
        </Text>
        {summary ? (
          <Text className="text-sm text-foreground" numberOfLines={2}>
            {summary}
          </Text>
        ) : null}
        <Text className="text-[11px] text-muted-foreground/70 tabular-nums">
          {time ? formatDateTime(time) : ""}
        </Text>
      </View>
      {hasIssue ? (
        <Ionicons
          name="open-outline"
          size={16}
          color={theme.mutedForeground}
        />
      ) : null}
    </View>
  );

  if (hasIssue && wsSlug && task.issue_id) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("a11y.openIssue")}
        onPress={() => router.push(`/${wsSlug}/issue/${task.issue_id}`)}
        className="active:bg-secondary"
      >
        {content}
      </Pressable>
    );
  }
  return content;
}