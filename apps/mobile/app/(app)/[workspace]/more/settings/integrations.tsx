/**
 * Workspace integrations page (iteration-52; GitHub features added in
 * iteration-117).
 *
 * Mirrors web's github-tab + integrations-tab surfaces in a phone-friendly
 * form: a GitHub connection card (installed organizations vs. not connected)
 * with the four workspace-level feature switches from
 * packages/views/settings/components/github-tab.tsx (master switch + PR
 * sidebar / co-authored-by / auto-link, written via PATCH
 * /api/workspaces/:id { settings }), and read-only rows for the other
 * channel integrations (Lark / Slack / DingTalk / WeCom). Binding and
 * disconnecting all happen in the web app — the OAuth handshake is
 * browser-based — so each row's action opens the workspace settings page
 * (`{webBase}/{slug}/settings`) in the system browser.
 */
import { useEffect, useState } from "react";
import { Alert, AppState, Linking, Pressable, ScrollView, View } from "react-native";
import { Stack } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { githubInstallationsOptions, githubKeys } from "@/data/queries/github";
import { useDisconnectGitHubInstallation } from "@/data/mutations/github";
import { api } from "@/data/api";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { useUpdateWorkspace } from "@/data/mutations/workspaces";
import {
  deriveGitHubSettings,
  mergeGitHubSetting,
  type GitHubSettingsKey,
} from "@/lib/github-settings";
import { VCSIntegrationSection } from "@/components/settings/vcs-integration-section";
import { useWorkspaceStore } from "@/data/workspace-store";
import { getWebBaseUrl } from "@/data/server-config";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

type ChannelKey = "lark" | "slack" | "dingtalk" | "wecom";

const CHANNELS: {
  key: ChannelKey;
  icon: React.ComponentProps<typeof Ionicons>["name"];
}[] = [
  { key: "lark", icon: "paper-plane" },
  { key: "slack", icon: "chatbox-ellipses-outline" },
  { key: "dingtalk", icon: "chatbubbles-outline" },
  { key: "wecom", icon: "business-outline" },
];

export default function IntegrationsPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const muted = theme.mutedForeground;
  const [openError, setOpenError] = useState<string | null>(null);

  const { data: githubData, isPending: githubPending } = useQuery(
    githubInstallationsOptions(wsId),
  );
  const installations = githubData?.installations ?? [];
  const connected = installations.length > 0;
  const connectedNames = installations
    .map((i) => i.account_login)
    .join(", ");
  // `can_manage` comes from the installations response so the UI never
  // claims management rights the server would reject (web github-tab.tsx:64).
  const canManage = githubData?.can_manage === true;

  const { data: workspaces } = useQuery(workspaceListOptions());
  const workspace = workspaces?.find((w) => w.id === wsId);
  const flags = deriveGitHubSettings(workspace);

  const updateWorkspace = useUpdateWorkspace();
  const [savingKey, setSavingKey] = useState<GitHubSettingsKey | null>(null);

  // Web github-tab.tsx:persistSetting — spread the full existing settings
  // bag (via mergeGitHubSetting), PATCH, invalidate; the list refetch is the
  // source of truth (no optimistic patch, mirroring useUpdateWorkspace).
  const persistSetting = async (key: GitHubSettingsKey, next: boolean) => {
    if (!workspace || savingKey) return;
    setSavingKey(key);
    try {
      await updateWorkspace.mutateAsync({
        workspaceId: workspace.id,
        patch: {
          settings: mergeGitHubSetting(workspace.settings, key, next),
        },
      });
    } catch {
      Alert.alert(t("integrations.gh.saveFailed"));
    } finally {
      setSavingKey(null);
    }
  };

  const openWebSettings = () => {
    setOpenError(null);
    const base = getWebBaseUrl();
    if (!base || !wsSlug) return;
    Linking.openURL(`${base}/${wsSlug}/settings`).catch(() => {
      setOpenError(t("integrations.connectFailed"));
    });
  };

  // Connect and Disconnect mirror web github-tab.tsx:96-125 / :206-236. The
  // OAuth handshake runs in the system browser, so the only client-side step
  // is minting the install URL; the installation list refreshes when the user
  // comes back to the app (web gets this for free from the new tab's focus).
  const [connecting, setConnecting] = useState(false);
  const disconnect = useDisconnectGitHubInstallation();
  const qc = useQueryClient();

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void qc.invalidateQueries({ queryKey: githubKeys.all(wsId) });
      }
    });
    return () => sub.remove();
  }, [qc, wsId]);

  const handleConnect = async () => {
    if (connecting) return;
    setConnecting(true);
    try {
      const resp = await api.getGitHubConnectURL(wsId ?? "");
      if (!resp.configured || !resp.url) {
        Alert.alert(t("integrations.gh.notConfiguredToast"));
        return;
      }
      Linking.openURL(resp.url);
    } catch (e) {
      Alert.alert(
        t("integrations.gh.connectFailed", {
          message: e instanceof Error ? e.message : t("integrations.vcsUnknownError"),
        }),
      );
    } finally {
      setConnecting(false);
    }
  };

  const confirmDisconnect = (installationId: string, label: string) => {
    Alert.alert(
      t("integrations.gh.disconnectTitle"),
      t("integrations.gh.disconnectDesc", { label }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("integrations.gh.disconnectConfirm"),
          style: "destructive",
          onPress: () =>
            disconnect.mutate(installationId, {
              onError: (e) =>
                Alert.alert(
                  t("integrations.gh.disconnectFailed", {
                    message: e instanceof Error ? e.message : t("integrations.vcsUnknownError"),
                  }),
                ),
            }),
        },
      ],
    );
  };

  const connectedLabel = connected
    ? t("integrations.connectedTo", { names: connectedNames })
    : t("integrations.notConnected");
  const configured = githubData?.configured === true;
  const primaryInstallation = installations[0] ?? null;

  return (
    <>
      <Stack.Screen options={{ title: t("screen.integrations") }} />
      <ScrollView className="flex-1 bg-background">
        <View className="border-b border-border px-4 py-2.5">
          <Text className="text-xs text-muted-foreground leading-4">
            {t("integrations.description")}
          </Text>
        </View>
        <View className="gap-5 px-4 py-4">
          {/* GitHub connection card — mirrors web github-tab.tsx
              "section_connection": status copy branches on
              connected / canManage / configured, and the Connect / Disconnect
              action sits opposite the status line. */}
          <View className="gap-2">
            <Text className="text-xs uppercase tracking-wider text-muted-foreground px-1">
              {t("integrations.gh.connectionSection")}
            </Text>
            <View className="rounded-md border border-border bg-card overflow-hidden">
              <View className="flex-row items-start gap-3 px-4 py-3.5">
                <View className="size-9 rounded-md bg-secondary items-center justify-center">
                  <Ionicons name="logo-github" size={18} color={muted} />
                </View>
                <View className="flex-1 min-w-0 gap-0.5">
                  <Text className="text-sm font-medium text-foreground">
                    {t("integrations.githubTitle")}
                  </Text>
                  {githubPending ? (
                    <Text className="text-xs text-muted-foreground">
                      {t("quickActions.loading")}
                    </Text>
                  ) : connected ? (
                    <>
                      <Text
                        className="text-xs text-emerald-600 dark:text-emerald-400"
                        numberOfLines={1}
                      >
                        {connectedLabel}
                      </Text>
                      {primaryInstallation?.connected_by ? (
                        <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                          {t("integrations.gh.connectedBy", {
                            name: primaryInstallation.connected_by,
                          })}
                        </Text>
                      ) : null}
                    </>
                  ) : canManage ? (
                    <Text className="text-xs text-muted-foreground leading-4">
                      {t("integrations.gh.connectDescPrefix")}{" "}
                      <Text className="font-mono text-foreground">
                        {t("integrations.gh.connectDescExample")}
                      </Text>{" "}
                      {t("integrations.gh.connectDescSuffix")}{" "}
                      <Text className="font-medium text-foreground">
                        {t("integrations.gh.connectDescDone")}
                      </Text>
                    </Text>
                  ) : (
                    <Text className="text-xs text-muted-foreground leading-4">
                      {t("integrations.gh.contactAdmin")}
                    </Text>
                  )}
                </View>
                {canManage ? (
                  connected && primaryInstallation ? (
                    // Disconnect stays reachable even with the master switch
                    // off — revoking the App grant is a separate intent from
                    // hiding the feature (web github-tab.tsx:206).
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={disconnect.isPending}
                      onPress={() =>
                        confirmDisconnect(
                          primaryInstallation.id,
                          primaryInstallation.account_login,
                        )
                      }
                    >
                      <Text>
                        {disconnect.isPending
                          ? t("integrations.gh.disconnecting")
                          : t("integrations.gh.disconnect")}
                      </Text>
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled={connecting || !configured}
                      onPress={handleConnect}
                    >
                      <Text>
                        {connecting
                          ? t("integrations.gh.connectOpening")
                          : t("integrations.gh.connectGithub")}
                      </Text>
                    </Button>
                  )
                ) : (
                  <Ionicons
                    name={connected ? "checkmark-circle" : "ellipse-outline"}
                    size={18}
                    color={connected ? theme.success : muted}
                  />
                )}
              </View>
              {canManage && !configured ? (
                <View className="border-t border-border px-4 py-2.5">
                  <Text className="text-xs text-muted-foreground leading-4">
                    {t("integrations.gh.notConfigured")}
                  </Text>
                </View>
              ) : null}
              {!canManage && connected ? (
                <View className="border-t border-border px-4 py-2.5">
                  <Text className="text-xs text-muted-foreground leading-4">
                    {t("integrations.gh.readOnlyConnection")}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* GitHub workspace-level feature switches — mirrors web
              github-tab.tsx sections (master + PR sidebar / co-author /
              auto-link). Rows disable while their PATCH is in flight; the
              whole section is read-only without can_manage. */}
          {workspace ? (
            <View className="gap-2">
              <Text className="text-xs uppercase tracking-wider text-muted-foreground px-1">
                {t("integrations.gh.sectionFeatures")}
              </Text>
              <View className="rounded-md border border-border bg-card overflow-hidden">
                <View className="flex-row items-center gap-3 px-4 py-3.5">
                  <View className="size-8 rounded-md bg-secondary items-center justify-center">
                    <Ionicons name="toggle-outline" size={16} color={muted} />
                  </View>
                  <View className="flex-1 min-w-0 gap-0.5">
                    <Text className="text-sm font-medium text-foreground">
                      {t("integrations.gh.masterTitle")}
                    </Text>
                    <Text className="text-xs text-muted-foreground mt-0.5">
                      {flags.enabled
                        ? t("integrations.gh.masterOn")
                        : t("integrations.gh.masterOff")}
                    </Text>
                  </View>
                  <Switch
                    checked={flags.enabled}
                    disabled={!canManage || savingKey !== null}
                    onCheckedChange={(v) => persistSetting("github_enabled", v)}
                  />
                </View>
                <Separator />
                <FeatureRow
                  mutedColor={muted}
                  icon="albums-outline"
                  label={t("integrations.gh.prSidebarLabel")}
                  description={t("integrations.gh.prSidebarDesc")}
                  checked={flags.prSidebar}
                  disabled={!canManage || !flags.enabled || savingKey !== null}
                  onCheckedChange={(v) =>
                    persistSetting("github_pr_sidebar_enabled", v)
                  }
                />
                <Separator />
                <FeatureRow
                  mutedColor={muted}
                  icon="git-commit-outline"
                  label={t("integrations.gh.coAuthorLabel")}
                  description={`${t("integrations.gh.coAuthorPrefix")} Co-authored-by: multica-agent <github@multica.ai> ${t("integrations.gh.coAuthorSuffix")}`}
                  checked={flags.coAuthor}
                  disabled={!canManage || !flags.enabled || savingKey !== null}
                  onCheckedChange={(v) =>
                    persistSetting("co_authored_by_enabled", v)
                  }
                />
                <Separator />
                <FeatureRow
                  mutedColor={muted}
                  icon="git-pull-request-outline"
                  label={t("integrations.gh.autoLinkLabel")}
                  description={t("integrations.gh.autoLinkDesc")}
                  checked={flags.autoLinkPRs}
                  disabled={!canManage || !flags.enabled || savingKey !== null}
                  onCheckedChange={(v) =>
                    persistSetting("github_auto_link_prs_enabled", v)
                  }
                />
              </View>
              {!canManage ? (
                <Text className="text-xs text-muted-foreground/70 px-1">
                  {t("integrations.gh.readOnlyHint")}
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* Other channel rows */}
          <View className="gap-2">
            <Text className="text-xs uppercase tracking-wider text-muted-foreground px-1">
              {t("integrations.title")}
            </Text>
            <View className="rounded-md border border-border bg-card overflow-hidden">
              {CHANNELS.map((channel, idx) => (
                <View key={channel.key}>
                  {idx > 0 ? <View className="h-px bg-border ml-4" /> : null}
                  <View className="flex-row items-center gap-3 px-4 py-3.5">
                    <View className="size-8 rounded-md bg-secondary items-center justify-center">
                      <Ionicons name={channel.icon} size={16} color={muted} />
                    </View>
                    <View className="flex-1 min-w-0 gap-0.5">
                      <Text className="text-sm font-medium text-foreground">
                        {t(`integrations.channel.${channel.key}`)}
                      </Text>
                      <Text className="text-xs text-muted-foreground/70">
                        {t("integrations.notConnected")}
                      </Text>
                    </View>
                    <Pressable
                      onPress={openWebSettings}
                      hitSlop={6}
                      className="flex-row items-center gap-1"
                    >
                      <Text className="text-xs font-medium text-primary">
                        {t("integrations.openInBrowser")}
                      </Text>
                      <Ionicons name="open-outline" size={13} color={theme.primary} />
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          </View>

          {/* VCS — self-hosted Git providers (Forgejo / Gitea / GitLab).
              Read + manage live inside the app (unlike the IM channels,
              which bind in the web app). Hidden entirely when the deployment
              reports available=false, matching web's integrations-tab. */}
          <VCSIntegrationSection />

          <Button variant="outline" onPress={openWebSettings}>
            <Ionicons name="globe-outline" size={15} color={muted} />
            <Text>{t("integrations.openInBrowser")}</Text>
          </Button>

          {openError ? (
            <Text className="text-xs text-destructive text-center">
              {openError}
            </Text>
          ) : null}
          <Text className="text-xs text-muted-foreground/70 text-center">
            {t("integrations.readOnlyHint")}
          </Text>
        </View>
      </ScrollView>
    </>
  );
}

function FeatureRow({
  icon,
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
  mutedColor,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (v: boolean) => void;
  mutedColor: string;
}) {
  return (
    <View className="flex-row items-center gap-3 px-4 py-3.5">
      <View className="size-8 rounded-md bg-secondary items-center justify-center">
        <Ionicons name={icon} size={16} color={mutedColor} />
      </View>
      <View className="flex-1 min-w-0 gap-0.5">
        <Text className="text-sm font-medium text-foreground">{label}</Text>
        <Text className="text-xs text-muted-foreground mt-0.5">
          {description}
        </Text>
      </View>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </View>
  );
}
