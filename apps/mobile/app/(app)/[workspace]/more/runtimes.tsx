/**
 * Workspace runtimes browse page (push screen reached from the More popover).
 * Mirrors web `packages/views/runtimes/components/runtime-list.tsx` read
 * semantics, card-listed for the phone like the skills page: each row shows
 * the display name (custom override wins), a kind badge (Built-in vs Custom
 * profile), a Public visibility badge when the runtime is shared, and a
 * health line — availability dot + derived health label + provider/mode +
 * relative last-seen for offline rows.
 *
 * Data comes straight from `GET /api/runtimes` (api.listRuntimes) — there is
 * no single-runtime detail endpoint (server router has no GET
 * /api/runtimes/:id), so the detail screen reuses this same list query and
 * picks its row by id. Pull-to-refresh + friendly empty/loading/error states
 * matching the skills/squads pages.
 */
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { deriveRuntimeHealth, runtimeDisplayLabel } from "@multica/core/runtimes";
import type { RuntimeHealth } from "@multica/core/runtimes";
import type { AgentRuntime } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { useWorkspaceStore } from "@/data/workspace-store";
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

export default function RuntimesPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
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

  // Web keeps server order (listViewQuery updater matches client order); the
  // backend returns online-first, then by last_seen desc. Preserve it — no
  // re-sort is the most truthful read of what the workspace sees.
  const runtimes = useMemo(() => data ?? [], [data]);

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
          <FlatList
            data={runtimes}
            keyExtractor={(item) => item.id}
            ItemSeparatorComponent={() => <View className="h-px bg-border ml-4" />}
            contentContainerClassName="pb-6"
            renderItem={({ item }) => (
              <RuntimeRow
                runtime={item}
                onPress={() => {
                  if (wsSlug) router.push(`/${wsSlug}/more/runtimes/${item.id}`);
                }}
              />
            )}
            refreshing={isRefetching}
            onRefresh={refetch}
          />
        )}
      </View>
    </>
  );
}

function RuntimeRow({
  runtime,
  onPress,
}: {
  runtime: AgentRuntime;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const timeAgo = useTimeAgo();
  const health = deriveRuntimeHealth(runtime, Date.now());
  const isCustom = !!runtime.profile_id;
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
              {runtimeDisplayLabel(runtime)}
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