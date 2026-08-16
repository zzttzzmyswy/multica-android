/**
 * Personal access token mutations. Mirrors the web tokens-tab flow
 * (packages/views/settings/components/tokens-tab.tsx): create invalidates
 * the list, revoke waits for server confirmation then invalidates.
 *
 * No optimistic patches: a token row's authoritative state comes from the
 * server, and the created full token is a one-shot secret held by the
 * screen — it must never be written into the query cache.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreatePersonalAccessTokenRequest } from "@multica/core/types";
import { api } from "@/data/api";
import { tokenKeys } from "@/data/queries/tokens";

export function useCreateToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePersonalAccessTokenRequest) =>
      api.createPersonalAccessToken(body),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: tokenKeys.all() });
    },
  });
}

export function useRevokeToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.revokePersonalAccessToken(id),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: tokenKeys.all() });
    },
  });
}