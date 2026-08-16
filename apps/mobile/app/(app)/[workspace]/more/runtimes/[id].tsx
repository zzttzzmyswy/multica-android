/**
 * Runtime detail screen (read-only). Reached from the runtimes list row.
 * Mirrors web `packages/views/runtimes/components/runtime-detail.tsx` read
 * semantics on a phone: identity card (icon + display name + kind badge +
 * derived health) over a meta sheet of the server fields the workspace sees.
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
import { ActivityIndicator, ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { deriveRuntimeHealth, runtimeDisplayLabel } from "@multica/core/runtimes";
import type { RuntimeHealth } from "@multica/core/runtimes";
import type { AgentRuntime } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTimeAgo } from "@/lib/time-ago";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

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
  const runtime = useMemo(
    () => (id ? data.find((r) => r.id === id) : undefined),
    [data, id],
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

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="pb-10">
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
                {runtimeDisplayLabel(runtime)}
              </Text>
              <View className="px-1.5 py-px rounded-full bg-secondary">
                <Text className="text-[10px] text-muted-foreground font-medium">
                  {isCustom ? t("runtimes.kind.custom") : t("runtimes.kind.builtin")}
                </Text>
              </View>
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
      </View>
    </ScrollView>
  );
}