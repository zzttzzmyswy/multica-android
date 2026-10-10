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
 *   4. Active install → connected card (status badge + connection info +
 *      Disconnect).
 *   5. Otherwise → bind in the app.
 *
 * Iteration 170 replaced branch 5's "Bind in browser" hand-off with the real
 * bind paths: Lark runs web's device flow (pick cloud → open link → poll),
 * and Slack / DingTalk / WeCom open web's bring-your-own-app form. The
 * browser link survives as a secondary action on every branch-5 card — a
 * deployment whose channel is half-configured, or a BYO attempt the server
 * refuses, still has the web page as a way through.
 *
 * Permissions mirror web: Lark bind/manage is for the agent owner OR a
 * workspace owner/admin; Slack / DingTalk / WeCom installs are owner/admin
 * only (the backend 403s anything less). A member who can manage no platform
 * gets a read-only page with the intro + hint.
 *
 * The agent row and the four installation lists are resolved through
 * `recordRead` (MYS-1908), so a failed read is named as a failure with a
 * retry instead of claiming 「还没有智能体」.
 */
import { useState } from "react";
import { Alert, Linking, Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { CatalogStatus } from "@/components/catalog/catalog-status";
import { LarkInstallDialog, type LarkRegion } from "@/components/agent/lark-install-dialog";
import { ChannelByoDialog } from "@/components/agent/channel-byo-dialog";
import { ActionSheet } from "@/lib/action-sheet";
import { recordRead } from "@/lib/catalog-read";
import type { CatalogState } from "@/lib/catalog-state";
import {
  useDisconnectDingTalkInstallation,
  useDisconnectLarkInstallation,
  useDisconnectSlackInstallation,
  useDisconnectWecomInstallation,
} from "@/data/mutations/channels";
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
  id: string;
  agent_id: string;
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

/** The bind CTA per channel. One key each rather than a "{channel}" template,
 *  because the channel names mix Latin ("Slack") and CJK ("钉钉") and a single
 *  template cannot space both correctly. */
const BIND_CTA_KEY: Record<ChannelKey, string> = {
  lark: "agents.integrations.larkBind",
  slack: "agents.integrations.slackBind",
  dingtalk: "agents.integrations.dingtalkBind",
  wecom: "agents.integrations.wecomBind",
};

export default function AgentIntegrationsPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { getName } = useActorLookup();
  const [openError, setOpenError] = useState(false);
  // Which bind flow is open, if any. Lark needs a region chosen first, so it
  // is held separately from the BYO channels.
  const [larkRegion, setLarkRegion] = useState<LarkRegion | null>(null);
  const [byoChannel, setByoChannel] = useState<"slack" | "dingtalk" | "wecom" | null>(null);

  const agents = useQuery(agentListAllOptions(wsId));
  const lark = useQuery(larkInstallationsOptions(wsId));
  const slack = useQuery(slackInstallationsOptions(wsId));
  const dingtalk = useQuery(dingtalkInstallationsOptions(wsId));
  const wecom = useQuery(wecomInstallationsOptions(wsId));
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);

  const disconnectLark = useDisconnectLarkInstallation();
  const disconnectSlack = useDisconnectSlackInstallation();
  const disconnectDingtalk = useDisconnectDingTalkInstallation();
  const disconnectWecom = useDisconnectWecomInstallation();
  const disconnectMutations: Record<
    ChannelKey,
    { mutate: (id: string, opts: { onError: (e: unknown) => void }) => void }
  > = {
    lark: disconnectLark,
    slack: disconnectSlack,
    dingtalk: disconnectDingtalk,
    wecom: disconnectWecom,
  };

  const agent = agents.data?.find((a) => a.id === id) ?? null;
  // Only the agent list gates the page: without the row there is nothing to
  // render. The four channel listings are per-card (below), so one channel's
  // failure cannot take the other three cards down with it.
  const read = recordRead(agent, [agents]);

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

  // Each channel's listing is its own read, and `channelState` reads
  // `configured` off it — so a failed listing made the card claim the channel
  // simply is not set up, which is a different fact from "we could not ask".
  // Each channel therefore carries its own load state (MYS-1908), rendered as
  // a per-card failure instead of blanking the page: the other channels'
  // cards stay usable.
  const channelReads: Record<ChannelKey, CatalogState> = {
    lark: recordRead(lark.data ?? null, [lark]).state,
    slack: recordRead(slack.data ?? null, [slack]).state,
    dingtalk: recordRead(dingtalk.data ?? null, [dingtalk]).state,
    wecom: recordRead(wecom.data ?? null, [wecom]).state,
  };
  const channelRetry: Record<ChannelKey, () => void> = {
    lark: () => void lark.refetch(),
    slack: () => void slack.refetch(),
    dingtalk: () => void dingtalk.refetch(),
    wecom: () => void wecom.refetch(),
  };

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

  // The cloud has to be chosen before `begin`, because the backend opens the
  // device flow against accounts.feishu.cn or accounts.larksuite.com
  // accordingly — a wrong pick hands the user a QR for the wrong cloud.
  const startLarkBind = () => {
    const options = [
      t("agents.integrations.larkRegionFeishu"),
      t("agents.integrations.larkRegionLark"),
    ];
    ActionSheet.showActionSheetWithOptions(
      {
        title: t("agents.integrations.larkChooseRegion"),
        options: [...options, t("common.cancel")],
        cancelButtonIndex: options.length,
      },
      (index) => {
        if (index === 0) setLarkRegion("feishu");
        else if (index === 1) setLarkRegion("lark");
      },
    );
  };

  const confirmDisconnect = (channelKey: ChannelKey, install: BoundInstall) => {
    const channelName = t(CHANNEL_NAME_KEY[channelKey]);
    Alert.alert(
      t("agents.integrations.disconnectTitle", { channel: channelName }),
      t("agents.integrations.disconnectDesc"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("agents.integrations.disconnectConfirm"),
          style: "destructive",
          onPress: () =>
            disconnectMutations[channelKey].mutate(install.id, {
              onError: (e: unknown) =>
                Alert.alert(
                  t("agents.integrations.disconnectFailed", {
                    message: e instanceof Error ? e.message : String(e),
                  }),
                ),
            }),
        },
      ],
    );
  };

  if (!read.isResolved) {
    return (
      <View className="flex-1 justify-center bg-background">
        <CatalogStatus state={read.state} onRetry={read.retry} layout="centered" />
      </View>
    );
  }

  if (!agent) {
    return (
      <View className="flex-1 justify-center bg-background">
        <CatalogStatus
          state="empty"
          onRetry={read.retry}
          emptyMessage={t("agents.notFound")}
          layout="centered"
        />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="pb-10">
      <View className="border-b border-border px-4 py-2.5">
        <Text className="text-caption text-muted-foreground leading-4">
          {t("agents.integrations.intro")}
        </Text>
      </View>

      <View className="gap-4 px-4 py-4">
        {!canManageAny ? (
          <View className="rounded-md border border-border bg-card px-4 py-3">
            <Text className="text-caption text-muted-foreground leading-4">
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
              loadState={channelReads[channel.key]}
              onRetry={channelRetry[channel.key]}
              onBind={() =>
                channel.key === "lark" ? startLarkBind() : setByoChannel(channel.key)
              }
              onBindInBrowser={openBindInBrowser}
              onDisconnect={(install) => confirmDisconnect(channel.key, install)}
              getName={getName}
            />
          ))
        )}

        {openError ? (
          <Text className="text-caption text-destructive text-center">
            {t("agents.integrations.openError")}
          </Text>
        ) : null}
      </View>

      {larkRegion && wsId ? (
        <LarkInstallDialog
          wsId={wsId}
          agentId={agent.id}
          region={larkRegion}
          onClose={() => setLarkRegion(null)}
        />
      ) : null}

      {byoChannel && wsId ? (
        <ChannelByoDialog
          channel={byoChannel}
          agentId={agent.id}
          onClose={() => setByoChannel(null)}
        />
      ) : null}
    </ScrollView>
  );
}

function ChannelSection({
  channel,
  canManage,
  state,
  loadState,
  onRetry,
  onBind,
  onBindInBrowser,
  onDisconnect,
  getName,
}: {
  channel: ChannelConfig;
  canManage: boolean;
  state: ChannelStateView;
  /** The listing's own read state. A failure means we never learned whether
   *  this channel is configured, so the card must not claim it is not. */
  loadState: CatalogState;
  onRetry: () => void;
  onBind: () => void;
  onBindInBrowser: () => void;
  onDisconnect: (install: BoundInstall) => void;
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
  if (loadState === "error" || loadState === "loading") {
    // Ahead of every other branch: `state.configured` is read off a listing we
    // never received, so 「尚未配置」 would be a guess about a channel that may
    // well be connected.
    body = <CatalogStatus state={loadState} onRetry={onRetry} layout="inline" />;
  } else if (!canManage) {
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
        onDisconnect={() => onDisconnect(state.activeInstall as BoundInstall)}
      />
    );
  } else {
    body = (
      <View className="gap-2">
        <Button variant="outline" size="sm" onPress={onBind} className="self-start">
          <Ionicons name="add-circle-outline" size={14} color={theme.primary} />
          <Text>{t(BIND_CTA_KEY[channel.key])}</Text>
        </Button>
        {/* Kept as the fallback for a channel the app cannot finish binding:
            a half-configured deployment, or a BYO attempt the server refuses.
            Web's agent page can always run the flow. */}
        <Pressable onPress={onBindInBrowser} hitSlop={6} className="self-start">
          <Text className="text-caption text-muted-foreground underline">
            {t("agents.integrations.bindInBrowser")}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="overflow-hidden rounded-md border border-border bg-card">
      <View className="flex-row items-start gap-3 px-4 py-3.5">
        <View className="size-9 rounded-md bg-secondary items-center justify-center">
          <Ionicons name={channel.icon} size={18} color={theme.mutedForeground} />
        </View>
        <View className="flex-1 min-w-0 gap-0.5">
          <Text className="text-body font-medium text-foreground">{name}</Text>
          <Text className="text-caption text-muted-foreground leading-4">
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
  onDisconnect,
}: {
  install: BoundInstall;
  channelKey: ChannelKey;
  getName: (type: "member" | "agent" | "squad" | null | undefined, id: string | null | undefined) => string;
  onDisconnect: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
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
        <Text className={cn("text-caption font-medium", active ? "text-success" : "text-muted-foreground")}>
          {active ? t("agents.integrations.statusActive") : t("agents.integrations.statusRevoked")}
        </Text>
        {larkRegion ? (
          <View className="rounded-full border border-border bg-muted px-2 py-0.5">
            <Text className="text-micro text-muted-foreground">{larkRegion}</Text>
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
      {active ? (
        <Button
          variant="outline"
          size="sm"
          onPress={onDisconnect}
          className="self-start mt-1"
        >
          <Ionicons name="unlink-outline" size={14} color={theme.destructive} />
          <Text className="text-destructive">
            {t("agents.integrations.disconnect")}
          </Text>
        </Button>
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
      <Text className="w-20 text-caption text-muted-foreground">{label}</Text>
      <Text
        className={cn(
          "flex-1 text-caption text-foreground",
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
    <Text className="text-caption text-muted-foreground leading-4">{children}</Text>
  );
}