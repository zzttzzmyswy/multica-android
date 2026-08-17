/**
 * Workspace integrations page (iteration-52) — read-only status view.
 *
 * Mirrors web's github-tab + integrations-tab surfaces in a phone-friendly
 * form: a GitHub connection card (installed organizations vs. not connected)
 * and read-only rows for the other channel integrations (Lark / Slack /
 * DingTalk / WeCom). Binding and disconnecting all happen in the web app —
 * the OAuth handshake is browser-based — so each row's action opens the
 * workspace settings page (`{webBase}/{slug}/settings`) in the system
 * browser.
 */
import { useState } from "react";
import { Linking, Pressable, ScrollView, View } from "react-native";
import { Stack } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { githubInstallationsOptions } from "@/data/queries/github";
import { VCSIntegrationSection } from "@/components/settings/vcs-integration-section";
import { useWorkspaceStore } from "@/data/workspace-store";
import { getWebBaseUrl } from "@/data/server-config";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

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

  const openWebSettings = () => {
    setOpenError(null);
    const base = getWebBaseUrl();
    if (!base || !wsSlug) return;
    Linking.openURL(`${base}/${wsSlug}/settings`).catch(() => {
      setOpenError(t("integrations.connectFailed"));
    });
  };

  const connectedLabel = connected
    ? t("integrations.connectedTo", { names: connectedNames })
    : t("integrations.notConnected");

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
          {/* GitHub connection card */}
          <View className="gap-2">
            <Text className="text-xs uppercase tracking-wider text-muted-foreground px-1">
              {t("integrations.githubTitle")}
            </Text>
            <View className="rounded-md border border-border bg-card overflow-hidden">
              <View className="flex-row items-center gap-3 px-4 py-3.5">
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
                  ) : (
                    <Text
                      className={cn(
                        "text-xs",
                        connected ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
                      )}
                      numberOfLines={1}
                    >
                      {connectedLabel}
                    </Text>
                  )}
                </View>
                <Ionicons
                  name={connected ? "checkmark-circle" : "ellipse-outline"}
                  size={18}
                  color={connected ? theme.success : muted}
                />
              </View>
            </View>
          </View>

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