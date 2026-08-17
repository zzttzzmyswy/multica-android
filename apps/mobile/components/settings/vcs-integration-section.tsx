/**
 * Settings → Integrations → VCS section (iteration-59) — token-based
 * connections to self-hosted Git providers (Forgejo / Gitea / GitLab).
 *
 * Mirrors web `packages/views/settings/components/vcs-tab.tsx` (hosted inside
 * `integrations-tab.tsx`) on the phone. Secrets never round-trip: the list
 * endpoint returns identities only; the one-time webhook secret + webhook URL
 * the user must paste into the provider arrive exactly once, right after a
 * connect or a webhook rotation.
 *
 * Deployment semantics match the web client contract (packages/core/types
 * vcs.ts): `available` false → whole section hidden; `configured` false →
 * connect form disabled with an operator hint; `can_manage` false → read-only
 * list with a contact-admin hint. Older backends omit the flags, so each is
 * defaulted to the safe client-side value instead of crashing the page.
 */
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ConnectVCSResponse, VCSProvider } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { api } from "@/data/api";
import { vcsConnectionsOptions, vcsKeys, vcsViewState } from "@/data/queries/vcs";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

const PROVIDERS: { value: VCSProvider; label: string }[] = [
  { value: "forgejo", label: "Forgejo" },
  { value: "gitea", label: "Gitea" },
  { value: "gitlab", label: "GitLab" },
];

function providerLabel(value: string): string {
  return PROVIDERS.find((p) => p.value === value)?.label ?? value;
}

export function VCSIntegrationSection() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const muted = theme.mutedForeground;
  const qc = useQueryClient();

  const [provider, setProvider] = useState<VCSProvider>("forgejo");
  const [instanceUrl, setInstanceUrl] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [justConnected, setJustConnected] = useState<ConnectVCSResponse | null>(
    null,
  );

  const { data, isPending, error, refetch } = useQuery(
    vcsConnectionsOptions(wsId),
  );
  const connections = data?.connections ?? [];
  // Deployment/visibility semantics (shared with the unit tests): available
  // false → section hidden, configured false → form disabled, can_manage
  // false → read-only. Flags omitted by older backends default to the safe
  // client value, matching web's vcs-tab assumptions.
  const { available, configured, canManage } = vcsViewState(data);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: vcsKeys.all(wsId) });

  const connect = useMutation({
    mutationFn: () =>
      api.connectVCS(wsId ?? "", {
        provider,
        instance_url: instanceUrl.trim(),
        access_token: accessToken.trim(),
      }),
    onSuccess: (resp) => {
      setJustConnected(resp);
      setInstanceUrl("");
      setAccessToken("");
      void invalidate();
    },
    onError: (e) => {
      Alert.alert(
        t("screen.integrations"),
        t("integrations.vcsConnectFailed", {
          message: e instanceof Error ? e.message : t("integrations.vcsUnknownError"),
        }),
      );
    },
  });

  const rotate = useMutation({
    mutationFn: (connId: string) => api.rotateVCSWebhook(wsId ?? "", connId),
    onSuccess: (resp) => {
      setJustConnected(resp);
      void invalidate();
    },
    onError: (e) => {
      Alert.alert(
        t("screen.integrations"),
        t("integrations.vcsRotateFailed", {
          message: e instanceof Error ? e.message : t("integrations.vcsUnknownError"),
        }),
      );
    },
  });

  const disconnect = useMutation({
    mutationFn: (connId: string) =>
      api.deleteVCSConnection(wsId ?? "", connId).then(() => connId),
    onSuccess: (connId) => {
      if (justConnected?.id === connId) setJustConnected(null);
      void invalidate();
    },
    onError: (e) => {
      Alert.alert(
        t("screen.integrations"),
        t("integrations.vcsDisconnectFailed", {
          message: e instanceof Error ? e.message : t("integrations.vcsUnknownError"),
        }),
      );
    },
  });

  const confirmRotate = (connId: string, label: string) => {
    Alert.alert(
      t("integrations.vcsRotateTitle"),
      t("integrations.vcsRotateDesc", { label }),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("integrations.vcsRotateConfirm"), onPress: () => rotate.mutate(connId) },
      ],
    );
  };

  const confirmDisconnect = (connId: string, label: string) => {
    Alert.alert(
      t("integrations.vcsDisconnectTitle"),
      t("integrations.vcsDisconnectDesc", { label }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("integrations.vcsDisconnectConfirm"),
          style: "destructive",
          onPress: () => disconnect.mutate(connId),
        },
      ],
    );
  };

  // Same deployment gate as web: the managed cloud reports available=false,
  // in which case the whole section — header included — stays hidden.
  if (!available) return null;

  return (
    <View className="gap-2">
      <Text className="text-xs uppercase tracking-wider text-muted-foreground px-1">
        {t("integrations.vcsTitle")}
      </Text>
      <View className="rounded-md border border-border bg-card overflow-hidden">
        <View className="px-4 py-3 gap-2">
          <Text className="text-sm text-muted-foreground leading-4">
            {t("integrations.vcsDescription")}
          </Text>

          {isPending ? (
            <View className="py-6 items-center">
              <ActivityIndicator />
            </View>
          ) : error ? (
            <View className="py-4 items-center gap-3">
              <Text className="text-sm text-destructive text-center">
                {t("integrations.vcsLoadFailed")}
              </Text>
              <Button variant="outline" size="sm" onPress={() => void refetch()}>
                <Text>{t("common.retry")}</Text>
              </Button>
            </View>
          ) : (
            <>
              {/* Connection list */}
              {connections.length > 0 ? (
                <View className="gap-2">
                  {connections.map((c) => {
                    const label = `${providerLabel(c.provider)} · ${c.instance_url}`;
                    return (
                      <View
                        key={c.id}
                        className="rounded-md border border-border p-3 gap-1.5"
                      >
                        <View className="flex-row items-start gap-2.5">
                          <View className="size-8 rounded-md bg-secondary items-center justify-center shrink-0">
                            <Ionicons name="git-branch-outline" size={15} color={muted} />
                          </View>
                          <View className="flex-1 min-w-0 gap-0.5">
                            <Text className="text-sm font-medium text-foreground">
                              {label}
                            </Text>
                            <Text className="text-xs text-muted-foreground">
                              {t("integrations.vcsConnectedAs", {
                                login: c.account_login,
                              })}
                            </Text>
                          </View>
                        </View>
                        {canManage ? (
                          <View className="flex-row gap-2 pt-1">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={rotate.isPending}
                              onPress={() => confirmRotate(c.id, label)}
                            >
                              <Ionicons name="refresh-outline" size={13} color={muted} />
                              <Text>{t("integrations.vcsRegenerate")}</Text>
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={disconnect.isPending}
                              onPress={() => confirmDisconnect(c.id, label)}
                            >
                              <Ionicons name="trash-outline" size={13} color={muted} />
                              <Text>{t("integrations.vcsDisconnect")}</Text>
                            </Button>
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              ) : null}

              {/* One-time webhook setup card (after connect / rotate) */}
              {justConnected ? (
                <View className="rounded-md border border-border p-3 gap-2">
                  <View className="gap-0.5">
                    <Text className="text-sm font-medium text-foreground">
                      {t("integrations.vcsWebhookSetupTitle")}
                    </Text>
                    <Text className="text-xs text-muted-foreground leading-4">
                      {t("integrations.vcsWebhookSetupDesc")}
                    </Text>
                  </View>
                  <CopyRow
                    label={t("integrations.vcsWebhookUrl")}
                    value={justConnected.webhook_url || justConnected.webhook_path}
                  />
                  <CopyRow
                    label={t("integrations.vcsWebhookSecret")}
                    value={justConnected.webhook_secret}
                    mono
                  />
                  <Text className="text-xs text-warning leading-4">
                    {t("integrations.vcsWebhookSecretWarning")}
                  </Text>
                </View>
              ) : null}

              {/* Connect form for managers */}
              {canManage ? (
                <View className="gap-3 pt-1">
                  <Text className="text-sm font-medium text-foreground">
                    {t("integrations.vcsConnectTitle")}
                  </Text>
                  {!configured ? (
                    <Text className="text-xs text-muted-foreground leading-4">
                      {t("integrations.vcsNotConfigured")}{" "}
                      <Text className="font-mono">MULTICA_VCS_SECRET_KEY</Text>.
                    </Text>
                  ) : (
                    <>
                      {/* Provider picker — three fixed options, tap-to-select */}
                      <View className="flex-row gap-2">
                        {PROVIDERS.map((p) => {
                          const active = provider === p.value;
                          return (
                            <Pressable
                              key={p.value}
                              onPress={() => setProvider(p.value)}
                              className={cn(
                                "flex-1 items-center rounded-md border px-2 py-2",
                                active
                                  ? "border-primary bg-primary/10"
                                  : "border-border bg-background",
                              )}
                            >
                              <Text
                                className={cn(
                                  "text-xs font-medium",
                                  active ? "text-primary" : "text-muted-foreground",
                                )}
                              >
                                {p.label}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      <View className="gap-1.5">
                        <Text className="text-xs font-medium text-foreground">
                          {t("integrations.vcsInstanceUrl")}
                        </Text>
                        <TextField
                          value={instanceUrl}
                          onChangeText={setInstanceUrl}
                          placeholder={t("integrations.vcsInstanceUrlPlaceholder")}
                          autoCapitalize="none"
                          autoCorrect={false}
                          keyboardType="url"
                          editable={!connect.isPending}
                        />
                      </View>
                      <View className="gap-1.5">
                        <Text className="text-xs font-medium text-foreground">
                          {t("integrations.vcsToken")}
                        </Text>
                        <TextField
                          value={accessToken}
                          onChangeText={setAccessToken}
                          placeholder={t("integrations.vcsTokenPlaceholder")}
                          secureTextEntry
                          autoCapitalize="none"
                          autoCorrect={false}
                          editable={!connect.isPending}
                        />
                        <Text className="text-xs text-muted-foreground leading-4">
                          {t("integrations.vcsTokenHint")}
                        </Text>
                      </View>
                      <Button
                        onPress={() => connect.mutate()}
                        disabled={connect.isPending || !instanceUrl.trim() || !accessToken.trim()}
                      >
                        {connect.isPending ? (
                          <ActivityIndicator size="small" color={theme.primary} />
                        ) : (
                          <Ionicons name="git-branch-outline" size={15} color={muted} />
                        )}
                        <Text>
                          {connect.isPending
                            ? t("integrations.vcsConnecting")
                            : t("integrations.vcsConnect")}
                        </Text>
                      </Button>
                    </>
                  )}
                </View>
              ) : connections.length === 0 ? (
                <Text className="text-xs text-muted-foreground">
                  {t("integrations.vcsContactAdmin")}
                </Text>
              ) : null}
            </>
          )}
        </View>
      </View>
    </View>
  );
}

function CopyRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const muted = theme.mutedForeground;
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await Clipboard.setStringAsync(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      Alert.alert(t("screen.integrations"), t("integrations.vcsCopyFailed"));
    }
  };

  return (
    <Pressable
      onPress={copy}
      className="rounded-md bg-secondary/60 px-2.5 py-2 flex-row items-center gap-2"
    >
      <View className="flex-1 min-w-0 gap-0.5">
        <Text className="text-[11px] text-muted-foreground">{label}</Text>
        <Text
          numberOfLines={2}
          className={cn(
            "text-xs text-foreground",
            mono && "font-mono",
          )}
        >
          {value || "—"}
        </Text>
      </View>
      <Ionicons
        name={copied ? "checkmark" : "copy-outline"}
        size={15}
        color={copied ? theme.success : muted}
      />
    </Pressable>
  );
}