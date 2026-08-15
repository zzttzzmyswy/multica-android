/**
 * Squads browse page (push screen reached from the More popover). Mirrors
 * web `packages/views/squads/components/squads-page.tsx` read semantics,
 * card-listed for the phone: one row per squad — name, leader agent, member
 * count. Archived squads render dimmed and sort last. Pull-to-refresh +
 * friendly empty state. Tapping a row pushes the squad detail page.
 *
 * The header "+" (create) only shows for workspace owner/admin — matching
 * the iteration-27 scope; the server remains the real gate for who may
 * create (any member may create server-side, but mobile keeps the surface
 * admin-facing per MYS-304).
 */
import { useCallback, useMemo } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Squad } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { squadListOptions } from "@/data/queries/squads";
import { memberListOptions } from "@/data/queries/members";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useAuthStore } from "@/data/auth-store";
import { useActorLookup } from "@/data/use-actor-name";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

function isArchived(squad: Squad): boolean {
  return !!squad.archived_at;
}

export default function SquadsPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const user = useAuthStore((s) => s.user);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const { getName } = useActorLookup();

  const { data, isLoading, error, refetch, isRefetching } = useQuery(
    squadListOptions(wsId),
  );
  const members = useQuery(memberListOptions(wsId));
  const currentMember = members.data?.find((m) => m.user_id === user?.id);
  const isAdmin =
    currentMember?.role === "owner" || currentMember?.role === "admin";

  const sorted = useMemo(() => {
    const list = data ?? [];
    return [...list].sort((a, b) => {
      const aArchived = isArchived(a);
      const bArchived = isArchived(b);
      if (aArchived !== bArchived) return aArchived ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  }, [data]);

  const showEmpty = !isLoading && !error && (data ?? []).length === 0;

  const headerRight = useCallback(() => {
    if (!wsSlug || !isAdmin) return null;
    return (
      <IconButton
        name="add"
        onPress={() => router.push(`/${wsSlug}/more/squads/new`)}
        accessibilityLabel={t("squads.new.title")}
      />
    );
  }, [wsSlug, isAdmin, t]);

  return (
    <>
      <Stack.Screen options={{ headerRight }} />
      <View className="flex-1 bg-background">
        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator />
          </View>
        ) : error ? (
          <View className="px-4 gap-3 pt-4">
            <Text className="text-sm text-destructive">
              {t("squads.loadError")}
              {error instanceof Error ? error.message : t("common.unknownError")}
            </Text>
            <Button variant="outline" onPress={() => refetch()}>
              <Text>{t("workspace.retry")}</Text>
            </Button>
          </View>
        ) : showEmpty ? (
          <View className="flex-1 items-center justify-center px-6 gap-1">
            <Ionicons name="people-circle-outline" size={32} color={muted} />
            <Text className="text-sm text-muted-foreground text-center mt-2">
              {t("squads.emptyTitle")}
            </Text>
            <Text className="text-xs text-muted-foreground/70 text-center">
              {t("squads.emptyDescription")}
            </Text>
            {isAdmin && wsSlug ? (
              <Button
                variant="outline"
                className="mt-3"
                onPress={() => router.push(`/${wsSlug}/more/squads/new`)}
              >
                <Ionicons name="add" size={15} color={muted} />
                <Text>{t("squads.createButton")}</Text>
              </Button>
            ) : null}
          </View>
        ) : (
          <FlatList
            data={sorted}
            keyExtractor={(item) => item.id}
            ItemSeparatorComponent={() => <View className="h-px bg-border ml-4" />}
            contentContainerClassName="pb-6"
            renderItem={({ item }) => (
              <SquadRow
                squad={item}
                leaderName={getName("agent", item.leader_id)}
                onPress={() => {
                  if (wsSlug) router.push(`/${wsSlug}/more/squads/${item.id}`);
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

function SquadRow({
  squad,
  leaderName,
  onPress,
}: {
  squad: Squad;
  leaderName: string;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const archived = isArchived(squad);
  const count =
    squad.member_count ?? squad.member_preview?.length ?? 0;

  return (
    <Pressable onPress={onPress} className="px-4 py-3 active:bg-secondary">
      <View className={cn("flex-row items-center gap-3", archived && "opacity-60")}>
        <ActorAvatar type="squad" id={squad.id} size={40} />
        <View className="flex-1 min-w-0 gap-0.5">
          <View className="flex-row items-center gap-2">
            <Text
              className="flex-1 text-sm font-medium text-foreground"
              numberOfLines={1}
            >
              {squad.name}
            </Text>
            {archived ? (
              <View className="px-2 py-0.5 rounded-full border border-border bg-muted text-muted-foreground">
                <Text className="text-[11px] text-muted-foreground font-medium">
                  {t("squads.archived")}
                </Text>
              </View>
            ) : null}
          </View>
          <View className="flex-row items-center gap-1.5">
            <Ionicons name="medal-outline" size={12} color={muted} />
            <Text className="text-xs text-muted-foreground" numberOfLines={1}>
              {leaderName}
            </Text>
          </View>
          <Text className="text-xs text-muted-foreground/70">
            {t("squads.memberCount", { count })}
          </Text>
        </View>
        {!archived ? (
          <Ionicons name="chevron-forward" size={14} color={muted} />
        ) : null}
      </View>
    </Pressable>
  );
}