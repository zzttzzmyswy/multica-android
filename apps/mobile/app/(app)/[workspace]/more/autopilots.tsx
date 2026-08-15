/**
 * Autopilots browse page (push screen reached from the More popover).
 * Mirrors web `packages/views/autopilots/components/autopilots-page.tsx`:
 * one row per autopilot — name, status (active/paused/archived pill),
 * trigger kind(s), and next-run time when scheduled. Pull-to-refresh +
 * friendly empty state. Tapping a row pushes the detail page.
 *
 * Divergence from web (intentional, mobile form factor): web renders
 * assignee / created-by / mode columns; mobile collapses those into the
 * detail page so the list reads as a phone card list. The status pill and
 * trigger-kinds rendering match web's semantics (server-driven enums, any
 * unknown value degrades to a neutral fallback, never a crash).
 */
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Autopilot } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { autopilotListOptions } from "@/data/queries/autopilots";
import { useWorkspaceStore } from "@/data/workspace-store";
import { formatDateTime } from "@/lib/autopilot-format";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

// Server-driven enum: unknown statuses degrade to the neutral pill (the
// backend is the gate; a future value must not collapse the list).
const STATUS_PILL: Record<string, { label: string; className: string }> = {
  active: {
    label: "autopilots.status.active",
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  paused: {
    label: "autopilots.status.paused",
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  archived: {
    label: "autopilots.status.archived",
    className: "bg-muted text-muted-foreground",
  },
};

function statusPill(status: string | undefined) {
  return (status && STATUS_PILL[status]) || {
    label: status ?? "",
    className: "bg-muted text-muted-foreground",
  };
}

// Trigger glyph per kind — mirrors web TRIGGER_ICONS. Unknown kinds get the
// generic flash.
const TRIGGER_ICONS: Record<
  string,
  React.ComponentProps<typeof Ionicons>["name"]
> = {
  schedule: "calendar-outline",
  webhook: "link-outline",
  api: "code-slash-outline",
};

function triggerLabel(kind: string, t: (id: string) => string): string | null {
  if (kind === "schedule" || kind === "webhook" || kind === "api") {
    return t(`autopilots.triggerKind.${kind}`);
  }
  return kind;
}

export default function AutopilotsPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;

  const { data, isLoading, error, refetch, isRefetching } = useQuery(
    autopilotListOptions(wsId),
  );
  const autopilots = data ?? [];

  const showEmpty = !isLoading && !error && autopilots.length === 0;

  return (
    <View className="flex-1 bg-background">
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : error ? (
        <View className="px-4 gap-3 pt-4">
          <Text className="text-sm text-destructive">
            {t("autopilots.loadError")}
            {error instanceof Error ? error.message : t("common.unknownError")}
          </Text>
          <Button variant="outline" onPress={() => refetch()}>
            <Text>{t("workspace.retry")}</Text>
          </Button>
        </View>
      ) : showEmpty ? (
        <View className="flex-1 items-center justify-center px-6 gap-1">
          <Ionicons name="flash-off-outline" size={32} color={muted} />
          <Text className="text-sm text-muted-foreground text-center mt-2">
            {t("autopilots.empty")}
          </Text>
          <Text className="text-xs text-muted-foreground/70 text-center">
            {t("autopilots.emptyHint")}
          </Text>
        </View>
      ) : (
        <FlatList
          data={autopilots}
          keyExtractor={(item) => item.id}
          ItemSeparatorComponent={() => <View className="h-px bg-border ml-4" />}
          contentContainerClassName="pb-6"
          renderItem={({ item }) => (
            <AutopilotRow
              autopilot={item}
              onPress={() => {
                if (wsSlug)
                  router.push(`/${wsSlug}/more/autopilots/${item.id}`);
              }}
            />
          )}
          refreshing={isRefetching}
          onRefresh={refetch}
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center px-6 py-10">
              <Text className="text-sm text-muted-foreground text-center">
                {t("autopilots.empty")}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

function AutopilotRow({
  autopilot,
  onPress,
}: {
  autopilot: Autopilot;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const pill = statusPill(autopilot.status);
  const kinds = autopilot.trigger_kinds ?? [];

  return (
    <Pressable onPress={onPress} className="active:bg-secondary px-4 py-3">
      <View className="flex-row items-center gap-2">
        <Ionicons name="flash" size={16} color={muted} />
        <Text
          className="flex-1 text-sm font-medium text-foreground"
          numberOfLines={1}
        >
          {autopilot.title}
        </Text>
        <View
          className={cn(
            "px-2 py-0.5 rounded-full border border-border",
            pill.className,
          )}
        >
          <Text className="text-[11px] font-medium">
            {pill.label.startsWith("autopilots.") ? t(pill.label) : pill.label}
          </Text>
        </View>
      </View>
      <View className="flex-row items-center gap-2 mt-1.5 ml-6">
        {kinds.length === 0 ? (
          <Text className="text-xs text-muted-foreground/60">—</Text>
        ) : (
          kinds.map((kind) => {
            const label = triggerLabel(kind, t);
            return (
              <View key={kind} className="flex-row items-center gap-1">
                <Ionicons
                  name={TRIGGER_ICONS[kind] ?? "flash-outline"}
                  size={12}
                  color={muted}
                />
                <Text className="text-xs text-muted-foreground">
                  {label ?? kind}
                </Text>
              </View>
            );
          })
        )}
        {autopilot.next_run_at ? (
          <View className="flex-row items-center gap-1">
            <Ionicons name="time-outline" size={12} color={muted} />
            <Text className="text-xs text-muted-foreground tabular-nums">
              {formatDateTime(autopilot.next_run_at)}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}