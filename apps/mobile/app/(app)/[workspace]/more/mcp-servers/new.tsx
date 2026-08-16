/**
 * New MCP server route. Renders the shared create form — name (required) +
 * transport (stdio/http) + transport-specific config. SUBMIT POSTs
 * /api/workspaces/:id/mcp-servers and pops back to the list, which refreshes
 * on the create invalidate.
 */
import { KeyboardAvoidingView, ScrollView } from "react-native";
import { McpServerForm } from "@/components/mcp/mcp-server-form";
import { useWorkspaceStore } from "@/data/workspace-store";
import { keyboardBehavior } from "@/lib/keyboard";

export default function NewMcpServerPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={keyboardBehavior}
    >
      <ScrollView
        className="flex-1"
        contentContainerClassName="pb-10"
        keyboardShouldPersistTaps="handled"
      >
        <McpServerForm key={wsId ?? "ws"} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}