/**
 * Workspace skills browse page (push screen reached from the More popover).
 * Mirrors web `packages/views/skills/components/skills-page.tsx` read
 * semantics, card-listed for the phone like the labels page: each row shows
 * name, description, the provenance badge (readOrigin), the relative
 * updated time, and a small edit affordance when the current user may edit
 * the skill (workspace admin/owner, or its creator — canEditSkill).
 *
 * Default order is web's view-store default: `updated` descending. Pull-to-
 * refresh + friendly empty/loading/error states matching the squads/labels
 * pages. The "+" header action opens the create form.
 */
import { useCallback, useMemo } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { SkillSummary } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { skillListOptions } from "@/data/queries/skills";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useAuthStore } from "@/data/auth-store";
import { canEditSkill, ORIGIN_LABEL_KEY, readOrigin } from "@/lib/skill-guards";
import { useSkillRole } from "@/lib/use-skill-role";
import { useTimeAgo } from "@/lib/time-ago";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

export default function SkillsPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const role = useSkillRole(wsId);
  const userId = useAuthStore((s) => s.user?.id);

  const { data, isLoading, error, refetch, isRefetching } = useQuery(
    skillListOptions(wsId),
  );

  const showEmpty = !isLoading && !error && (data ?? []).length === 0;

  const sorted = useMemo(() => {
    const list = data ?? [];
    // Web's view-store default: updated → desc. Preserve stable order for
    // equal timestamps (empty/equal strings fall back to insertion index).
    return [...list].sort(
      (a, b) => b.updated_at.localeCompare(a.updated_at) || 0,
    );
  }, [data]);

  const headerRight = useCallback(() => {
    if (!wsSlug) return null;
    return (
      <IconButton
        name="add"
        onPress={() => router.push(`/${wsSlug}/more/skills/new`)}
        accessibilityLabel={t("skills.createButton")}
      />
    );
  }, [wsSlug, t]);

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
              {t("skills.loadError")}
              {error instanceof Error ? error.message : t("common.unknownError")}
            </Text>
            <Button variant="outline" onPress={() => refetch()}>
              <Text>{t("workspace.retry")}</Text>
            </Button>
          </View>
        ) : showEmpty ? (
          <View className="flex-1 items-center justify-center px-6 gap-1">
            <Ionicons name="extension-puzzle-outline" size={32} color={muted} />
            <Text className="text-sm text-muted-foreground text-center mt-2">
              {t("skills.emptyTitle")}
            </Text>
            <Text className="text-xs text-muted-foreground/70 text-center">
              {t("skills.emptyDescription")}
            </Text>
            {wsSlug ? (
              <Button
                variant="outline"
                className="mt-3"
                onPress={() => router.push(`/${wsSlug}/more/skills/new`)}
              >
                <Ionicons name="add" size={15} color={muted} />
                <Text>{t("skills.createButton")}</Text>
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
              <SkillRow
                skill={item}
                canEdit={canEditSkill(item, { userId, role })}
                onPress={() => {
                  if (wsSlug) router.push(`/${wsSlug}/more/skills/${item.id}`);
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

function SkillRow({
  skill,
  canEdit,
  onPress,
}: {
  skill: SkillSummary;
  canEdit: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const timeAgo = useTimeAgo();
  const origin = ORIGIN_LABEL_KEY[readOrigin(skill).type];

  return (
    <Pressable onPress={onPress} className="px-4 py-3 active:bg-secondary">
      <View className="flex-row items-center gap-3">
        <View className="size-8 rounded-lg bg-secondary items-center justify-center">
          <Ionicons name="extension-puzzle" size={16} color={muted} />
        </View>
        <View className="flex-1 min-w-0 gap-0.5">
          <View className="flex-row items-center gap-1.5">
            <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
              {skill.name}
            </Text>
            <View className="px-1.5 py-px rounded-full bg-secondary">
              <Text className="text-[10px] text-muted-foreground font-medium">
                {t(origin)}
              </Text>
            </View>
            {canEdit ? (
              <Ionicons name="pencil" size={11} color={muted} />
            ) : null}
          </View>
          {skill.description ? (
            <Text
              className="text-xs text-muted-foreground/70"
              numberOfLines={1}
            >
              {skill.description}
            </Text>
          ) : null}
          {skill.updated_at ? (
            <Text className="text-[11px] text-muted-foreground/60">
              {t("skills.detail.updatedAt")} {timeAgo(skill.updated_at)}
            </Text>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={14} color={muted} />
      </View>
    </Pressable>
  );
}