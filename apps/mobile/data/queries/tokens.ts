/**
 * Personal access token list — account-level, mirrors the web tokens-tab
 * (packages/views/settings/components/tokens-tab.tsx reads GET /api/tokens
 * via the same core client methods). No workspace in the key: tokens belong
 * to the signed-in account, not to a workspace.
 */
import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

export const tokenKeys = {
  all: () => ["personalAccessTokens"] as const,
};

export const tokenListOptions = () =>
  queryOptions({
    queryKey: tokenKeys.all(),
    queryFn: ({ signal }) => api.listPersonalAccessTokens({ signal }),
  });