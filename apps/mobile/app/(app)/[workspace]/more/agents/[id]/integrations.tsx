/**
 * Agent channel-binding screen (more/agents/[id]/integrations, iteration-98
 * A14). Mirrors web's agent Integrations tab
 * (packages/views/agents/components/tabs/integrations-tab.tsx) in a
 * phone-friendly form: one section per external chat platform (Lark / Slack /
 * DingTalk / WeCom), each filtered down to THIS agent's installations.
 *
 * Branch order per section is web's (see integrations-tab.tsx):
 *   1. No manage permission for the channel → members-only note.
 *   2. `configured` false → "ask an admin to enable" placeholder.
 *   3. `install_supported` false AND no active install → "coming soon".
 *   4. Active install → connected card (status badge + connection info).
 *   5. Otherwise → "Bind in browser" CTA that opens the web agent detail page
 *      (`{webBase}/{slug}/agents/{id}?tab=integrations`) in the system
 *      browser — the QR/device-flow bind itself can't run inside the app the
 *      way settings integrations already deep-link to web (iteration-52).
 *
 * Permissions mirror web: Lark bind/manage is for the agent owner OR a
 * workspace owner/admin; Slack / DingTalk / WeCom installs are owner/admin
 * only (the backend 403s anything less). A member who can manage no platform
 * gets a read-only page with the intro + hint.
 */
import { useState } from "react";
import { ActivityIndicator, Linking, ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { agentListAllOptions } from "@/data/queries/agents";
import {
  larkInstallationsOptions,
  slackInstallationsOptions,
  dingtalkInstallationsOptions,
  wecomInstallationsOptions,
  channelState,
} from "@/data/queries/integrations";
import { memberListOptions } from "@/data/queries/members";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useAuthStore } from "@/data/auth-store";
import { useActorLookup } from "@/data/use-actor-name";
import { getWebBaseUrl } from "@/data/server-config";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { formatDateTime } from "@/lib/autopilot-format";
import { cn } from "@/lib/utils";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

type ChannelKey = "lark" | "slack" | "dingtalk" | "wecom";

/** Structural union of the four installation shapes — the connected card only
 *  reads the fields each channel actually carries. */
interface BoundInstall {
  status: string;
  installed_at?: string;
  installer_user_id?: string;
  region?: string;
  bot_open_id?: string;
  team_id?: string;
  bot_user_id?: string;
  bot_id?: string;
}

/** Per-agent channel state as consumed by the page (channelState's generic
 *  return, widened to the display union). */
interface ChannelStateView {
  configured: boolean;
  installSupported: boolean;
  activeInstall: BoundInstall | null;
}

interface ChannelConfig {
  key: ChannelKey;
  icon: IconName;
  descriptionKey: string;
}

const CHANNELS: ChannelConfig[] = [
  { key: "lark", icon: "paper-plane", descriptionKey: "agents.integrations.larkDescription" },
  { key: "slack", icon: "chatbox-ellipses-outline", descriptionKey: "agents.integrations.slackDescription" },
  { key: "dingtalk", icon: "chatbubbles-outline", descriptionKey: "agents.integrations.dingtalkDescription" },
  { key: "wecom", icon: "business-outline", descriptionKey: "agents.integrations.wecomDescription" },
];

const CHANNEL_NAME_KEY: Record<ChannelKey, string> = {
  lark: "agents.integrations.larkName",
  slack: "agents.integrations.slackName",
  dingtalk: "agents.integrations.dingtalkName",
  wecom: "agents.integrations.wecomName",
};

export default function AgentIntegrationsPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { getName } = useActorLookup();
  const [openError, setOpenError] = useState(false);

  const agents = useQuery(agentListAllOptions(wsId));
  const lark = useQuery(larkInstallationsOptions(wsId));
  const slack = useQuery(slackInstallationsOptions(wsId));
  const dingtalk = useQuery(dingtalkInstallationsOptions(wsId));
  const wecom = useQuery(wecomInstallationsOptions(wsId));
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);

  const agent = agents.data?.find((a) => a.id === id) ?? null;

  const currentMember = members.find((m) => m.user_id === currentUserId) ?? null;
  const isWorkspaceAdmin =
    currentMember?.role === "owner" || currentMember?.role === "admin";
  const isAgentOwner =
    !!currentUserId && agent?.owner_id != null && agent.owner_id === currentUserId;
  // Lark bind/manage authorizes the agent owner OR a workspace owner/admin
  // (server/internal/handler/lark.go canManageAgent); Slack / DingTalk / WeCom
  // install/revoke stay owner/admin-only at the router — mirroring web.
  const canManage: Record<ChannelKey, boolean> = {
    lark: isWorkspaceAdmin || isAgentOwner,
    slack: isWorkspaceAdmin,
    dingtalk: isWorkspaceAdmin,
    wecom: isWorkspaceAdmin,
  };
  const canManageAny = CHANNELS.some((c) => canManage[c.key]);

  const state: Record<ChannelKey, ChannelStateView> = {
    lark: channelState(lark.data, id),
    slack: channelState(slack.data, id),
    dingtalk: channelState(dingtalk.data, id),
    wecom: channelState(wecom.data, id),
  };

  const openBindInBrowser = () => {
    if (!agent) return;
    setOpenError(false);
    const base = getWebBaseUrl();
    if (!base || !wsSlug) return;
    Linking.openURL(`${base}/${wsSlug}/agents/${agent.id}?tab=integrations`).catch(
      () => setOpenError(true),
    );
  };

  const loading =
    agents.isLoading || lark.isLoading || slack.isLoading ||
    dingtalk.isLoading || wecom.isLoading;

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (!agent) {
    return (
      <View className="flex-1 items-center justify-center px-6 bg-background">
        <Text className="text-sm text-muted-foreground text-center">
          {t("agents.emptyTitle")}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="pb-10">
      <View className="border-b border-border px-4 py-2.5">
        <Text className="text-xs text-muted-foreground leading-4">
          {t("agents.integrations.intro")}
        </Text>
      </View>

      <View className="gap-4 px-4 py-4">
        {!canManageAny ? (
          <View className="rounded-md border border-border bg-card px-4 py-3">
            <Text className="text-xs text-muted-foreground leading-4">
              {t("agents.integrations.readonlyHint")}
            </Text>
          </View>
        ) : (
          CHANNELS.map((channel) => (
            <ChannelSection
              key={channel.key}
              channel={channel}
              canManage={canManage[channel.key]}
              state={state[channel.key]}
              onBind={openBindInBrowser}
              getName={getName}
            />
          ))
        )}

        {openError ? (
          <Text className="text-xs text-destructive text-center">
            {t("agents.integrations.openError")}
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

function ChannelSection({
  channel,
  canManage,
  state,
  onBind,
  getName,
}: {
  channel: ChannelConfig;
  canManage: boolean;
  state: ChannelStateView;
  onBind: () => void;
  getName: (
    type: "member" | "agent" | "squad" | null | undefined,
    id: string | null | undefined,
  ) => string;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const name = t(CHANNEL_NAME_KEY[channel.key]);

  let body: React.ReactNode;
  if (!canManage) {
    body = <Note>{t("agents.integrations.membersNote")}</Note>;
  } else if (!state.configured) {
    body = <Note>{t("agents.integrations.configureMissing")}</Note>;
  } else if (!state.installSupported && !state.activeInstall) {
    body = <Note>{t("agents.integrations.comingSoon")}</Note>;
  } else if (state.activeInstall) {
    body = (
      <ConnectedCard
        install={state.activeInstall}
        channelKey={channel.key}
        getName={getName}
      />
    );
  } else {
    body = (
      <Button
        variant="outline"
        size="sm"
        onPress={onBind}
        className="self-start"
      >
        <Ionicons name="open-outline" size={14} color={theme.primary} />
        <Text>{t("agents.integrations.bindInBrowser")}</Text>
      </Button>
    );
  }

  return (
    <View className="overflow-hidden rounded-md border border-border bg-card">
      <View className="flex-row items-start gap-3 px-4 py-3.5">
        <View className="size-9 rounded-md bg-secondary items-center justify-center">
          <Ionicons name={channel.icon} size={18} color={theme.mutedForeground} />
        </View>
        <View className="flex-1 min-w-0 gap-0.5">
          <Text className="text-sm font-medium text-foreground">{name}</Text>
          <Text className="text-xs text-muted-foreground leading-4">
            {t(channel.descriptionKey)}
          </Text>
        </View>
      </View>
      <View className="border-t border-border px-4 py-3">{body}</View>
    </View>
  );
}

function ConnectedCard({
  install,
  channelKey,
  getName,
}: {
  install: BoundInstall;
  channelKey: ChannelKey;
  getName: (type: "member" | "agent" | "squad" | null | undefined, id: string | null | undefined) => string;
}) {
  const { t } = useTranslation();
  const active = install.status === "active";
  const larkRegion =
    channelKey === "lark"
      ? install.region === "lark"
        ? t("agents.integrations.larkRegionLark")
        : t("agents.integrations.larkRegionFeishu")
      : null;

  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-2">
        <View className={cn("size-2 rounded-full", active ? "bg-success" : "bg-muted")} />
        <Text className={cn("text-xs font-medium", active ? "text-success" : "text-muted-foreground")}>
          {active ? t("agents.integrations.statusActive") : t("agents.integrations.statusRevoked")}
        </Text>
        {larkRegion ? (
          <View className="rounded-full border border-border bg-muted px-2 py-0.5">
            <Text className="text-[11px] text-muted-foreground">{larkRegion}</Text>
          </View>
        ) : null}
      </View>
      {channelKey === "lark" ? (
        <InfoRow label={t("agents.integrations.botIdLabel")} value={install.bot_open_id} mono />
      ) : null}
      {channelKey === "slack" ? (
        <>
          <InfoRow label={t("agents.integrations.teamIdLabel")} value={install.team_id} mono />
          <InfoRow label={t("agents.integrations.botIdLabel")} value={install.bot_user_id} mono />
        </>
      ) : null}
      {channelKey === "wecom" ? (
        <InfoRow label={t("agents.integrations.botIdLabel")} value={install.bot_id} mono />
      ) : null}
      <InfoRow
        label={t("agents.integrations.installedByLabel")}
        value={getName("member", install.installer_user_id)}
      />
      {install.installed_at ? (
        <InfoRow
          label={t("agents.integrations.installedAtLabel")}
          value={formatDateTime(install.installed_at)}
        />
      ) : null}
    </View>
  );
}

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
}) {
  const { colorScheme } = useColorScheme();
  return (
    <View className="flex-row items-center">
      <Text className="w-20 text-xs text-muted-foreground">{label}</Text>
      <Text
        className={cn(
          "flex-1 text-xs text-foreground",
          mono && "font-mono",
        )}
        numberOfLines={1}
        style={mono ? { color: THEME[colorScheme].mutedForeground } : undefined}
      >
        {value || "—"}
      </Text>
    </View>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <Text className="text-xs text-muted-foreground leading-4">{children}</Text>
  );
}