/**
 * Runtime detail screen (read-only + management, iteration-51). Reached from
 * the runtimes list row. Mirrors web `packages/views/runtimes/components/runtime-detail.tsx`
 * semantics on a phone: identity card (icon + display name + kind badge +
 * derived health) over a meta sheet of the server fields the workspace sees,
 * plus a Diagnostics card with the management actions — visibility editor
 * (owner-only, MUL-6126), custom-name rename (admin/owner, MUL-4217), and
 * delete (custom-profile admin-only, built-in admin-or-owner) with the
 * unbind-agents cascade (MUL-5559).
 *
 * The server has no GET /api/runtimes/:id endpoint (router.go only exposes
 * list + PATCH/DELETE + usage), so this screen reuses the same workspace
 * list query as the browse page and picks its row by id — stale-while-reuse
 * is free, and a deep link just triggers the list fetch.
 *
 * Health is re-derived on a 30s tick so recently_lost → offline (5-min
 * boundary with no new data) stays truthful, same cadence as web's
 * use-runtime-health.
 */
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  View,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { deriveRuntimeHealth, runtimeDisplayLabel } from "@multica/core/runtimes";
import type { RuntimeHealth } from "@multica/core/runtimes";
import type { AgentRuntime } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { Switch } from "@/components/ui/switch";
import { RuntimeProfilesDialog } from "@/components/runtimes/runtime-profiles-dialog";
import { UpdateSection } from "@/components/runtimes/update-section";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { memberListOptions } from "@/data/queries/members";
import { agentListOptions } from "@/data/queries/agents";
import { buildRuntimeMachines, machineUpdateRuntime, readRuntimeMetadata } from "@/lib/runtime-machines";
import {
  useUpdateRuntime,
  useDeleteRuntime,
  useUnbindAgentsAndDeleteRuntime,
} from "@/data/mutations/runtimes";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useAuthStore } from "@/data/auth-store";
import { useTimeAgo } from "@/lib/time-ago";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import {
  deriveRuntimePermissions,
  isSelfHealingRuntime,
  parseActiveAgentsConflict,
} from "@/lib/runtime-management";

const MODE_ICON: Record<AgentRuntime["runtime_mode"], keyof typeof Ionicons.glyphMap> = {
  local: "hardware-chip",
  cloud: "cloud",
};

const HEALTH_DOT: Record<RuntimeHealth, string> = {
  online: "bg-success",
  recently_lost: "bg-warning",
  offline: "bg-muted-foreground/40",
  about_to_gc: "bg-destructive",
};

const HEALTH_TONE: Record<RuntimeHealth, string> = {
  online: "text-success",
  recently_lost: "text-warning",
  offline: "text-muted-foreground",
  about_to_gc: "text-destructive",
};

function MetaRow({
  icon,
  label,
  value,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  value: string;
}) {
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  return (
    <View className="flex-row items-start gap-2 py-1.5">
      <Ionicons name={icon} size={14} color={muted} style={{ marginTop: 1 }} />
      <Text className="text-xs text-muted-foreground w-16">{label}</Text>
      <Text className="text-xs text-foreground flex-1" numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

export default function RuntimeDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const user = useAuthStore((s) => s.user);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const timeAgo = useTimeAgo();

  // 30s health re-derivation tick (web's HEALTH_TICK_MS).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const { data = [], isLoading, error, refetch } = useQuery(runtimeListOptions(wsId));
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const {
    data: agents = [],
    refetch: refetchAgents,
  } = useQuery(agentListOptions(wsId));

  const updateRuntime = useUpdateRuntime();
  const deleteRuntime = useDeleteRuntime();
  const unbindDelete = useUnbindAgentsAndDeleteRuntime();

  // "Add custom runtime" (web detail-page entry, intent=create) — opens the
  // runtime-profiles dialog at the create form.
  const [showProfiles, setShowProfiles] = useState(false);

  const runtime = useMemo(
    () => (id ? data.find((r) => r.id === id) : undefined),
    [data, id],
  );

  // Machine consolidation (iteration-83, A2.4) — the runtime belongs to a
  // machine; the machine carries the daemon-wide CLI version / launched-by
  // metadata and decides which (if any) runtime the viewer may use as the
  // update command channel. Web resolves the same way in
  // runtime-detail-page.tsx via machineUpdateRuntime (canManageAnyRuntime =
  // workspace admin).
  const isAdminViewer =
    !!user?.id &&
    members.some((m) => m.user_id === user.id && m.role === "admin");
  const machines = useMemo(
    () =>
      user?.id
        ? buildRuntimeMachines(data, { now: Date.now(), currentUserId: user.id })
        : [],
    [data, user?.id],
  );
  const machine = useMemo(
    () => machines.find((m) => m.runtimes.some((r) => r.id === id)),
    [machines, id],
  );
  const cliVersion =
    machine?.cliVersion ?? (runtime ? readRuntimeMetadata(runtime, "cli_version") : null);
  const launchedBy =
    machine?.launchedBy ?? (runtime ? readRuntimeMetadata(runtime, "launched_by") : null);
  const updateChannel = machine
    ? machineUpdateRuntime(machine, user?.id, isAdminViewer)
    : null;
  const showVersionSection =
    machine !== undefined && (!!cliVersion || !!launchedBy || updateChannel !== null);

  // Rename inline editor state.
  const [renameOpen, setRenameOpen] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [applyToMachine, setApplyToMachine] = useState(false);

  const activeAgents = useMemo(
    () =>
      agents.filter(
        (a) => a.runtime_id === runtime?.id && !a.archived_at,
      ),
    [agents, runtime?.id],
  );

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (error || !runtime) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6 gap-3">
        <Ionicons name="server-outline" size={32} color={theme.mutedForeground} />
        <Text className="text-sm text-muted-foreground text-center mt-2">
          {t("runtimes.notFound")}
        </Text>
        <Button variant="outline" onPress={() => refetch()}>
          <Text>{t("workspace.retry")}</Text>
        </Button>
      </View>
    );
  }

  const health = deriveRuntimeHealth(runtime, now);
  const isCustom = !!runtime.profile_id;
  const lastSeen = runtime.last_seen_at
    ? timeAgo(runtime.last_seen_at)
    : t("runtimes.detail.never");
  const selfHeal = isSelfHealingRuntime(runtime);
  const access = deriveRuntimePermissions({
    members: members.map((m) => ({ role: m.role, user_id: m.user_id })),
    currentUserId: user?.id ?? null,
    runtime,
  });
  const displayName = runtimeDisplayLabel(runtime);
  const isPublic = runtime.visibility === "public";

  const openRename = () => {
    setNameInput(runtime.custom_name ?? runtime.name);
    setRenameOpen(true);
  };

  const flipVisibility = (next: "private" | "public") => {
    if (next === runtime.visibility) return;
    updateRuntime.mutate(
      { runtimeId: runtime.id, patch: { visibility: next } },
      {
        onSuccess: () => Alert.alert(t("runtimes.detail.visibilityUpdated")),
        onError: (err) =>
          Alert.alert(
            t("runtimes.detail.visibilityFailed"),
            err instanceof Error ? err.message : t("runtimes.detail.unknown"),
          ),
      },
    );
  };

  const handleRenameSave = () => {
    const trimmed = nameInput.trim();
    setRenameOpen(false);
    updateRuntime.mutate(
      {
        runtimeId: runtime.id,
        patch: {
          custom_name: trimmed,
          ...(applyToMachine ? { apply_to_machine: true } : {}),
        },
      },
      {
        onSuccess: () => Alert.alert(t("runtimes.detail.renameUpdated")),
        onError: (err) =>
          Alert.alert(
            t("runtimes.detail.renameFailed"),
            err instanceof Error ? err.message : t("runtimes.detail.unknown"),
          ),
      },
    );
  };

  const buildLightMessage = () => {
    const parts = [t("runtimes.detail.deleteConfirmMessage", { name: displayName })];
    if (selfHeal) parts.push(t("runtimes.detail.selfHealHint"));
    return parts.join("\n\n");
  };

  const buildCascadeMessage = (plan: { id: string; name: string }[]) => {
    const count = plan.length;
    const names = plan.slice(0, 8).map((a) => a.name).join("、");
    const parts = [
      t("runtimes.detail.deleteWithAgentsMessage", {
        count,
        name: displayName,
      }),
      t("runtimes.detail.deleteBanner"),
      names,
    ];
    if (selfHeal) parts.push(t("runtimes.detail.selfHealHint"));
    return parts.join("\n\n");
  };

  const runUnbindDelete = (agentIds: string[]) => {
    unbindDelete.mutate(
      { runtimeId: runtime.id, expectedActiveAgentIds: agentIds },
      {
        onSuccess: () => router.back(),
        onError: (err) => {
          const conflict = parseActiveAgentsConflict(err);
          if (conflict?.code === "runtime_delete_plan_changed") {
            // Plan moved under us — refresh the agent list and force a
            // re-confirm against the server's authoritative snapshot.
            void refetchAgents();
            Alert.alert(
              t("runtimes.detail.deleteWithAgentsTitle"),
              `${t("runtimes.detail.planChangedRetry")}\n\n${buildCascadeMessage(conflict.activeAgents)}`,
              [
                { text: t("runtimes.detail.renameCancel"), style: "cancel" },
                {
                  text: t("runtimes.detail.deleteButton"),
                  style: "destructive",
                  onPress: () =>
                    runUnbindDelete(conflict.activeAgents.map((a) => a.id)),
                },
              ],
            );
            return;
          }
          Alert.alert(
            t("runtimes.detail.deleteFailed"),
            err instanceof Error ? err.message : t("runtimes.detail.unknown"),
          );
        },
      },
    );
  };

  const confirmLightDelete = () => {
    deleteRuntime.mutate(runtime.id, {
      onSuccess: () => router.back(),
      onError: (err) => {
        const conflict = parseActiveAgentsConflict(err);
        if (conflict?.code === "runtime_has_active_agents") {
          // Agents were bound between dialog-open and confirm — pivot to
          // the cascade flow with the server's authoritative list.
          Alert.alert(
            t("runtimes.detail.deleteWithAgentsTitle"),
            buildCascadeMessage(conflict.activeAgents),
            [
              { text: t("runtimes.detail.renameCancel"), style: "cancel" },
              {
                text: t("runtimes.detail.deleteButton"),
                style: "destructive",
                onPress: () =>
                  runUnbindDelete(conflict.activeAgents.map((a) => a.id)),
              },
            ],
          );
          return;
        }
        Alert.alert(
          t("runtimes.detail.deleteFailed"),
          err instanceof Error ? err.message : t("runtimes.detail.unknown"),
        );
      },
    });
  };

  const confirmCascadeDelete = () => {
    runUnbindDelete(activeAgents.map((a) => a.id));
  };

  const handleDeletePress = () => {
    if (activeAgents.length > 0) {
      Alert.alert(
        t("runtimes.detail.deleteWithAgentsTitle"),
        buildCascadeMessage(activeAgents),
        [
          { text: t("runtimes.detail.renameCancel"), style: "cancel" },
          {
            text: t("runtimes.detail.deleteButton"),
            style: "destructive",
            onPress: confirmCascadeDelete,
          },
        ],
      );
    } else {
      Alert.alert(
        t("runtimes.detail.deleteConfirmTitle"),
        buildLightMessage(),
        [
          { text: t("runtimes.detail.renameCancel"), style: "cancel" },
          {
            text: t("runtimes.detail.deleteButton"),
            style: "destructive",
            onPress: confirmLightDelete,
          },
        ],
      );
    }
  };

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="pb-10">
      {showProfiles ? (
        <RuntimeProfilesDialog
          intent="create"
          onClose={() => setShowProfiles(false)}
        />
      ) : null}
      {/* Identity card */}
      <View className="px-4 pt-4 gap-1">
        <View className="flex-row items-center gap-3">
          <View className="size-10 rounded-xl bg-secondary items-center justify-center mt-0.5">
            <Ionicons
              name={MODE_ICON[runtime.runtime_mode] ?? "server"}
              size={20}
              color={theme.mutedForeground}
            />
          </View>
          <View className="flex-1 min-w-0 gap-1">
            <View className="flex-row items-center gap-1.5 flex-wrap">
              <Text className="text-base font-semibold text-foreground">
                {displayName}
              </Text>
              <View className="px-1.5 py-px rounded-full bg-secondary">
                <Text className="text-[10px] text-muted-foreground font-medium">
                  {isCustom ? t("runtimes.kind.custom") : t("runtimes.kind.builtin")}
                </Text>
              </View>
              {!access.canEditRuntime ? (
                <View className="px-1.5 py-px rounded-full bg-secondary">
                  <Text className="text-[10px] text-muted-foreground font-medium">
                    {t("runtimes.detail.readOnly")}
                  </Text>
                </View>
              ) : null}
            </View>
            <View className="flex-row items-center gap-1.5">
              <View className={cn("size-2 rounded-full", HEALTH_DOT[health])} />
              <Text className={cn("text-xs font-medium", HEALTH_TONE[health])}>
                {t(`runtimes.health.${health}`)}
              </Text>
            </View>
          </View>
        </View>

        {/* Meta sheet */}
        <View className="mt-4 rounded-lg border border-border divide-y divide-border">
          <View className="px-3 py-1">
            <MetaRow
              icon="radio-outline"
              label={t("runtimes.detail.status")}
              value={t(`runtimes.health.${health}`)}
            />
          </View>
          <View className="px-3 py-1">
            <MetaRow
              icon="layers-outline"
              label={t("runtimes.detail.mode")}
              value={
                runtime.runtime_mode === "cloud"
                  ? t("runtimes.mode.cloud")
                  : t("runtimes.mode.local")
              }
            />
          </View>
          {runtime.provider ? (
            <View className="px-3 py-1">
              <MetaRow
                icon="cube-outline"
                label={t("runtimes.detail.provider")}
                value={runtime.provider}
              />
            </View>
          ) : null}
          <View className="px-3 py-1">
            <MetaRow
              icon="eye-outline"
              label={t("runtimes.detail.visibility")}
              value={
                runtime.visibility === "public"
                  ? t("runtimes.visibility.public")
                  : t("runtimes.visibility.private")
              }
            />
          </View>
          {runtime.device_info ? (
            <View className="px-3 py-1">
              <MetaRow
                icon="phone-portrait-outline"
                label={t("runtimes.detail.device")}
                value={runtime.device_info}
              />
            </View>
          ) : null}
          {runtime.daemon_id ? (
            <View className="px-3 py-1">
              <MetaRow
                icon="git-branch-outline"
                label={t("runtimes.detail.daemon")}
                value={runtime.daemon_id}
              />
            </View>
          ) : null}
          {runtime.launch_header ? (
            <View className="px-3 py-1">
              <MetaRow
                icon="terminal-outline"
                label={t("runtimes.detail.launch")}
                value={runtime.launch_header}
              />
            </View>
          ) : null}
          <View className="px-3 py-1">
            <MetaRow
              icon="time-outline"
              label={t("runtimes.detail.lastSeen")}
              value={lastSeen}
            />
          </View>
          {runtime.created_at ? (
            <View className="px-3 py-1">
              <MetaRow
                icon="calendar-outline"
                label={t("runtimes.detail.createdAt")}
                value={timeAgo(runtime.created_at)}
              />
            </View>
          ) : null}
          {runtime.updated_at ? (
            <View className="px-3 py-1">
              <MetaRow
                icon="refresh-outline"
                label={t("runtimes.detail.updatedAt")}
                value={timeAgo(runtime.updated_at)}
              />
            </View>
          ) : null}
        </View>

        {/* Version & daemon-update card (iteration-83, A2.4) — web's
            MachineCliSection: machine-wide CLI version, the Desktop-managed
            marker, and the UpdateSection state machine for local machines. */}
        {showVersionSection && machine ? (
          <View className="mt-4 rounded-lg border border-border">
            <View className="border-b border-border px-3 py-2">
              <Text className="text-xs font-semibold text-foreground">
                {t("runtimes.update.section_title")}
              </Text>
            </View>
            <View className="p-3">
              {machine.mode !== "local" ? (
                <View className="flex-row items-center gap-2">
                  <Ionicons
                    name="cube-outline"
                    size={14}
                    color={theme.mutedForeground}
                  />
                  <Text className="text-xs text-muted-foreground">
                    {t("runtimes.update.cli_version_label")}
                  </Text>
                  <Text className="text-xs font-mono text-foreground">
                    {cliVersion ?? t("runtimes.update.version_unknown")}
                  </Text>
                </View>
              ) : (
                <UpdateSection
                  runtimeId={updateChannel?.id ?? null}
                  currentVersion={cliVersion}
                  isOnline={updateChannel?.status === "online"}
                  launchedBy={launchedBy}
                />
              )}
            </View>
          </View>
        ) : null}

        {/* Diagnostics card — visibility / rename / delete */}
        <View className="mt-4 rounded-lg border border-border">
          <View className="border-b border-border px-3 py-2">
            <Text className="text-xs font-semibold text-foreground">
              {t("runtimes.detail.diagnostics")}
            </Text>
          </View>
          <View className="p-3 gap-3">
            {/* Add custom runtime profile (iteration-82, A2.3) — web's
                detail page gates this on canAddRuntime (owner/admin). */}
            {access.canEditRuntime ? (
              <View className="gap-1.5 pb-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 justify-start gap-2 px-0"
                  onPress={() => setShowProfiles(true)}
                >
                  <Ionicons
                    name="add-circle-outline"
                    size={14}
                    color={theme.mutedForeground}
                  />
                  <Text className="text-xs text-foreground">
                    {t("runtimes.profiles.addCustom")}
                  </Text>
                </Button>
              </View>
            ) : null}

            {/* Visibility */}
            <View className="gap-1.5">
              <Text className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {t("runtimes.detail.visibility")}
              </Text>
              {access.canEditVisibility ? (
                <View className="gap-1.5">
                  <View className="flex-row gap-1.5">
                    <Button
                      size="sm"
                      variant={!isPublic ? "secondary" : "outline"}
                      onPress={() => flipVisibility("private")}
                      disabled={updateRuntime.isPending}
                    >
                      <Ionicons
                        name="lock-closed-outline"
                        size={14}
                        color={theme.mutedForeground}
                      />
                      <Text>{t("runtimes.visibility.private")}</Text>
                    </Button>
                    <Button
                      size="sm"
                      variant={isPublic ? "secondary" : "outline"}
                      onPress={() => flipVisibility("public")}
                      disabled={updateRuntime.isPending}
                    >
                      <Ionicons
                        name="globe-outline"
                        size={14}
                        color={theme.mutedForeground}
                      />
                      <Text>{t("runtimes.visibility.public")}</Text>
                    </Button>
                  </View>
                  <Text className="text-xs text-muted-foreground">
                    {t(
                      isPublic
                        ? "runtimes.detail.visibilityHint.public"
                        : "runtimes.detail.visibilityHint.private",
                    )}
                  </Text>
                </View>
              ) : (
                <View className="gap-1.5">
                  <View className="flex-row items-center gap-1.5">
                    <Ionicons
                      name={isPublic ? "globe-outline" : "lock-closed-outline"}
                      size={14}
                      color={theme.mutedForeground}
                    />
                    <Text className="text-xs font-medium text-foreground">
                      {isPublic
                        ? t("runtimes.visibility.public")
                        : t("runtimes.visibility.private")}
                    </Text>
                  </View>
                  <Text className="text-xs text-muted-foreground">
                    {t(
                      isPublic
                        ? "runtimes.detail.visibilityReadonly.public"
                        : "runtimes.detail.visibilityReadonly.private",
                    )}
                  </Text>
                </View>
              )}
            </View>

            {/* Rename */}
            {access.canEditRuntime ? (
              <View className="border-t border-border pt-3 gap-1.5">
                {renameOpen ? (
                  <>
                    <TextField
                      value={nameInput}
                      onChangeText={setNameInput}
                      placeholder={t("runtimes.detail.renamePlaceholder")}
                      autoFocus
                      maxLength={80}
                    />
                    <View className="flex-row items-center justify-between gap-3">
                      <Text className="text-xs text-muted-foreground flex-1">
                        {t("runtimes.detail.renameApplyMachine")}
                      </Text>
                      <Switch
                        checked={applyToMachine}
                        onCheckedChange={setApplyToMachine}
                      />
                    </View>
                    <View className="flex-row gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onPress={() => setRenameOpen(false)}
                      >
                        <Text>{t("runtimes.detail.renameCancel")}</Text>
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1"
                        onPress={handleRenameSave}
                        disabled={updateRuntime.isPending}
                      >
                        <Text>{t("runtimes.detail.renameSave")}</Text>
                      </Button>
                    </View>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 justify-start gap-2 px-0"
                    onPress={openRename}
                  >
                    <Ionicons
                      name="pencil-outline"
                      size={14}
                      color={theme.mutedForeground}
                    />
                    <Text className="text-xs text-foreground">
                      {t("runtimes.detail.renameButton")}
                    </Text>
                  </Button>
                )}
              </View>
            ) : null}

            {/* Add custom runtime profile — web's RuntimeProfilesDialog
                detail-page entry (intent=create). */}
            <View className="border-t border-border pt-3">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 justify-start gap-2 px-0"
                onPress={() => setShowProfiles(true)}
              >
                <Ionicons name="add-circle-outline" size={14} color={theme.mutedForeground} />
                <Text className="text-xs text-foreground">
                  {t("runtimes.profiles.addCustom")}
                </Text>
              </Button>
            </View>

            {/* Delete */}
            {access.canDelete ? (
              <View className="border-t border-border pt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 justify-start gap-2 px-0"
                  onPress={handleDeletePress}
                  disabled={deleteRuntime.isPending || unbindDelete.isPending}
                >
                  <Ionicons name="trash-outline" size={14} color={theme.destructive} />
                  <Text className="text-xs text-destructive">
                    {t("runtimes.detail.deleteButton")}
                  </Text>
                </Button>
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </ScrollView>
  );
}