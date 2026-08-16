/**
 * Agent detail MCP section (mobile mirror of web's agent mcp-config-tab
 * workspace-assignment half). Renders between the profile and the tasks list:
 *
 *  - The workspace MCP servers ASSIGNED to this agent, each with its own
 *    on/off toggle. A library entry does nothing until it is added here.
 *  - "Add" surfaces every library server the agent does not yet have (an
 *    entry the agent already has is never re-offered).
 *  - The toggle flips optimistically and rolls back on failure (mutation owns
 *    that); remove confirms first — "the agent will no longer use this server".
 *  - Archived agents render no MCP section at all (retired agents can't run).
 *
 * The assignment list is member-readable/writable like web's (canEdit=true on
 * the detail page); the write-only library management itself stays owner/admin
 * in More → MCP Servers.
 */
import { useCallback, useMemo } from "react";
import { ActivityIndicator, Alert, Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Agent } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { agentMcpServersOptions, workspaceMcpServersOptions } from "@/data/queries/mcp";
import {
  useAddAgentMcpServer,
  useRemoveAgentMcpServer,
  useSetAgentMcpServerEnabled,
} from "@/data/mutations/mcp";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { ActionSheet } from "@/lib/action-sheet";
import { transportLabel } from "@/lib/mcp-config";

export function AgentMcpSection({ agent }: { agent: Agent }) {
  const wsId = agent.workspace_id || "";
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;

  const assignedQuery = agentMcpServersOptions(agent.id);
  const { data: assigned = [], isLoading, error, refetch } =
    useQuery(assignedQuery);
  const { data: library = [] } = useQuery(workspaceMcpServersOptions(wsId));

  const addServer = useAddAgentMcpServer(agent.id);
  const setServerEnabled = useSetAgentMcpServerEnabled(agent.id);
  const removeServer = useRemoveAgentMcpServer(agent.id);

  const assignedIds = useMemo(
    () => new Set(assigned.map((server) => server.id)),
    [assigned],
  );
  const available = useMemo(
    () => library.filter((server) => !assignedIds.has(server.id)),
    [library, assignedIds],
  );

  const busy = addServer.isPending || setServerEnabled.isPending || removeServer.isPending;

  const openAddPicker = useCallback(() => {
    if (available.length === 0) return;
    const labels = available.map((server) => `${server.name} (${transportLabel(server.transport)})`);
    const cancelLabel = t("common.cancel");
    const cancelButtonIndex = labels.length;
    ActionSheet.showActionSheetWithOptions(
      {
        title: t("mcp.agent.add"),
        options: [...labels, cancelLabel],
        cancelButtonIndex,
      },
      (index) => {
        if (index === undefined || index < 0 || index >= available.length) return;
        const server = available[index];
        addServer.mutate(server.id, {
          onError: (err) =>
            Alert.alert(
              t("mcp.agent.actionFailed"),
              err instanceof Error ? err.message : t("common.unknownError"),
            ),
        });
      },
    );
  }, [available, addServer, t]);

  const confirmRemove = useCallback(
    (serverId: string, name: string) => {
      Alert.alert(
        t("mcp.agent.removeConfirmTitle"),
        t("mcp.agent.removeConfirmMessage", { name }),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("mcp.agent.removeAction"),
            style: "destructive",
            onPress: () =>
              removeServer.mutate(serverId, {
                onError: (err) =>
                  Alert.alert(
                    t("mcp.agent.removeFailed"),
                    err instanceof Error ? err.message : t("common.unknownError"),
                  ),
              }),
          },
        ],
      );
    },
    [removeServer, t],
  );

  return (
    <View className="mt-1">
      <View className="px-4 pt-5 pb-2 flex-row items-center justify-between gap-3">
        <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          {t("mcp.agent.title")}
        </Text>
        {available.length > 0 ? (
          <Button variant="outline" size="sm" onPress={openAddPicker} disabled={busy}>
            <Ionicons name="add" size={14} color={muted} />
            <Text>{t("mcp.agent.add")}</Text>
          </Button>
        ) : null}
      </View>
      <View className="px-4 gap-2">
        <Text className="text-[11px] text-muted-foreground/80 leading-4">
          {t("mcp.agent.hint")}
        </Text>

        {isLoading ? (
          <View className="py-3 items-center">
            <ActivityIndicator />
          </View>
        ) : error ? (
          <Pressable
            onPress={() => void refetch()}
            accessibilityRole="button"
            className="py-3"
          >
            <Text className="text-xs text-destructive">
              {t("mcp.agent.loadError")} {t("workspace.retry")}
            </Text>
          </Pressable>
        ) : assigned.length === 0 ? (
          <Text className="text-xs text-muted-foreground/80 py-1">
            {library.length === 0
              ? t("mcp.agent.libraryEmpty")
              : t("mcp.agent.noneAssigned")}
          </Text>
        ) : (
          <View className="overflow-hidden rounded-md border border-border bg-secondary/30">
            {assigned.map((server, index) => (
              <View
                key={server.id}
                className={index > 0 ? "border-t border-border px-3 py-2.5 flex-row items-center gap-3" : "px-3 py-2.5 flex-row items-center gap-3"}
              >
                <Ionicons name="server-outline" size={16} color={muted} />
                <View className="flex-1 min-w-0 gap-0.5">
                  <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                    {server.name}
                  </Text>
                  <Text className="text-[11px] text-muted-foreground uppercase">
                    {transportLabel(server.transport)}
                  </Text>
                </View>
                <Switch
                  checked={server.enabled !== false}
                  disabled={busy}
                  onCheckedChange={(value) =>
                    setServerEnabled.mutate(
                      { serverId: server.id, enabled: value },
                      {
                        onError: (err) =>
                          Alert.alert(
                            t("mcp.agent.toggleFailed"),
                            err instanceof Error ? err.message : t("common.unknownError"),
                          ),
                      },
                    )
                  }
                  accessibilityLabel={t("mcp.agent.toggleAria", { name: server.name })}
                />
                <Pressable
                  onPress={() => confirmRemove(server.id, server.name)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={t("mcp.agent.removeAria", { name: server.name })}
                  className="p-1"
                >
                  <Ionicons name="trash-outline" size={16} color={muted} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}