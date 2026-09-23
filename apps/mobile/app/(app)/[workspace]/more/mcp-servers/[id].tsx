/**
 * Edit MCP server route. Library entries are write-only, so this is a
 * re-supply form: the name is kept and the form opens on the summary
 * transport; every config field starts empty (a note on the form says so).
 * SUBMIT PUTs /api/workspaces/:id/mcp-servers/:id and pops back.
 *
 * Every entry is editable. One whose summary transport the guided form cannot
 * express (sse / unknown) opens in the form's JSON editor with the form tab
 * disabled — routing it through the guided form would silently rewrite its
 * protocol, which is why the editor chooses the mode rather than this route
 * refusing to render.
 */
import { ActivityIndicator, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { McpServerForm } from "@/components/mcp/mcp-server-form";
import { workspaceMcpServersOptions } from "@/data/queries/mcp";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";

export default function EditMcpServerPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();

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

  return (
    <McpServerForm
      server={{ id: server.id, name: server.name, transport: server.transport }}
      existingNames={(data ?? []).map((s) => s.name)}
    />
  );
}