/**
 * Plugins management page (iteration-99) — aligns web
 * `packages/views/settings/components/plugins-tab.tsx` as a push screen
 * reached from Settings (flag-gated by `plugins_v1`). Owner/admin surface:
 * catalog releases are reviewed, installed, scoped (workspace / agent) and
 * managed. Flag off → the Settings entry is hidden, so this screen is only
 * reachable on deployments that enable the Plugin catalog. State semantics
 * mirror the web tab exactly: installation defaults disabled, scopes are
 * bindings, enabled bindings receive new runs.
 */
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Stack } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { PluginCatalogRelease, PluginInstallation } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { agentListOptions } from "@/data/queries/agents";
import { memberListOptions } from "@/data/queries/members";
import {
  groupCatalogReleases,
  pluginCatalogOptions,
  pluginInstallationsOptions,
  pluginInstallationState,
  type PluginInstallationState,
} from "@/data/queries/plugins";
import {
  useInstallPlugin,
  useRollbackPlugin,
  useSetPluginEnabled,
  useUninstallPlugin,
  useUpgradePlugin,
} from "@/data/mutations/plugins";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useAuthStore } from "@/data/auth-store";
import { comparePluginVersions } from "@/lib/plugin-version";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

type BindingScope = "workspace" | "agent";

export default function PluginsPage() {
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const user = useAuthStore((s) => s.user);
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  const catalogQuery = useQuery(pluginCatalogOptions(wsId));
  const installationsQuery = useQuery(pluginInstallationsOptions(wsId));
  const agentsQuery = useQuery(agentListOptions(wsId));
  const membersQuery = useQuery(memberListOptions(wsId));

  const currentMember = membersQuery.data?.find(
    (m) => m.user_id === user?.id,
  );
  const canManage =
    currentMember?.role === "owner" || currentMember?.role === "admin";

  const installMutation = useInstallPlugin();
  const upgradeMutation = useUpgradePlugin();
  const enabledMutation = useSetPluginEnabled();
  const rollbackMutation = useRollbackPlugin();
  const uninstallMutation = useUninstallPlugin();

  const [selectedVersions, setSelectedVersions] = useState<
    Record<string, string>
  >({});
  const [selectedScopes, setSelectedScopes] = useState<
    Record<string, BindingScope>
  >({});
  const [selectedAgents, setSelectedAgents] = useState<Record<string, string>>(
    {},
  );

  const releasesByPlugin = useMemo(
    () => groupCatalogReleases(catalogQuery.data?.releases ?? []),
    [catalogQuery.data?.releases],
  );
  const officialInstallations = useMemo(
    () =>
      new Map(
        (installationsQuery.data?.plugins ?? [])
          .filter((p) => p.source_kind !== "private_dev")
          .map((p) => [p.plugin_key, p]),
      ),
    [installationsQuery.data?.plugins],
  );
  const privateInstallations = (installationsQuery.data?.plugins ?? []).filter(
    (p) => p.source_kind === "private_dev",
  );
  const agents = (agentsQuery.data ?? []).filter((a) => !a.archived_at);
  const members = membersQuery.data ?? [];

  const isMutating =
    installMutation.isPending ||
    upgradeMutation.isPending ||
    enabledMutation.isPending ||
    rollbackMutation.isPending ||
    uninstallMutation.isPending;

  const reportError = (error: unknown) => {
    Alert.alert(
      t("plugins.actionFailed"),
      error instanceof Error ? error.message : undefined,
    );
  };

  const showEmpty =
    !catalogQuery.isLoading &&
    !catalogQuery.isError &&
    releasesByPlugin.size === 0 &&
    privateInstallations.length === 0;

  return (
    <>
      <Stack.Screen options={{ title: t("plugins.title") }} />
      <ScrollView
        className="flex-1 bg-background"
        contentContainerClassName="px-4 py-4 gap-3"
      >
        <Text className="text-sm text-muted-foreground">
          {t("plugins.description")}
        </Text>

        {catalogQuery.isLoading || installationsQuery.isLoading ? (
          <View className="py-12 items-center gap-2">
            <ActivityIndicator />
            <Text className="text-sm text-muted-foreground">
              {t("plugins.loading")}
            </Text>
          </View>
        ) : catalogQuery.isError || installationsQuery.isError ? (
          <Notice
            title={t("plugins.loadFailed")}
            description={t("plugins.loadFailedDescription")}
            variant="error"
          />
        ) : catalogQuery.data?.supported !== true ? (
          <Notice
            title={t("plugins.backendUnavailable")}
            description={t("plugins.backendUnavailableDescription")}
            variant="info"
          />
        ) : (
          <>
            {(catalogQuery.data?.diagnostics?.length ?? 0) > 0 ? (
              <Notice
                title={t("plugins.catalogDegraded")}
                description={t("plugins.catalogDegradedDescription")}
                variant="error"
              />
            ) : null}

            {!canManage ? (
              <Notice
                title={t("plugins.readOnly")}
                description={t("plugins.readOnlyDescription")}
                variant="info"
              />
            ) : null}

            {showEmpty ? (
              <View className="py-10 items-center">
                <Text className="text-sm text-muted-foreground">
                  {t("plugins.empty")}
                </Text>
              </View>
            ) : null}

            {[...releasesByPlugin.entries()].map(([pluginKey, versions]) => {
              const latest = versions[0];
              if (!latest) return null;
              const installation =
                officialInstallations.get(pluginKey) ?? latest.installation;
              return (
                <OfficialPluginCard
                  key={pluginKey}
                  releases={versions}
                  installation={installation}
                  canManage={canManage}
                  isMutating={isMutating}
                  selectedVersion={
                    selectedVersions[pluginKey] ?? latest.version
                  }
                  onVersionChange={(version) =>
                    setSelectedVersions((cur) => ({
                      ...cur,
                      [pluginKey]: version,
                    }))
                  }
                  scope={installation ? selectedScopes[installation.id] ?? "workspace" : "workspace"}
                  onScopeChange={(scope) =>
                    installation &&
                    setSelectedScopes((cur) => ({
                      ...cur,
                      [installation.id]: scope,
                    }))
                  }
                  selectedAgent={
                    installation
                      ? selectedAgents[installation.id] ??
                        agents[0]?.id ??
                        ""
                      : ""
                  }
                  onAgentChange={(id) =>
                    installation &&
                    setSelectedAgents((cur) => ({
                      ...cur,
                      [installation.id]: id,
                    }))
                  }
                  agents={agents}
                  workspaceRequired={wsId ?? ""}
                  onInstall={(request) =>
                    installMutation
                      .mutateAsync(request)
                      .then(() =>
                        Alert.alert(t("plugins.installSuccess")),
                      )
                      .catch(reportError)
                  }
                  onEnableBinding={(args) =>
                    enabledMutation
                      .mutateAsync(args)
                      .then(() => Alert.alert(t("plugins.enabled")))
                      .catch(reportError)
                  }
                  onDisableBinding={(args) =>
                    enabledMutation
                      .mutateAsync(args)
                      .then(() => Alert.alert(t("plugins.bindingDisabled")))
                      .catch(reportError)
                  }
                  onDisableWorkspace={(installationId) =>
                    enabledMutation
                      .mutateAsync({
                        installationId,
                        enabled: false,
                        binding: { scope_type: "workspace", scope_id: wsId ?? "" },
                      })
                      .then(() => Alert.alert(t("plugins.disabled")))
                      .catch(reportError)
                  }
                  onUpgrade={(args) =>
                    upgradeMutation
                      .mutateAsync(args)
                      .then(() => Alert.alert(t("plugins.upgraded")))
                      .catch(reportError)
                  }
                  onRollback={(args) =>
                    rollbackMutation
                      .mutateAsync(args)
                      .then(() => Alert.alert(t("plugins.rolledBack")))
                      .catch(reportError)
                  }
                  onUninstall={(installationId) =>
                    Alert.alert(
                      t("plugins.confirmUninstallTitle"),
                      t("plugins.confirmUninstallMessage", {
                        name: installation?.display_name ?? pluginKey,
                      }),
                      [
                        { text: t("common.cancel"), style: "cancel" },
                        {
                          text: t("plugins.uninstall"),
                          style: "destructive",
                          onPress: () =>
                            uninstallMutation
                              .mutateAsync(installationId)
                              .then(() =>
                                Alert.alert(t("plugins.uninstalled")),
                              )
                              .catch(reportError),
                        },
                      ],
                    )
                  }
                />
              );
            })}

            {privateInstallations.map((installation) => (
              <PrivatePluginCard
                key={installation.id}
                installation={installation}
                canManage={canManage}
                isMutating={isMutating}
                scope={selectedScopes[installation.id] ?? "workspace"}
                onScopeChange={(scope) =>
                  setSelectedScopes((cur) => ({
                    ...cur,
                    [installation.id]: scope,
                  }))
                }
                selectedAgent={
                  selectedAgents[installation.id] ?? agents[0]?.id ?? ""
                }
                onAgentChange={(id) =>
                  setSelectedAgents((cur) => ({
                    ...cur,
                    [installation.id]: id,
                  }))
                }
                agents={agents}
                members={members}
                uploaderName={
                  installation.uploader_id
                    ? members.find(
                        (m) => m.user_id === installation.uploader_id,
                      )?.name
                    : undefined
                }
                workspaceRequired={wsId ?? ""}
                theme={theme}
                onEnableBinding={(args) =>
                  enabledMutation
                    .mutateAsync(args)
                    .then(() => Alert.alert(t("plugins.enabled")))
                    .catch(reportError)
                }
                onDisableBinding={(args) =>
                  enabledMutation
                    .mutateAsync(args)
                    .then(() => Alert.alert(t("plugins.bindingDisabled")))
                    .catch(reportError)
                }
                onRollback={(args) =>
                  rollbackMutation
                    .mutateAsync(args)
                    .then(() => Alert.alert(t("plugins.rolledBack")))
                    .catch(reportError)
                }
                onUninstall={(installationId) =>
                  Alert.alert(
                    t("plugins.confirmUninstallTitle"),
                    t("plugins.confirmUninstallMessage", {
                      name: installation.display_name,
                    }),
                    [
                      { text: t("common.cancel"), style: "cancel" },
                      {
                        text: t("plugins.uninstall"),
                        style: "destructive",
                        onPress: () =>
                          uninstallMutation
                            .mutateAsync(installationId)
                            .then(() => Alert.alert(t("plugins.uninstalled")))
                            .catch(reportError),
                      },
                    ],
                  )
                }
              />
            ))}
          </>
        )}
      </ScrollView>
    </>
  );
}

function Notice({
  title,
  description,
  variant,
}: {
  title: string;
  description: string;
  variant: "info" | "error";
}) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <View
      className={cn(
        "flex-row gap-2 rounded-md border p-3",
        variant === "error" ? "border-destructive/40" : "border-border",
      )}
    >
      <Ionicons
        name={variant === "error" ? "alert-circle" : "shield-checkmark-outline"}
        size={18}
        color={
          variant === "error"
            ? theme.destructive
            : theme.mutedForeground
        }
      />
      <View className="flex-1 gap-0.5">
        <Text className="text-sm font-medium text-foreground">{title}</Text>
        <Text className="text-xs text-muted-foreground">{description}</Text>
      </View>
    </View>
  );
}

function StateBadge({ state }: { state: PluginInstallationState }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const key =
    state === "disabled"
      ? "plugins.stateDisabled"
      : state === "activating"
        ? "plugins.stateActivating"
        : state === "healthy"
          ? "plugins.stateHealthy"
          : state === "degraded"
            ? "plugins.stateDegraded"
            : "plugins.stateFailed";
  const color =
    state === "failed"
      ? theme.destructive
      : state === "healthy"
        ? theme.success
        : theme.mutedForeground;
  return (
    <View
      className="px-1.5 py-0.5 rounded border"
      style={{ borderColor: color }}
    >
      <Text className="text-[10px] font-medium" style={{ color }}>
        {t(key)}
      </Text>
    </View>
  );
}

function Tag({ children }: { children: string }) {
  return (
    <View className="px-1.5 py-0.5 rounded border border-border">
      <Text className="text-[10px] text-muted-foreground">{children}</Text>
    </View>
  );
}

function OfficialPluginCard({
  releases,
  installation,
  canManage,
  isMutating,
  selectedVersion,
  onVersionChange,
  scope,
  onScopeChange,
  selectedAgent,
  onAgentChange,
  agents,
  workspaceRequired,
  onInstall,
  onEnableBinding,
  onDisableBinding,
  onDisableWorkspace,
  onUpgrade,
  onRollback,
  onUninstall,
}: {
  releases: PluginCatalogRelease[];
  installation?: PluginInstallation;
  canManage: boolean;
  isMutating: boolean;
  selectedVersion: string;
  onVersionChange: (version: string) => void;
  scope: BindingScope;
  onScopeChange: (scope: BindingScope) => void;
  selectedAgent: string;
  onAgentChange: (agentId: string) => void;
  agents: { id: string; name: string }[];
  workspaceRequired: string;
  onInstall: (request: { plugin_key: string; version: string }) => void;
  onEnableBinding: (args: {
    installationId: string;
    enabled: boolean;
    binding: { scope_type: BindingScope; scope_id: string };
  }) => void;
  onDisableBinding: (args: {
    installationId: string;
    enabled: boolean;
    binding: { scope_type: BindingScope; scope_id: string };
  }) => void;
  onDisableWorkspace: (installationId: string) => void;
  onUpgrade: (args: {
    installationId: string;
    plugin_key: string;
    version: string;
  }) => void;
  onRollback: (args: {
    installationId: string;
    version: string;
  }) => void;
  onUninstall: (installationId: string) => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  const latest = releases[0]!;
  const selectedRelease =
    releases.find((r) => r.version === selectedVersion) ?? latest;
  const upgrade =
    installation &&
    comparePluginVersions(latest.version, installation.desired_version) > 0
      ? latest
      : null;
  const rollback = installation
    ? releases.find((r) =>
        comparePluginVersions(r.version, installation.desired_version) < 0,
      )
    : null;
  const state = installation ? pluginInstallationState(installation) : null;
  const activeBindings =
    installation?.bindings.filter((b) => b.enabled === true) ?? [];
  const workspaceBindingActive = activeBindings.some(
    (b) => b.scope_type === "workspace",
  );

  return (
    <View className="rounded-md border border-border bg-card overflow-hidden">
      <View className="p-4 gap-3">
        {/* Header */}
        <View className="gap-1">
          <View className="flex-row items-start justify-between gap-2">
            <View className="flex-1 min-w-0 gap-1.5">
              <View className="flex-row items-center gap-1.5 flex-wrap">
                <Ionicons name="cube-outline" size={16} color={theme.primary} />
                <Text className="text-base font-semibold text-foreground">
                  {latest.name}
                </Text>
                <Tag>{t("plugins.official")}</Tag>
                <Tag>
                  {latest.signature_verified === true
                    ? t("plugins.signed")
                    : t("plugins.signatureUnverified")}
                </Tag>
                {state ? <StateBadge state={state} /> : null}
              </View>
              {latest.description ? (
                <Text className="text-xs text-muted-foreground">
                  {latest.description}
                </Text>
              ) : null}
              <Text className="text-[11px] font-mono text-muted-foreground">
                {latest.plugin_key}
              </Text>
            </View>
            <View className="px-2 py-0.5 rounded-full bg-secondary">
              <Text className="text-[11px] text-muted-foreground font-medium tabular-nums">
                {installation?.desired_version ?? selectedRelease.version}
              </Text>
            </View>
          </View>
        </View>

        {/* Review */}
        <View className="gap-2">
          <ReviewRow
            label={t("plugins.reviewContributes")}
            value={
              selectedRelease.contributions.length > 0
                ? selectedRelease.contributions
                    .map((c) => `${c.name} · ${c.type} — ${c.description}`)
                    .join("\n")
                : t("plugins.reviewNone")
            }
          />
          <ReviewRow
            label={t("plugins.reviewPermissions")}
            value={
              selectedRelease.requested_capabilities.join(", ") ||
              t("plugins.reviewNone")
            }
          />
          <ReviewRow
            label={t("plugins.reviewCompatibility")}
            value={`${t("plugins.reviewHostApi")} ${selectedRelease.host_api} · ${selectedRelease.required_daemon_features.join(", ")}`}
          />
          <ReviewRow
            label={t("plugins.reviewPublisher")}
            value={`${selectedRelease.publisher} · ${selectedRelease.signature_key_id}`}
          />
        </View>

        {selectedRelease.compatible !== true ? (
          <Notice
            title={t("plugins.incompatible")}
            description={t("plugins.incompatibleDescription")}
            variant="error"
          />
        ) : null}

        <Separator />

        {!installation ? (
          <View className="gap-3">
            <Text className="text-xs text-muted-foreground">
              {t("plugins.installDisabledHint")}
            </Text>
            {releases.length > 1 ? (
              <View className="gap-1.5">
                <Text className="text-[11px] font-medium text-muted-foreground">
                  {t("plugins.versions")}
                </Text>
                <VersionChips
                  versions={releases.map((r) => r.version)}
                  selected={selectedVersion}
                  onSelect={onVersionChange}
                />
              </View>
            ) : null}
            <Button
              disabled={
                !canManage ||
                isMutating ||
                selectedRelease.compatible !== true ||
                selectedRelease.signature_verified !== true
              }
              onPress={() =>
                onInstall({
                  plugin_key: latest.plugin_key,
                  version: selectedRelease.version,
                })
              }
            >
              <Text>{t("plugins.install")}</Text>
            </Button>
          </View>
        ) : (
          <View className="gap-3">
            {/* Active version / health */}
            <Text className="text-xs text-muted-foreground">
              {t("plugins.activeVersion")}{" "}
              {installation.active_version || "—"}
              {" · "}
              {t("plugins.health")} {installation.health_state || installation.lifecycle_status}
            </Text>

            {/* Enabled bindings */}
            <View className="gap-1.5">
              <Text className="text-[11px] font-medium text-muted-foreground">
                {t("plugins.bindings")}
              </Text>
              {activeBindings.length > 0 ? (
                activeBindings.map((binding) => {
                  const agentName = agents.find(
                    (a) => a.id === binding.scope_id,
                  )?.name;
                  return (
                    <View
                      key={`${binding.scope_type}:${binding.scope_id}`}
                      className="flex-row items-center justify-between rounded-md bg-muted px-3 py-2 gap-2"
                    >
                      <Text className="flex-1 text-xs text-foreground">
                        {binding.scope_type === "agent"
                          ? `${t("plugins.agentScope")} · ${
                              agentName ?? t("plugins.unknownAgent")
                            }`
                          : t("plugins.workspaceScope")}
                      </Text>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!canManage || isMutating}
                        onPress={() =>
                          onDisableBinding({
                            installationId: installation.id,
                            enabled: false,
                            binding: {
                              scope_type:
                                binding.scope_type === "agent"
                                  ? "agent"
                                  : "workspace",
                              scope_id: binding.scope_id,
                            },
                          })
                        }
                      >
                        <Text className="text-xs">
                          {t("plugins.disableBinding")}
                        </Text>
                      </Button>
                    </View>
                  );
                })
              ) : (
                <Text className="text-xs text-muted-foreground">
                  {t("plugins.noBindings")}
                </Text>
              )}
            </View>

            {/* Enable scope */}
            <ScopePicker
              scope={scope}
              onScopeChange={onScopeChange}
              agents={agents}
              selectedAgent={selectedAgent}
              onAgentChange={onAgentChange}
              disabled={!canManage}
            />
            <View className="flex-row gap-2">
              <Button
                className="flex-1"
                disabled={
                  !canManage ||
                  isMutating ||
                  (scope === "agent" && !selectedAgent) ||
                  !workspaceRequired
                }
                onPress={() =>
                  onEnableBinding({
                    installationId: installation.id,
                    enabled: true,
                    binding: {
                      scope_type: scope,
                      scope_id:
                        scope === "workspace" ? workspaceRequired : selectedAgent,
                    },
                  })
                }
              >
                <Text>{t("plugins.enableScope")}</Text>
              </Button>
              <Button
                variant="outline"
                disabled={!canManage || isMutating || !workspaceBindingActive}
                onPress={() => onDisableWorkspace(installation.id)}
              >
                <Text>{t("plugins.disableWorkspace")}</Text>
              </Button>
            </View>

            {/* Upgrade / rollback / uninstall */}
            <View className="flex-row flex-wrap gap-2">
              {upgrade ? (
                <Button
                  variant="outline"
                  disabled={!canManage || isMutating || upgrade.compatible !== true}
                  onPress={() =>
                    onUpgrade({
                      installationId: installation.id,
                      plugin_key: latest.plugin_key,
                      version: upgrade.version,
                    })
                  }
                >
                  <Text>
                    {t("plugins.upgradeTo", { version: upgrade.version })}
                  </Text>
                </Button>
              ) : null}
              {rollback ? (
                <Button
                  variant="outline"
                  disabled={!canManage || isMutating}
                  onPress={() =>
                    onRollback({
                      installationId: installation.id,
                      version: rollback.version,
                    })
                  }
                >
                  <Text>
                    {t("plugins.rollbackTo", { version: rollback.version })}
                  </Text>
                </Button>
              ) : null}
              <Button
                variant="destructive"
                disabled={!canManage || isMutating}
                onPress={() => onUninstall(installation.id)}
              >
                <Text>{t("plugins.uninstall")}</Text>
              </Button>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

function PrivatePluginCard({
  installation,
  canManage,
  isMutating,
  scope,
  onScopeChange,
  selectedAgent,
  onAgentChange,
  agents,
  members,
  uploaderName,
  workspaceRequired,
  theme,
  onEnableBinding,
  onDisableBinding,
  onRollback,
  onUninstall,
}: {
  installation: PluginInstallation;
  canManage: boolean;
  isMutating: boolean;
  scope: BindingScope;
  onScopeChange: (scope: BindingScope) => void;
  selectedAgent: string;
  onAgentChange: (agentId: string) => void;
  agents: { id: string; name: string }[];
  members: { user_id: string; name?: string }[];
  uploaderName: string | undefined;
  workspaceRequired: string;
  theme: (typeof THEME)[keyof typeof THEME];
  onEnableBinding: (args: {
    installationId: string;
    enabled: boolean;
    binding: { scope_type: BindingScope; scope_id: string };
  }) => void;
  onDisableBinding: (args: {
    installationId: string;
    enabled: boolean;
    binding: { scope_type: BindingScope; scope_id: string };
  }) => void;
  onRollback: (args: { installationId: string; version: string }) => void;
  onUninstall: (installationId: string) => void;
}) {
  const { t } = useTranslation();

  const state = pluginInstallationState(installation);
  const activeBindings = installation.bindings.filter((b) => b.enabled === true);
  const rollbackVersion = [...installation.available_versions]
    .sort((a, b) => comparePluginVersions(b, a))
    .find((v) => comparePluginVersions(v, installation.desired_version) < 0);

  return (
    <View className="rounded-md border border-border bg-card overflow-hidden">
      <View className="p-4 gap-3">
        <View className="flex-row items-start justify-between gap-2">
          <View className="flex-1 min-w-0 gap-1.5">
            <View className="flex-row items-center gap-1.5 flex-wrap">
              <Ionicons name="cube-outline" size={16} color={theme.primary} />
              <Text className="text-base font-semibold text-foreground">
                {installation.display_name}
              </Text>
              <Tag>{t("plugins.private")}</Tag>
              <Tag>{t("plugins.unverified")}</Tag>
              <StateBadge state={state} />
            </View>
            {installation.description ? (
              <Text className="text-xs text-muted-foreground">
                {installation.description}
              </Text>
            ) : null}
            <Text className="text-[11px] font-mono text-muted-foreground">
              {installation.plugin_key}
            </Text>
          </View>
          <View className="px-2 py-0.5 rounded-full bg-secondary">
            <Text className="text-[11px] text-muted-foreground font-medium tabular-nums">
              {installation.desired_version}
            </Text>
          </View>
        </View>

        <View className="gap-2">
          <ReviewRow
            label={t("plugins.reviewContributes")}
            value={
              installation.contribution_details.length > 0
                ? installation.contribution_details
                    .map(
                      (c) =>
                        `${c.name || c.key} · ${c.type}${c.description ? ` — ${c.description}` : ""}`,
                    )
                    .join("\n")
                : t("plugins.reviewNone")
            }
          />
          <ReviewRow
            label={t("plugins.reviewPermissions")}
            value={
              installation.requested_capabilities.join(", ") ||
              t("plugins.reviewNone")
            }
          />
          <ReviewRow
            label={t("plugins.reviewPublisher")}
            value={installation.publisher}
          />
          <ReviewRow
            label={t("plugins.source")}
            value={`${t("plugins.privateUpload")}${installation.uploader_id ? ` · ${t("plugins.uploadedBy")} ${uploaderName ?? t("plugins.unknownMember")}` : ""}`}
          />
        </View>

        <Separator />

        <Text className="text-xs text-muted-foreground">
          {t("plugins.activeVersion")} {installation.active_version || "—"}
          {" · "}
          {t("plugins.health")} {installation.health_state || installation.lifecycle_status}
        </Text>

        <View className="gap-1.5">
          <Text className="text-[11px] font-medium text-muted-foreground">
            {t("plugins.bindings")}
          </Text>
          {activeBindings.length > 0 ? (
            activeBindings.map((binding) => {
              const agentName = agents.find(
                (a) => a.id === binding.scope_id,
              )?.name;
              return (
                <View
                  key={`${binding.scope_type}:${binding.scope_id}`}
                  className="flex-row items-center justify-between rounded-md bg-muted px-3 py-2 gap-2"
                >
                  <Text className="flex-1 text-xs text-foreground">
                    {binding.scope_type === "agent"
                      ? t("plugins.agentScope")
                      : t("plugins.workspaceScope")}{" "}
                    ·{" "}
                    {binding.scope_type === "agent"
                      ? (agentName ?? t("plugins.unknownAgent"))
                      : t("plugins.workspaceScope")}
                  </Text>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!canManage || isMutating}
                    onPress={() =>
                      onDisableBinding({
                        installationId: installation.id,
                        enabled: false,
                        binding: {
                          scope_type:
                            binding.scope_type === "agent"
                              ? "agent"
                              : "workspace",
                          scope_id: binding.scope_id,
                        },
                      })
                    }
                  >
                    <Text className="text-xs">
                      {t("plugins.disableBinding")}
                    </Text>
                  </Button>
                </View>
              );
            })
          ) : (
            <Text className="text-xs text-muted-foreground">
              {t("plugins.noBindings")}
            </Text>
          )}
        </View>

        <ScopePicker
          scope={scope}
          onScopeChange={onScopeChange}
          agents={agents}
          selectedAgent={selectedAgent}
          onAgentChange={onAgentChange}
          disabled={!canManage}
        />
        <Button
          disabled={
            !canManage ||
            isMutating ||
            (scope === "agent" && !selectedAgent) ||
            !workspaceRequired
          }
          onPress={() =>
            onEnableBinding({
              installationId: installation.id,
              enabled: true,
              binding: {
                scope_type: scope,
                scope_id:
                  scope === "workspace" ? workspaceRequired : selectedAgent,
              },
            })
          }
        >
          <Text>{t("plugins.enableScope")}</Text>
        </Button>

        <View className="flex-row flex-wrap gap-2">
          {rollbackVersion ? (
            <Button
              variant="outline"
              disabled={!canManage || isMutating}
              onPress={() =>
                onRollback({
                  installationId: installation.id,
                  version: rollbackVersion,
                })
              }
            >
              <Text>
                {t("plugins.rollbackTo", { version: rollbackVersion })}
              </Text>
            </Button>
          ) : null}
          <Button
            variant="destructive"
            disabled={!canManage || isMutating}
            onPress={() => onUninstall(installation.id)}
          >
            <Text>{t("plugins.uninstall")}</Text>
          </Button>
        </View>
      </View>
    </View>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text className="text-[11px] font-medium text-muted-foreground">
        {label}
      </Text>
      <Text className="text-xs text-foreground" numberOfLines={4}>
        {value}
      </Text>
    </View>
  );
}

function VersionChips({
  versions,
  selected,
  onSelect,
}: {
  versions: string[];
  selected: string;
  onSelect: (version: string) => void;
}) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <View className="flex-row flex-wrap gap-1.5">
      {versions.map((v) => {
        const active = v === selected;
        return (
          <Pressable
            key={v}
            onPress={() => onSelect(v)}
            className={cn(
              "px-2.5 py-1 rounded-full border",
              active ? "border-primary" : "border-border",
            )}
            style={
              active ? { backgroundColor: theme.primary + "1a" } : undefined
            }
          >
            <Text
              className={cn(
                "text-[11px] font-mono",
                active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {v}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ScopePicker({
  scope,
  onScopeChange,
  agents,
  selectedAgent,
  onAgentChange,
  disabled,
}: {
  scope: BindingScope;
  onScopeChange: (scope: BindingScope) => void;
  agents: { id: string; name: string }[];
  selectedAgent: string;
  onAgentChange: (agentId: string) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <View className="gap-2">
      <View className="flex-row rounded-md border border-border overflow-hidden">
        {(["workspace", "agent"] as const).map((option) => {
          const active = scope === option;
          return (
            <Pressable
              key={option}
              disabled={disabled}
              onPress={() => onScopeChange(option)}
              className={cn(
                "flex-1 items-center py-2",
                active ? "bg-secondary" : "bg-background",
              )}
              style={
                active ? { backgroundColor: theme.secondary } : undefined
              }
            >
              <Text
                className={cn(
                  "text-xs font-medium",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {option === "workspace"
                  ? t("plugins.workspaceScope")
                  : t("plugins.agentScope")}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {scope === "agent" ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="-mx-1"
          contentContainerClassName="px-1 gap-1.5"
        >
          {agents.map((agent) => {
            const active = agent.id === selectedAgent;
            return (
              <Pressable
                key={agent.id}
                disabled={disabled}
                onPress={() => onAgentChange(agent.id)}
                className={cn(
                  "py-1 px-2.5 rounded-full border",
                  active ? "border-primary" : "border-border",
                )}
                style={
                  active
                    ? { backgroundColor: theme.primary + "1a" }
                    : undefined
                }
              >
                <Text
                  className={cn(
                    "text-[11px]",
                    active ? "text-foreground" : "text-muted-foreground",
                  )}
                  numberOfLines={1}
                >
                  {agent.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );
}