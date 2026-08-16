/**
 * Edit MCP server route. Library entries are write-only, so this is a
 * re-supply form: the name is kept and the form opens on the summary
 * transport; every config field starts empty (a note on the form says so).
 * SUBMIT PUTs /api/workspaces/:id/mcp-servers/:id and pops back.
 *
 * A server whose summary transport the guided form cannot express (sse /
 * unknown; mobile has no JSON editor like web) is read-only here — editing
 * it would silently rewrite its protocol, so the form is not rendered.
 */
import { ActivityIndicator, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { McpServerForm } from "@/components/mcp/mcp-server-form";
import { workspaceMcpServersOptions } from "@/data/queries/mcp";
import { useWorkspaceStore } from "@/data/workspace-store";
import { formCanExpressTransport, transportLabel } from "@/lib/mcp-config";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

export default function EditMcpServerPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;

  const { data, isLoading } = useQuery(workspaceMcpServersOptions(wsId));
  const server = data?.find((s) => s.id === id);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (!server) {
    return (
      <View className="flex-1 items-center justify-center px-6 bg-background">
        <Text className="text-sm text-muted-foreground text-center">
          {t("mcp.loadError")}
        </Text>
      </View>
    );
  }

  if (!formCanExpressTransport(server.transport)) {
    return (
      <View className="flex-1 items-center justify-center px-8 gap-2 bg-background">
        <Ionicons name="lock-closed-outline" size={30} color={muted} />
        <Text className="text-sm text-muted-foreground text-center">
          {t("mcp.notEditable")} ({transportLabel(server.transport)})
        </Text>
      </View>
    );
  }

  return (
    <McpServerForm
      server={{ id: server.id, name: server.name, transport: server.transport }}
      existingNames={(data ?? []).map((s) => s.name)}
    />
  );
}