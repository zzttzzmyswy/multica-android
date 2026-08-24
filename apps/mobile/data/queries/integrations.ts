import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

// External-channel installs (iteration-98 / A14) — Lark / Slack / DingTalk /
// WeCom per-agent bindings. Mirrors packages/core/{lark,slack,dingtalk,wecom}/
// queries.ts bound to mobile's ApiClient. Each key namespace is scoped under
// the workspace id and follows the web key shape so cache semantics match
// across clients.
export const larkKeys = {
  all: (wsId: string | null) => ["lark", wsId] as const,
  installations: (wsId: string | null) =>
    [...larkKeys.all(wsId), "installations"] as const,
};

export const larkInstallationsOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: larkKeys.installations(wsId),
    queryFn: () => api.listLarkInstallations(wsId ?? ""),
    enabled: !!wsId,
  });

export const slackKeys = {
  all: (wsId: string | null) => ["slack", wsId] as const,
  installations: (wsId: string | null) =>
    [...slackKeys.all(wsId), "installations"] as const,
};

export const slackInstallationsOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: slackKeys.installations(wsId),
    queryFn: () => api.listSlackInstallations(wsId ?? ""),
    enabled: !!wsId,
  });

export const dingtalkKeys = {
  all: (wsId: string | null) => ["dingtalk", wsId] as const,
  installations: (wsId: string | null) =>
    [...dingtalkKeys.all(wsId), "installations"] as const,
};

export const dingtalkInstallationsOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: dingtalkKeys.installations(wsId),
    queryFn: () => api.listDingTalkInstallations(wsId ?? ""),
    enabled: !!wsId,
  });

export const wecomKeys = {
  all: (wsId: string | null) => ["wecom", wsId] as const,
  installations: (wsId: string | null) =>
    [...wecomKeys.all(wsId), "installations"] as const,
};

export const wecomInstallationsOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: wecomKeys.installations(wsId),
    queryFn: () => api.listWecomInstallations(wsId ?? ""),
    enabled: !!wsId,
  });

/** Listing shape shared by the four channel endpoints. Kept structural so the
 *  per-channel schemas stay interchangeable here. */
export interface ChannelListing<T> {
  installations: T[];
  configured?: boolean;
  install_supported?: boolean;
}

/** Derived per-agent channel state used by the agent Integrations page to pick
 *  copy per channel. Mirrors web's integrations-tab.tsx branch order:
 *  `configured` gates everything (false → "ask the operator"); `install_supported`
 *  gates NEW installs only — an already-bound agent still renders its connected
 *  card, so an unbound agent with install_supported=false surfaces "coming soon".
 *  `activeInstall` is the first ACTIVE installation bound to `agentId` (revoked
 *  rows are kept for audit but never render as connected). Each flag defaults to
 *  the safe read-only value when an older backend omits it. */
export function channelState<
  T extends { agent_id: string; status: string },
>(
  listing: ChannelListing<T> | undefined,
  agentId: string,
): {
  configured: boolean;
  installSupported: boolean;
  activeInstall: T | null;
} {
  return {
    configured: listing?.configured === true,
    installSupported: listing?.install_supported === true,
    activeInstall:
      listing?.installations.find(
        (inst) => inst.agent_id === agentId && inst.status === "active",
      ) ?? null,
  };
}