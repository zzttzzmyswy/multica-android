/**
 * Workspace MCP server library page (push screen reached from the More
 * popover). Mirrors web `packages/views/settings/components/mcp-tab.tsx`:
 *
 *  - A library entry is given to NO agent — an agent gets it only from its own
 *    MCP section, where each assignment has a per-agent toggle.
 *  - Stored configs are WRITE-ONLY: rows show name + transport only; edits
 *    re-supply the configuration.
 *  - Write affordances (add / edit / remove) appear only for workspace
 *    owner/admin — everyone else gets a read-only list + a note. Unknown
 *    transports (sse/…) are not form-editable (mobile has no JSON editor), so
 *    those rows show transport only, with removal still available.
 *  - Deleting removes the entry AND every agent assignment (server-side);
 *    confirm copy says so.
 */
import { useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  View,
} from "react-native";
import { Stack, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { WorkspaceMcpServer } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { workspaceMcpServersOptions } from "@/data/queries/mcp";
import { memberListOptions } from "@/data/queries/members";
import { useDeleteWorkspaceMcpServer } from "@/data/mutations/mcp";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useAuthStore } from "@/data/auth-store";
import { formCanExpressTransport, transportLabel } from "@/lib/mcp-config";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

export default function McpServersPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const user = useAuthStore((s) => s.user);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;

  const { data, isLoading, error, refetch, isRefetching } = useQuery(
    workspaceMcpServersOptions(wsId),
  );
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const currentMember = members.find((m) => m.user_id === user?.id);
  const canManage =
    currentMember?.role === "owner" || currentMember?.role === "admin";
  const removeServer = useDeleteWorkspaceMcpServer();

  const servers = data ?? [];

  const confirmDelete = useCallback(
    (server: WorkspaceMcpServer) => {
      Alert.alert(t("mcp.deleteTitle"), t("mcp.deleteMessage", { name: server.name }), [
        { text: t("mcp.cancel"), style: "cancel" },
        {
          text: t("mcp.deleteConfirm"),
          style: "destructive",
          onPress: () => {
            removeServer.mutate(server.id, {
              onError: (err) =>
                Alert.alert(
                  t("mcp.deleteFailed"),
                  err instanceof Error ? err.message : t("common.unknownError"),
                ),
            });
          },
        },
      ]);
    },
    [removeServer, t],
  );

  const headerRight = useCallback(() => {
    if (!wsSlug || !canManage) return null;
    return (
      <IconButton
        name="add"
        onPress={() => router.push(`/${wsSlug}/more/mcp-servers/new`)}
        accessibilityLabel={t("mcp.addServer")}
      />
    );
  }, [wsSlug, canManage, t]);

  const showEmpty = !isLoading && !error && servers.length === 0;

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
              {t("mcp.loadError")}
              {error instanceof Error ? error.message : t("common.unknownError")}
            </Text>
            <Button variant="outline" onPress={() => refetch()}>
              <Text>{t("workspace.retry")}</Text>
            </Button>
          </View>
        ) : showEmpty ? (
          <View className="flex-1 items-center justify-center px-6 gap-1">
            <Ionicons name="server-outline" size={32} color={muted} />
            <Text className="text-sm text-muted-foreground text-center mt-2">
              {t("mcp.emptyTitle")}
            </Text>
            <Text className="text-xs text-muted-foreground/70 text-center">
              {t("mcp.emptyDescription")}
            </Text>
            {wsSlug && canManage ? (
              <Button
                variant="outline"
                className="mt-3"
                onPress={() => router.push(`/${wsSlug}/more/mcp-servers/new`)}
              >
                <Ionicons name="add" size={15} color={muted} />
                <Text>{t("mcp.addServer")}</Text>
              </Button>
            ) : null}
          </View>
        ) : (
          <FlatList
            data={servers}
            keyExtractor={(item) => item.id}
            ItemSeparatorComponent={() => <View className="h-px bg-border ml-4" />}
            contentContainerClassName="pb-6"
            renderItem={({ item }) => (
              <McpServerRow
                server={item}
                canManage={canManage}
                onEdit={() => {
                  if (wsSlug)
                    router.push(`/${wsSlug}/more/mcp-servers/${item.id}`);
                }}
                onDelete={() => confirmDelete(item)}
              />
            )}
            refreshing={isRefetching}
            onRefresh={refetch}
          />
        )}
        {!canManage && !isLoading && !error ? (
          <View className="px-4 pb-4">
            <Text className="text-xs text-muted-foreground/80">
              {t("mcp.adminOnlyNote")}
            </Text>
          </View>
        ) : null}
      </View>
    </>
  );
}

function McpServerRow({
  server,
  canManage,
  onEdit,
  onDelete,
}: {
  server: WorkspaceMcpServer;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const editable = formCanExpressTransport(server.transport);
  // HTTP-style summary maps to "http" (transportLabel renders it "HTTP");
  // anything unknown (sse/…) shows raw transport and is not form-editable.
  const badge = transportLabel(server.transport);

  return (
    <View className="px-4 py-3 flex-row items-center gap-3">
      <View className="size-8 rounded-lg bg-secondary items-center justify-center">
        <Ionicons name="server" size={16} color={muted} />
      </View>
      <View className="flex-1 min-w-0 gap-0.5">
        <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
          {server.name}
        </Text>
        <View className="flex-row items-center gap-1.5">
          <View className="px-1.5 py-px rounded-full bg-secondary">
            <Text className="text-[10px] font-medium text-muted-foreground uppercase">
              {badge}
            </Text>
          </View>
          {!editable ? (
            <Text className="text-[11px] text-muted-foreground/70">
              {t("mcp.notEditable")}
            </Text>
          ) : null}
        </View>
      </View>
      {canManage ? (
        <View className="flex-row items-center gap-1">
          {editable ? (
            <Pressable
              onPress={onEdit}
              accessibilityRole="button"
              accessibilityLabel={t("mcp.editServer")}
              className="p-2"
            >
              <Ionicons name="pencil" size={17} color={muted} />
            </Pressable>
          ) : null}
          <Pressable
            onPress={onDelete}
            accessibilityRole="button"
            accessibilityLabel={t("mcp.removeServer")}
            className="p-2"
          >
            <Ionicons name="trash-outline" size={17} color={muted} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}