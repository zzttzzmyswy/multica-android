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
 *
 * The row is resolved through `recordRead` (MYS-1908): `isLoading` is only
 * true for the first attempt, so branching on `!server` after it reported a
 * failed list read as 「加载 MCP 服务器失败。」 with no way to retry.
 */
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { CatalogStatus } from "@/components/catalog/catalog-status";
import { McpServerForm } from "@/components/mcp/mcp-server-form";
import { workspaceMcpServersOptions } from "@/data/queries/mcp";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { recordRead } from "@/lib/catalog-read";

export default function EditMcpServerPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();

  const serversQ = useQuery(workspaceMcpServersOptions(wsId));
  const server = serversQ.data?.find((s) => s.id === id);
  const read = recordRead(server, [serversQ]);

  if (!read.isResolved) {
    return (
      <View className="flex-1 justify-center bg-background">
        <CatalogStatus
          state={read.state}
          onRetry={read.retry}
          layout="centered"
        />
      </View>
    );
  }

  if (!server) {
    return (
      <View className="flex-1 justify-center bg-background">
        <CatalogStatus
          state="empty"
          onRetry={read.retry}
          emptyMessage={t("mcp.notFound")}
          layout="centered"
        />
      </View>
    );
  }

  return (
    <McpServerForm
      server={{ id: server.id, name: server.name, transport: server.transport }}
      existingNames={(serversQ.data ?? []).map((s) => s.name)}
    />
  );
}