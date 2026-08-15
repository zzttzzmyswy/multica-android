/**
 * Members browse page (push screen reached from the More popover). Mirrors
 * web `packages/views/settings/components/members-tab.tsx` read semantics:
 * one row per workspace member — avatar, name + role badge, email, joined
 * time. Dirty side effects live on the member detail screen; the list is a
 * thin, terminal read surface (like agents).
 *
 * Sort order (matches web's owner-first convention): owner → admin → member;
 * within a tier by name, then joined time (stable). Rows push into the
 * member detail screen keyed by member id.
 */
import { useMemo } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import { Stack, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { MemberRole, MemberWithUser } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { memberListOptions } from "@/data/queries/members";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { useTimeAgo } from "@/lib/time-ago";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

const ROLE_ORDER: Record<MemberRole, number> = { owner: 0, admin: 1, member: 2 };

const ROLE_BADGE: Record<MemberRole, string> = {
  owner: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  admin: "bg-brand/10 text-brand",
  member: "bg-muted text-muted-foreground",
};

export default function MembersPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;

  const { data, isLoading, error, refetch, isRefetching } = useQuery(
    memberListOptions(wsId),
  );

  const sorted = useMemo(() => {
    const list = data ?? [];
    return [...list].sort((a, b) => {
      const ra = ROLE_ORDER[a.role] ?? 9;
      const rb = ROLE_ORDER[b.role] ?? 9;
      if (ra !== rb) return ra - rb;
      const byName = a.name.localeCompare(b.name);
      if (byName !== 0) return byName;
      return a.created_at.localeCompare(b.created_at);
    });
  }, [data]);

  const showEmpty = !isLoading && !error && (data ?? []).length === 0;

  return (
    <>
      <Stack.Screen options={{ title: t("screen.members") }} />
      <View className="flex-1 bg-background">
        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator />
          </View>
        ) : error ? (
          <View className="px-4 gap-3 pt-4">
            <Text className="text-sm text-destructive">
              {t("members.loadError")}
              {error instanceof Error ? error.message : t("common.unknownError")}
            </Text>
            <Button variant="outline" onPress={() => refetch()}>
              <Text>{t("workspace.retry")}</Text>
            </Button>
          </View>
        ) : showEmpty ? (
          <View className="flex-1 items-center justify-center px-6 gap-1">
            <Ionicons name="people-outline" size={32} color={muted} />
            <Text className="text-sm text-muted-foreground text-center mt-2">
              {t("members.emptyTitle")}
            </Text>
            <Text className="text-xs text-muted-foreground/70 text-center">
              {t("members.emptyDescription")}
            </Text>
          </View>
        ) : (
          <FlatList
            data={sorted}
            keyExtractor={(item) => item.id}
            ItemSeparatorComponent={() => <View className="h-px bg-border ml-4" />}
            contentContainerClassName="pb-6"
            renderItem={({ item }) => (
              <MemberRow
                member={item}
                onPress={() => {
                  if (wsSlug) router.push(`/${wsSlug}/more/members/${item.id}`);
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

function MemberRow({
  member,
  onPress,
}: {
  member: MemberWithUser;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const timeAgo = useTimeAgo();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const joined = member.created_at ? timeAgo(member.created_at) : null;

  return (
    <Pressable onPress={onPress} className="px-4 py-3 active:bg-secondary">
      <View className="flex-row items-center gap-3">
        <ActorAvatar type="member" id={member.user_id} size={40} />
        <View className="flex-1 min-w-0 gap-0.5">
          <View className="flex-row items-center gap-2">
            <Text
              className="flex-1 text-sm font-medium text-foreground"
              numberOfLines={1}
            >
              {member.name}
            </Text>
            <RoleBadge role={member.role} />
          </View>
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {member.email}
          </Text>
          {joined ? (
            <Text className="text-xs text-muted-foreground/70">
              {t("members.joinedAt", { time: joined })}
            </Text>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={14} color={muted} />
      </View>
    </Pressable>
  );
}

function RoleBadge({ role }: { role: MemberRole }) {
  const { t } = useTranslation();
  return (
    <View
      className={cn(
        "px-2 py-0.5 rounded-full border border-border",
        ROLE_BADGE[role],
      )}
    >
      <Text className="text-[11px] font-medium">
        {t(`members.role.${role}`)}
      </Text>
    </View>
  );
}