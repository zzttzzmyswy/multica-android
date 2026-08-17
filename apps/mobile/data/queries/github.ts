import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

// GitHub integration queries (iteration-52) — mirrors packages/core/github/
// queries.ts bound to mobile's ApiClient. Installations gate the integration
// status view and the "import from GitHub" repository browser.
export const githubKeys = {
  all: (wsId: string | null) => ["github", wsId] as const,
  installations: (wsId: string | null) =>
    [...githubKeys.all(wsId), "installations"] as const,
  repositories: (wsId: string | null, installationId: string) =>
    [...githubKeys.all(wsId), "installations", installationId, "repositories"] as const,
};

export const githubInstallationsOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: githubKeys.installations(wsId),
    queryFn: () => api.listGitHubInstallations(wsId ?? ""),
    enabled: !!wsId,
  });