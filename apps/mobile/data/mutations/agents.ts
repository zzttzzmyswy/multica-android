/**
 * Agent mutations. v1 has a single surface: `useCreateAgent` for the manual
 * create flow. Deliberately not optimistic (mirrors web
 * `use-create-agent-submit.ts`): the manual form navigates to the new agent's
 * detail screen on success, so the agent has to exist before the destination
 * renders. The list cache is just refetched on settle — no patch, no rollback.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateAgentRequest } from "@multica/core/types";
import { api } from "@/data/api";
import { agentKeys } from "@/data/queries/agents";
import { useWorkspaceStore } from "@/data/workspace-store";

export function useCreateAgent() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (data: CreateAgentRequest) => api.createAgent(data),
    onSettled: () => {
      if (!wsId) return;
      void qc.invalidateQueries({ queryKey: agentKeys.list(wsId) });
    },
  });
}