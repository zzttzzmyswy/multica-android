/**
 * MCP server queries — the workspace library (what an owner/admin manages and
 * an agent owner picks from) and per-agent assignments. Root keys mirror
 * web's `workspaceKeys.mcpServers` / `agentMcpServersOptions`. The library
 * listing is member-visible; writes are owner/admin only (enforced client-side
 * by hiding the affordances, server-side by the API).
 */
import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

export const mcpKeys = {
  workspace: (wsId: string | null) =>
    ["workspaces", wsId, "mcp-servers"] as const,
  agent: (agentId: string) => ["agents", agentId, "mcp-servers"] as const,
};

export const workspaceMcpServersOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: mcpKeys.workspace(wsId),
    queryFn: () => api.listWorkspaceMcpServers(wsId ?? ""),
    enabled: !!wsId,
  });

export const agentMcpServersOptions = (agentId: string) =>
  queryOptions({
    queryKey: mcpKeys.agent(agentId),
    queryFn: () => api.listAgentMcpServers(agentId),
    enabled: !!agentId,
  });