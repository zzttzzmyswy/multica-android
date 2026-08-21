/**
 * Workspace runtimes browse page (push screen reached from the More popover).
 * Mirrors web `packages/views/runtimes/components/runtimes-page.tsx` machine
 * grouping (iteration-83, A2.4): runtimes are consolidated per machine
 * (daemon / device) into local/remote/cloud sections — each machine header
 * carries the machine title, section badge, health dot, online count and the
 * principal CLI version; the rows under it are the per-provider runtimes (web
 * RowCell semantics on a phone). Pull-to-refresh + friendly
 * empty/loading/error states matching the skills/squads pages.
 *
 * Data comes straight from `GET /api/runtimes` (api.listRuntimes) — there is
 * no single-runtime detail endpoint (server router has no GET
 * /api/runtimes/:id), so the detail screen reuses this same list query and
 * picks its row by id.
 */
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, SectionList, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { deriveRuntimeHealth } from "@multica/core/runtimes";
import type { RuntimeHealth } from "@multica/core/runtimes";
import type { AgentRuntime } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { agentListOptions } from "@/data/queries/agents";
import { agentTaskSnapshotOptions } from "@/data/queries/agent-task-snapshot";
import {
  buildRuntimeMachines,
  buildWorkloadIndex,
  runtimeRowLabel,
  type RuntimeMachine,
} from "@/lib/runtime-machines";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useAuthStore } from "@/data/auth-store";
import { ConnectRemoteDialog } from "@/components/runtimes/connect-remote-dialog";
import { CloudRuntimeDialog } from "@/components/runtimes/cloud-runtime-dialog";
import { RuntimeProfilesDialog } from "@/components/runtimes/runtime-profiles-dialog";
import { ActionSheet } from "@/lib/action-sheet";
import { useTimeAgo } from "@/lib/time-ago";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

const MODE_ICON: Record<AgentRuntime["runtime_mode"], keyof typeof Ionicons.glyphMap> = {
  local: "hardware-chip",
  cloud: "cloud",
};

const MACHINE_ICON: Record<RuntimeMachine["section"], keyof typeof Ionicons.glyphMap> = {
  local: "hardware-chip",
  remote: "laptop-outline",
  cloud: "cloud-outline",
};

// Mirrors web HealthCell/HealthIcon tint mapping
// (packages/views/runtimes/components/shared.tsx): online → success,
// recently_lost → warning (5-min window), offline → muted, about_to_gc →
// destructive (sweeper is coming).
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

export default function RuntimesPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const user = useAuthStore((s) => s.user);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;

  // Runtime-supply entrypoints (iteration-82, A2): connect-remote / cloud
  // runtime / custom profiles — web renders these as page-header actions, a
  // phone fits them behind the "+" header action.
  const [showConnect, setShowConnect] = useState(false);
  const [showCloud, setShowCloud] = useState(false);
  const [showProfiles, setShowProfiles] = useState(false);
  const [profilesIntent, setProfilesIntent] = useState<"manage" | "create">("manage");

  const openSupplySheet = useCallback(() => {
    const options = [
      t("runtimes.actions.connect"),
      t("runtimes.actions.cloudRuntime"),
      t("runtimes.actions.profiles"),
      t("common.cancel"),
    ];
    const cancelIndex = options.length - 1;
    ActionSheet.showActionSheetWithOptions(
      { options, cancelButtonIndex: cancelIndex },
      (index) => {
        if (index === cancelIndex || index < 0) return;
        if (index === 0) setShowConnect(true);
        else if (index === 1) setShowCloud(true);
        else {
          setProfilesIntent("manage");
          setShowProfiles(true);
        }
      },
    );
  }, [t]);

  const headerRight = useCallback(() => {
    return (
      <IconButton
        name="add"
        onPress={openSupplySheet}
        accessibilityLabel={t("runtimes.actions.connect")}
      />
    );
  }, [openSupplySheet, t]);

  const { data, isLoading, error, refetch, isRefetching } = useQuery(
    runtimeListOptions(wsId),
  );
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: taskSnapshot = [] } = useQuery(agentTaskSnapshotOptions(wsId));

  const runtimes = useMemo(() => data ?? [], [data]);

  const machines = useMemo(() => {
    if (runtimes.length === 0) return [];
    const workload = buildWorkloadIndex(agents, taskSnapshot);
    return buildRuntimeMachines(runtimes, {
      now: Date.now(),
      currentUserId: user?.id,
      workloadByRuntimeId: workload,
    });
  }, [runtimes, agents, taskSnapshot, user?.id]);

  // Grouped sections for SectionList — one section per machine, its runtimes
  // as the rows underneath.
  const sections = useMemo(
    () => machines.map((machine) => ({ key: machine.id, machine, data: machine.runtimes })),
    [machines],
  );

  const showEmpty = !isLoading && !error && runtimes.length === 0;

  return (
    <>
      <Stack.Screen options={{ headerBackTitle: t("common.back"), headerRight }} />
      {showConnect ? (
        <ConnectRemoteDialog onClose={() => setShowConnect(false)} />
      ) : null}
      {showCloud ? (
        <CloudRuntimeDialog onClose={() => setShowCloud(false)} />
      ) : null}
      {showProfiles ? (
        <RuntimeProfilesDialog
          intent={profilesIntent}
          onClose={() => setShowProfiles(false)}
        />
      ) : null}
      <View className="flex-1 bg-background">
        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator />
          </View>
        ) : error ? (
          <View className="px-4 gap-3 pt-4">
            <Text className="text-sm text-destructive">
              {t("runtimes.loadError")}
              {error instanceof Error ? error.message : t("common.unknownError")}
            </Text>
            <Button variant="outline" onPress={() => refetch()}>
              <Text>{t("workspace.retry")}</Text>
            </Button>
          </View>
        ) : showEmpty ? (
          <View className="flex-1 items-center justify-center px-6 gap-1">
            <Ionicons name="server-outline" size={32} color={muted} />
            <Text className="text-sm text-muted-foreground text-center mt-2">
              {t("runtimes.emptyTitle")}
            </Text>
            <Text className="text-xs text-muted-foreground/70 text-center">
              {t("runtimes.emptyDescription")}
            </Text>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onPress={() => setShowConnect(true)}
            >
              <Ionicons name="add" size={14} color={muted} />
              <Text>{t("runtimes.actions.connect")}</Text>
            </Button>
          </View>
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id}
            renderSectionHeader={({ section }) => (
              <MachineHeader
                machine={section.machine}
                onPress={() => {
                  if (wsSlug && section.machine.runtimes.length === 1) {
                    router.push(
                      `/${wsSlug}/more/runtimes/${section.machine.runtimes[0]!.id}`,
                    );
                  }
                }}
              />
            )}
            renderItem={({ section, item }) => (
              <RuntimeRow
                runtime={item}
                machineTitle={section.machine.title}
                onPress={() => {
                  if (wsSlug) router.push(`/${wsSlug}/more/runtimes/${item.id}`);
                }}
              />
            )}
            ItemSeparatorComponent={() => <View className="h-px bg-border ml-4" />}
            contentContainerClassName="pb-6"
            refreshing={isRefetching}
            onRefresh={refetch}
          />
        )}
      </View>
    </>
  );
}

/**
 * Machine header — the consolidation unit web's machine-grouped list renders.
 * Carries the machine title, section badge (Local / Remote / Cloud), health
 * dot + label, online count, running/queued workload and the principal CLI
 * version of the machine's daemon.
 */
function MachineHeader({
  machine,
  onPress,
}: {
  machine: RuntimeMachine;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const timeAgo = useTimeAgo();

  const stats = useMemo(() => {
    const parts: string[] = [];
    if (machine.onlineCount > 0) {
      parts.push(t("runtimes.machine.metrics.runtimes_hint", { count: machine.onlineCount }));
    }
    if (machine.runningCount > 0 || machine.queuedCount > 0) {
      parts.push(
        t("runtimes.machine.metrics.workload_hint", {
          running: machine.runningCount,
          queued: machine.queuedCount,
        }),
      );
    } else if (machine.runtimes.length > 0) {
      parts.push(t("runtimes.machine.metrics.workload_idle"));
    }
    if (machine.health !== "online" && machine.lastSeenAt) {
      parts.push(timeAgo(machine.lastSeenAt));
    }
    return parts.join(" · ");
  }, [machine, t, timeAgo]);

  return (
    <View className="px-4 pt-4 pb-1.5">
      <Pressable onPress={onPress} disabled={machine.runtimes.length !== 1}>
        <View className="flex-row items-center gap-3">
          <View className="size-8 rounded-lg bg-secondary items-center justify-center">
            <Ionicons
              name={MACHINE_ICON[machine.section]}
              size={16}
              color={muted}
            />
          </View>
          <View className="flex-1 min-w-0 gap-1">
            <View className="flex-row items-center gap-1.5 flex-wrap">
              <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
                {machine.title}
              </Text>
              <View className="px-1.5 py-px rounded-full bg-secondary">
                <Text className="text-[10px] text-muted-foreground font-medium">
                  {t(`runtimes.machine.section_${machine.section}`)}
                </Text>
              </View>
              {machine.runtimes.length === 1 &&
              machine.runtimes[0]!.visibility === "public" ? (
                <View className="px-1.5 py-px rounded-full bg-info/10">
                  <Text className="text-[10px] text-info font-medium">
                    {t("runtimes.visibility.public")}
                  </Text>
                </View>
              ) : null}
            </View>
            <View className="flex-row items-center gap-1.5">
              <View className={cn("size-1.5 rounded-full", HEALTH_DOT[machine.health])} />
              <Text className={cn("text-xs", HEALTH_TONE[machine.health])} numberOfLines={1}>
                {t(`runtimes.health.${machine.health}`)}
                {stats ? ` · ${stats}` : ""}
              </Text>
            </View>
          </View>
          {machine.cliVersion ? (
            <View className="px-1.5 py-px rounded bg-secondary shrink-0">
              <Text className="text-[10px] text-muted-foreground font-mono">
                CLI {machine.cliVersion}
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

function RuntimeRow({
  runtime,
  machineTitle,
  onPress,
}: {
  runtime: AgentRuntime;
  machineTitle: string;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const timeAgo = useTimeAgo();
  const health = deriveRuntimeHealth(runtime, Date.now());
  const isCustom = !!runtime.profile_id;
  const displayName = runtimeRowLabel(runtime, machineTitle);
  // Pair the dot colour with a filled badge tone, same split as web's
  // HealthCell (colored dot + caption label underneath).
  return (
    <Pressable onPress={onPress} className="px-4 py-3 active:bg-secondary">
      <View className="flex-row items-center gap-3">
        <View className="size-8 rounded-lg bg-secondary items-center justify-center">
          <Ionicons
            name={MODE_ICON[runtime.runtime_mode] ?? "server"}
            size={16}
            color={muted}
          />
        </View>
        <View className="flex-1 min-w-0 gap-0.5">
          <View className="flex-row items-center gap-1.5 flex-wrap">
            <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
              {displayName}
            </Text>
            {/* Built-in vs Custom profile — profile_id is the discriminator. */}
            <View className="px-1.5 py-px rounded-full bg-secondary">
              <Text className="text-[10px] text-muted-foreground font-medium">
                {isCustom ? t("runtimes.kind.custom") : t("runtimes.kind.builtin")}
              </Text>
            </View>
            {/* Only public earns a badge — private is the default. */}
            {runtime.visibility === "public" ? (
              <View className="px-1.5 py-px rounded-full bg-info/10">
                <Text className="text-[10px] text-info font-medium">
                  {t("runtimes.visibility.public")}
                </Text>
              </View>
            ) : null}
          </View>
          <View className="flex-row items-center gap-1.5">
            <View
              className={cn(
                "size-1.5 rounded-full",
                HEALTH_DOT[health],
              )}
            />
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