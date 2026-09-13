/**
 * Machine detail screen (iteration-123). Mirrors web
 * `packages/views/runtimes/components/runtime-detail-page.tsx` — the
 * per-machine page the runtimes list drills into: identity + health +
 * workload header, the machine-wide CLI / daemon-update section
 * (`machine-cli-section.tsx`), machine rename (`rename-machine-dialog.tsx`,
 * always `apply_to_machine`), machine-scoped "add custom runtime"
 * (`runtime-profiles-dialog.tsx` intent=create) and the machine's nested
 * runtime list.
 *
 * Reached by tapping a machine header on the runtimes list. Web routes this at
 * `/runtimes/[machineId]` and accepts a legacy runtime id on the same route;
 * `findMachine` keeps that contract so an old runtime-id link still expands to
 * its machine.
 *
 * The server exposes no `GET /api/runtimes/:id`, so — like the runtime detail
 * screen — this reuses the workspace runtime list query and picks its machine
 * by id. Health is re-derived on a 30s tick so recently_lost → offline stays
 * truthful without new data (web's HEALTH_TICK_MS).
 */
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { deriveRuntimeHealth } from "@multica/core/runtimes";
import type { RuntimeHealth } from "@multica/core/runtimes";
import type { AgentRuntime } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { RuntimeProfilesDialog } from "@/components/runtimes/runtime-profiles-dialog";
import { UpdateSection } from "@/components/runtimes/update-section";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { memberListOptions } from "@/data/queries/members";
import { agentListOptions } from "@/data/queries/agents";
import { agentTaskSnapshotOptions } from "@/data/queries/agent-task-snapshot";
import {
  buildRuntimeMachines,
  buildWorkloadIndex,
  canAddMachineRuntime,
  findMachine,
  machineRenameTarget,
  machineUpdateRuntime,
  runtimeRowLabel,
  type RuntimeMachine,
} from "@/lib/runtime-machines";
import { useUpdateRuntime } from "@/data/mutations/runtimes";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useAuthStore } from "@/data/auth-store";
import { useTimeAgo } from "@/lib/time-ago";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

const MACHINE_ICON: Record<RuntimeMachine["section"], keyof typeof Ionicons.glyphMap> = {
  local: "hardware-chip",
  remote: "laptop-outline",
  cloud: "cloud-outline",
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

export default function MachineDetailPage() {
  const { machineId } = useLocalSearchParams<{ machineId: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
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
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: taskSnapshot = [] } = useQuery(agentTaskSnapshotOptions(wsId));
  const updateRuntime = useUpdateRuntime();

  const [showProfiles, setShowProfiles] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [nameInput, setNameInput] = useState("");

  const machines = useMemo(() => {
    if (data.length === 0) return [];
    return buildRuntimeMachines(data, {
      now,
      currentUserId: user?.id,
      workloadByRuntimeId: buildWorkloadIndex(agents, taskSnapshot),
    });
  }, [data, now, user?.id, agents, taskSnapshot]);

  const machine = useMemo(
    () => (machineId ? findMachine(machines, machineId) : null),
    [machines, machineId],
  );

  // Workspace owner/admin — the same role check the runtimes surfaces use
  // everywhere else (e.g. more/runtimes/[id].tsx).
  const isAdmin =
    !!user?.id &&
    members.some(
      (m) =>
        m.user_id === user.id && (m.role === "owner" || m.role === "admin"),
    );

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (error || !machine) {
    return (
      <>
        <Stack.Screen options={{ title: t("screen.runtimes") }} />
        <View className="flex-1 items-center justify-center bg-background px-6 gap-3">
          <Ionicons name="alert-circle-outline" size={32} color={theme.destructive} />
          <Text className="text-sm font-medium text-foreground text-center">
            {t("runtimes.machine.not_found_title")}
          </Text>
          <Text className="text-xs text-muted-foreground text-center">
            {t("runtimes.machine.not_found_hint")}
          </Text>
          <Button variant="outline" onPress={() => refetch()}>
            <Text>{t("workspace.retry")}</Text>
          </Button>
        </View>
      </>
    );
  }

  const busyCount = machine.runningCount + machine.queuedCount;
  const renameTarget = machineRenameTarget(machine, user?.id ?? null, isAdmin);
  const canAddRuntime = canAddMachineRuntime(machine, isAdmin);
  const updateChannel = machineUpdateRuntime(machine, user?.id, isAdmin);
  const showCliSection =
    machine.mode !== "local" ||
    !!updateChannel ||
    machine.runtimes.length > 0 ||
    !!machine.cliVersion ||
    !!machine.launchedBy;

  const openRename = () => {
    setNameInput(renameTarget?.currentName ?? "");
    setRenameOpen(true);
  };

  const handleRenameSave = () => {
    if (!renameTarget) return;
    const trimmed = nameInput.trim();
    setRenameOpen(false);
    updateRuntime.mutate(
      {
        runtimeId: renameTarget.runtimeId,
        // A machine hosts one runtime per provider, so the name always fans
        // out across the daemon — this dialog only ever names the machine
        // (web rename-machine-dialog.tsx). Empty clears back to the default.
        patch: { custom_name: trimmed, apply_to_machine: true },
      },
      {
        onSuccess: () =>
          Alert.alert(
            trimmed
              ? t("runtimes.machine.rename_dialog.toast_saved")
              : t("runtimes.machine.rename_dialog.toast_cleared"),
          ),
        onError: (err) =>
          Alert.alert(
            t("runtimes.machine.rename_dialog.toast_failed"),
            err instanceof Error ? err.message : t("common.unknownError"),
          ),
      },
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: machine.title }} />
      {showProfiles ? (
        <RuntimeProfilesDialog
          intent="create"
          onClose={() => setShowProfiles(false)}
        />
      ) : null}
      <ScrollView className="flex-1 bg-background" contentContainerClassName="pb-10">
        <View className="px-4 pt-4 gap-1">
          {/* Identity card */}
          <View className="flex-row items-center gap-3">
            <View className="size-10 rounded-xl bg-secondary items-center justify-center mt-0.5">
              <Ionicons
                name={MACHINE_ICON[machine.section]}
                size={20}
                color={theme.mutedForeground}
              />
            </View>
            <View className="flex-1 min-w-0 gap-1">
              <View className="flex-row items-center gap-1.5 flex-wrap">
                <Text className="text-base font-semibold text-foreground">
                  {machine.title}
                </Text>
                <View className="px-1.5 py-px rounded-full bg-secondary">
                  <Text className="text-[10px] text-muted-foreground font-medium">
                    {t(`runtimes.machine.section_${machine.section}`)}
                  </Text>
                </View>
              </View>
              <View className="flex-row items-center gap-1.5">
                <View className={cn("size-2 rounded-full", HEALTH_DOT[machine.health])} />
                <Text className={cn("text-xs font-medium", HEALTH_TONE[machine.health])}>
                  {t(`runtimes.health.${machine.health}`)}
                </Text>
              </View>
            </View>
          </View>

          {machine.subtitle ? (
            <Text className="text-xs text-muted-foreground mt-1" numberOfLines={2}>
              {machine.subtitle}
            </Text>
          ) : null}

          {/* Machine stats — runtime count / workload / last seen, the same
              three the web header prints (runtime-detail-page.tsx:250-271). */}
          <View className="flex-row items-center gap-1.5 flex-wrap mt-1.5">
            <Text className="text-xs text-muted-foreground">
              {t("runtimes.machine.runtime_count", { count: machine.runtimes.length })}
            </Text>
            <Text className="text-xs text-muted-foreground">·</Text>
            <Text className="text-xs text-muted-foreground">
              {busyCount > 0
                ? t("runtimes.machine.metrics.workload_hint", {
                    running: machine.runningCount,
                    queued: machine.queuedCount,
                  })
                : t("runtimes.machine.metrics.workload_idle")}
            </Text>
            {machine.lastSeenAt ? (
              <>
                <Text className="text-xs text-muted-foreground">·</Text>
                <Text className="text-xs text-muted-foreground">
                  {timeAgo(machine.lastSeenAt)}
                </Text>
              </>
            ) : null}
          </View>

          {/* Machine-wide CLI / daemon update (web MachineCliSection). A cloud
              worker has no daemon to update, so it only reports its CLI. */}
          {showCliSection ? (
            <View className="mt-4 rounded-lg border border-border">
              <View className="border-b border-border px-3 py-2">
                <Text className="text-xs font-semibold text-foreground">
                  {t("runtimes.update.section_title")}
                </Text>
              </View>
              <View className="p-3">
                {machine.mode !== "local" ? (
                  <View className="flex-row items-center gap-2">
                    <Ionicons name="cube-outline" size={14} color={theme.mutedForeground} />
                    <Text className="text-xs text-muted-foreground">
                      {t("runtimes.update.cli_version_label")}
                    </Text>
                    <Text className="text-xs font-mono text-foreground">
                      {machine.cliVersion ?? t("runtimes.update.version_unknown")}
                    </Text>
                  </View>
                ) : (
                  <UpdateSection
                    runtimeId={updateChannel?.id ?? null}
                    currentVersion={machine.cliVersion}
                    isOnline={updateChannel?.status === "online"}
                    launchedBy={machine.launchedBy}
                  />
                )}
              </View>
            </View>
          ) : null}

          {/* Machine actions — rename (any editable runtime on the machine is
              a valid command channel) and, on an admin's local machine, a
              machine-scoped custom runtime profile. */}
          {renameTarget || canAddRuntime ? (
            <View className="mt-4 rounded-lg border border-border">
              <View className="border-b border-border px-3 py-2">
                <Text className="text-xs font-semibold text-foreground">
                  {t("runtimes.machine.actions")}
                </Text>
              </View>
              <View className="p-3 gap-3">
                {renameTarget ? (
                  renameOpen ? (
                    <>
                      <TextField
                        value={nameInput}
                        onChangeText={setNameInput}
                        placeholder={t("runtimes.machine.rename_dialog.placeholder")}
                        autoFocus
                        maxLength={100}
                      />
                      <Text className="text-xs text-muted-foreground">
                        {t("runtimes.machine.rename_dialog.hint")}
                      </Text>
                      <View className="flex-row gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1"
                          onPress={() => setRenameOpen(false)}
                        >
                          <Text>{t("runtimes.machine.rename_dialog.cancel")}</Text>
                        </Button>
                        <Button
                          size="sm"
                          className="flex-1"
                          onPress={handleRenameSave}
                          disabled={updateRuntime.isPending}
                        >
                          <Text>
                            {updateRuntime.isPending
                              ? t("runtimes.machine.rename_dialog.saving")
                              : t("runtimes.machine.rename_dialog.save")}
                          </Text>
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
                      <Ionicons name="pencil-outline" size={14} color={theme.mutedForeground} />
                      <Text className="text-xs text-foreground">
                        {t("runtimes.machine.rename")}
                      </Text>
                    </Button>
                  )
                ) : null}

                {canAddRuntime ? (
                  <View
                    className={cn(
                      renameTarget && "border-t border-border pt-3",
                    )}
                  >
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
              </View>
            </View>
          ) : null}

          {/* Runtimes on this machine */}
          <View className="mt-4 gap-1">
            <Text className="text-xs font-semibold text-foreground px-0.5">
              {t("runtimes.machine.metrics.runtimes")}
            </Text>
            <Text className="text-xs text-muted-foreground px-0.5">
              {t("runtimes.machine.select_runtime")}
            </Text>
          </View>

          {machine.runtimes.length > 0 ? (
            <View className="mt-2 rounded-lg border border-border overflow-hidden">
              {machine.runtimes.map((runtime, index) => (
                <View key={runtime.id}>
                  {index > 0 ? <View className="h-px bg-border ml-4" /> : null}
                  <MachineRuntimeRow
                    runtime={runtime}
                    machineTitle={machine.title}
                    now={now}
                    onPress={() => {
                      if (wsSlug) router.push(`/${wsSlug}/more/runtimes/${runtime.id}`);
                    }}
                  />
                </View>
              ))}
            </View>
          ) : (
            <View className="mt-2 rounded-lg border border-dashed border-border px-6 py-10 items-center">
              <Ionicons name="server-outline" size={28} color={theme.mutedForeground} />
              <Text className="text-sm font-medium text-foreground mt-3">
                {t("runtimes.machine.no_runtimes_title")}
              </Text>
              <Text className="text-xs text-muted-foreground text-center mt-1">
                {t("runtimes.machine.no_runtimes_hint")}
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </>
  );
}

/**
 * One runtime on the machine. The label drops a machine-level custom name
 * (shared by every runtime on the daemon) so the row doesn't repeat its
 * machine, and keeps a one-off per-runtime rename visible — web
 * runtimeRowLabel / RuntimeList's Runtime cell.
 */
function MachineRuntimeRow({
  runtime,
  machineTitle,
  now,
  onPress,
}: {
  runtime: AgentRuntime;
  machineTitle: string;
  now: number;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const timeAgo = useTimeAgo();
  const health = deriveRuntimeHealth(runtime, now);
  const displayName = runtimeRowLabel(runtime, machineTitle);

  return (
    <Pressable onPress={onPress} className="px-4 py-3 active:bg-secondary">
      <View className="flex-row items-center gap-3">
        <View className="flex-1 min-w-0 gap-0.5">
          <View className="flex-row items-center gap-1.5 flex-wrap">
            <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
              {displayName}
            </Text>
            <View className="px-1.5 py-px rounded-full bg-secondary">
              <Text className="text-[10px] text-muted-foreground font-medium">
                {runtime.profile_id
                  ? t("runtimes.kind.custom")
                  : t("runtimes.kind.builtin")}
              </Text>
            </View>
          </View>
          <View className="flex-row items-center gap-1.5">
            <View className={cn("size-1.5 rounded-full", HEALTH_DOT[health])} />
            <Text className="text-xs text-muted-foreground">
              {t(`runtimes.health.${health}`)}
              {runtime.provider ? ` · ${runtime.provider}` : ""}
              {health !== "online" && runtime.last_seen_at
                ? ` · ${timeAgo(runtime.last_seen_at)}`
                : ""}
            </Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={14} color={muted} />
      </View>
    </Pressable>
  );
}
