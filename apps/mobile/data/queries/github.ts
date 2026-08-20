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
  // Issue-scoped PR listing — same key shape as web's githubKeys.pullRequests
  // (packages/core/github/queries.ts:9) so cache scoping matches across clients.
  pullRequests: (issueId: string) => ["github", "pull-requests", issueId] as const,
};

export const githubInstallationsOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: githubKeys.installations(wsId),
    queryFn: () => api.listGitHubInstallations(wsId ?? ""),
    enabled: !!wsId,
  });

/** Linked pull requests of an issue — mirrors web's `issuePullRequestsOptions`
 *  (packages/core/github/queries.ts:35): GET /api/issues/:id/pull-requests.
 *  Issue-scoped (not workspace-scoped) because the endpoint resolves the
 *  workspace server-side from the row itself. */
export const issuePullRequestsOptions = (issueId: string) =>
  queryOptions({
    queryKey: githubKeys.pullRequests(issueId),
    queryFn: ({ signal }) => api.listIssuePullRequests(issueId, { signal }),
    enabled: !!issueId,
  });