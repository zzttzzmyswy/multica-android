/**
 * GitHub App installation mutations (iteration-127).
 *
 * Connect has no mutation: the server mints an install URL and the OAuth
 * handshake happens in the system browser (web `github-tab.tsx:96-125` does
 * the same with `window.open`), so there is nothing to await client-side.
 *
 * Disconnect revokes the installation — mirrors web's
 * `api.deleteGitHubInstallation` (packages/core/api/client.ts:3723) and the
 * `["github", wsId]` invalidation in `github-tab.tsx:113`.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/data/api";
import { githubKeys } from "@/data/queries/github";
import { useWorkspaceStore } from "@/data/workspace-store";

export function useDisconnectGitHubInstallation() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (installationId: string) =>
      api.deleteGitHubInstallation(wsId ?? "", installationId),
    onSuccess: () => qc.invalidateQueries({ queryKey: githubKeys.all(wsId) }),
  });
}
