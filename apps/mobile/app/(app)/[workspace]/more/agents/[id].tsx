/**
 * Agent detail screen. Reached from the agents list row. Mirrors
 * `packages/views/agents` semantics — the management surface (edit / archive /
 * restore / environment) lives behind the header "⋯" menu (MYS-330):
 *
 *  - Header: avatar + name + lifecycle pill + "⋯" action menu + 2-line
 *    description. Archived agents show a banner with a Restore action.
 *  - Profile: model, visibility, runtime mode, runtime presence (dot +
 *    availability label), owner, created date.
 *  - Access (owner editable, MUL-3963 parity) and MCP servers.
 *  - Activity: `AgentActivitySection` — web Activity-tab port (Now / Last 30
 *    days / Recent work), replacing the old mixed snapshot list.
 *
 * Archived agents render dimmed with the archived availability; their
 * leftover snapshot tasks would still read as stale, so the activity
 * section hides them (a retired agent can't have "running" work).
 */
import { Alert, ActivityIndicator, FlatList, Pressable, RefreshControl, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { PresenceDot } from "@/components/ui/presence-dot";
import { AgentDetailActions } from "@/components/agent/agent-detail-actions";
import { AgentMcpSection } from "@/components/agent/agent-mcp-section";
import { AgentAccessPicker } from "@/components/agent/agent-access-picker";
import { AgentActivitySection } from "@/components/agent/agent-activity-section";
import { agentListAllOptions } from "@/data/queries/agents";
import { memberListOptions } from "@/data/queries/members";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { useRestoreAgent } from "@/data/mutations/agents";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useAuthStore } from "@/data/auth-store";
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

export default function AgentDetailPage() {
  const { id } = useLocalSearchParams<{ id: string; workspace: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const { getName } = useActorLookup();
  const queryClient = useQueryClient();

  const agents = useQuery(agentListAllOptions(wsId));
  const runtimes = useQuery(runtimeListOptions(wsId));
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);
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
      data={[]}
      keyExtractor={(item) => String(item)}
      renderItem={() => null}
      refreshControl={
        <RefreshControl
          refreshing={agents.isRefetching || runtimes.isRefetching}
          onRefresh={() => {
            void agents.refetch();
            void runtimes.refetch();
            // The activity section's task/activity queries are workspace
            // scoped — invalidate their prefixes so a pull also refreshes the
            // Now / Last 30 days / Recent work panels.
            queryClient.invalidateQueries({ queryKey: ["agent-task-snapshot", wsId] });
            queryClient.invalidateQueries({ queryKey: ["agent-tasks", wsId] });
            queryClient.invalidateQueries({ queryKey: ["agent-activity", wsId] });
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

          {/* Access — owner edits grants, everyone else sees a read-only
              summary (iteration-84 A8, MUL-3963 parity). The picker renders
              its own section header (px-4 title), so the wrapper only adds
              the section gap. */}
          {!archived ? (
            <View className="pt-5">
              <AgentAccessPicker
                agent={agent}
                members={members}
                currentUserId={currentUserId}
              />
            </View>
          ) : null}

          {/* MCP servers — archived agents render none (a retired agent can't
              be assigned MCP servers). */}
          {!archived ? <AgentMcpSection agent={agent} /> : null}

          {/* Activity — Now / Last 30 days / Recent work (web activity-tab
              port). Archived agents hide it: leftover snapshot tasks would
              read as stale. */}
          {!archived ? (
            <AgentActivitySection
              agent={agent}
              wsSlug={wsSlug}
              agents={agents.data}
            />
          ) : null}
        </>
      }
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