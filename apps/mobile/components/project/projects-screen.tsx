/**
 * Shared projects browser — the list body only (loading / error / empty /
 * rows), no screen chrome. Used by both the "Projects" bottom-tab
 * (`(tabs)/projects.tsx`, which draws its own `<Header>`) and the
 * `more/projects` push screen (native Stack header). The `+` create action
 * is a prop: each host renders it where that route's header lives, so we
 * never double-draw a title bar.
 *
 * Sort: client-side by `updated_at` desc — most recently touched at top.
 * Mirrors web's default list ordering. WS `project:*` events keep the cache
 * fresh via the listing-level realtime hook (`useProjectsRealtime` in
 * `_layout.tsx`), so pull-to-refresh is rarely needed but kept for the
 * cellular-edge case where a WS reconnect missed events.
 */
import { useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { ProjectRow } from "@/components/project/project-row";
import { projectListOptions } from "@/data/queries/projects";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";

export function ProjectsScreen({
  onCreate,
}: {
  /** Called when the "+" header action is pressed. */
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);

  const { data, isLoading, error, refetch, isRefetching } = useQuery(
    projectListOptions(wsId),
  );

  const sorted = useMemo(() => {
    if (!data) return [];
    return [...data].sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );
  }, [data]);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator />
      </View>
    );
  }

  if (error) {
    return (
      <View className="px-4 gap-3 pt-4">
        <Text className="text-sm text-destructive">
          {t("projects.loadFailed")}
          {error instanceof Error ? error.message : t("common.unknownError")}
        </Text>
        <Button variant="outline" onPress={() => refetch()}>
          <Text>{t("common.retry")}</Text>
        </Button>
      </View>
    );
  }

  if (sorted.length === 0) {
    return <EmptyState onCreate={onCreate} t={t} />;
  }

  return (
    <FlatList
      data={sorted}
      keyExtractor={(item) => item.id}
      ItemSeparatorComponent={() => (
        <View className="h-px bg-border ml-4" />
      )}
      renderItem={({ item }) => (
        <ProjectRow
          project={item}
          onPress={() => {
            if (wsSlug) router.push(`/${wsSlug}/project/${item.id}`);
          }}
        />
      )}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
      }
      contentContainerClassName="pb-6"
    />
  );
}

function EmptyState({
  onCreate,
  t,
}: {
  onCreate: () => void;
  t: (id: string) => string;
}) {
  return (
    <View className="flex-1 items-center justify-center px-6 gap-4">
      <Text className="text-base font-medium text-foreground">
        {t("projects.emptyTitle")}
      </Text>
      <Text className="text-sm text-muted-foreground text-center">
        {t("projects.emptyMessage")}
      </Text>
      <Button variant="default" onPress={onCreate}>
        <Text>{t("projects.create")}</Text>
      </Button>
    </View>
  );
}

export function useCreateProject() {
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  return useCallback(() => {
    if (wsSlug) router.push(`/${wsSlug}/project/new`);
  }, [wsSlug]);
}