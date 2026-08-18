/**
 * Project detail screen. Collapsible header + full issue workbench:
 *
 *   Header card (icon + title + description, tap → edit)
 *   Properties section (Status / Priority / Lead — tap chip → picker)
 *   Resources section (read-only by default, "Add" button → resource form)
 *   ── ProjectIssueSurface (iteration-68) ──
 *   Scope tabs (all/members/agents), saved-view bar, list ⇄ board toggle,
 *   filter/sort/grouping, batch multi-select — the meta block above becomes
 *   the list header in list mode (scrolls with content) and stays pinned
 *   above the board in board mode. Replaces the old read-only
 *   ProjectRelatedIssues list.
 *
 * Per-record realtime: `useProjectRealtime(id, onDeleted=back)` subscribes
 * to `project:updated` (full replace) and `project:deleted` (pop back).
 *
 * Right-top "…" menu (ActionSheetIOS) → Edit / Delete. Delete asks for
 * confirmation via `Alert.alert` per iOS HIG (destructive actions need
 * a second tap).
 */
import { useCallback } from "react";
import { ActivityIndicator, Alert, Linking, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { ProjectHeaderCard } from "@/components/project/project-header-card";
import { ProjectPropertiesSection } from "@/components/project/project-properties-section";
import { ProjectIssueSurface } from "@/components/project/project-issue-surface";
import { ProjectResourcesSection } from "@/components/project/project-resources-section";
import {
  projectDetailOptions,
  projectResourcesOptions,
} from "@/data/queries/projects";
import { useDeleteProject } from "@/data/mutations/projects";
import { pinListOptions } from "@/data/queries/pins";
import { useCreatePin, useDeletePin } from "@/data/mutations/pins";
import { useAuthStore } from "@/data/auth-store";
import { useProjectRealtime } from "@/data/realtime/use-project-realtime";
import { useWorkspaceStore } from "@/data/workspace-store";
import { getWebBaseUrl } from "@/data/server-config";
import { ActionSheet } from "@/lib/action-sheet";
import { useTranslation } from "@/lib/i18n/react";

export default function ProjectDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { t } = useTranslation();
  const qc = useQueryClient();

  const detail = useQuery(projectDetailOptions(wsId, id));
  const deleteProject = useDeleteProject(id);

  // Per-record realtime — when another client deletes the project we're
  // viewing, pop back so the user isn't stranded on a 404.
  useProjectRealtime(id, () => router.back());

  // Pull-to-refresh for the issue surface: refresh the detail + resources
  // caches down here (the surface refreshes its own issues query).
  const onRefreshMeta = useCallback(async () => {
    await Promise.all([
      detail.refetch(),
      qc.invalidateQueries({
        queryKey: projectResourcesOptions(wsId, id).queryKey,
      }),
    ]);
  }, [detail, qc, wsId, id]);

  const project = detail.data;

  // EMPTY_PROJECT carries an empty id — parseWithFallback returned the
  // fallback because the response shape drifted. Treat as "not found".
  const projectMissing = !project || project.id === "";

  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { data: pins } = useQuery(pinListOptions(wsId, userId));
  const isPinned =
    !!project &&
    !!pins?.some(
      (p) => p.item_type === "project" && p.item_id === project.id,
    );
  const createPin = useCreatePin();
  const deletePin = useDeletePin();

  const onPressMore = () => {
    if (!project) return;
    const wsUrl = getWebBaseUrl();
    type ActionEntry = { kind: string; label: string };
    const actions: ActionEntry[] = [
      { kind: "cancel", label: t("issue.cancel") },
      {
        kind: isPinned ? "unpin" : "pin",
        label: isPinned ? t("issue.unpin") : t("issue.pin"),
      },
      { kind: "edit", label: t("issue.editDetails") },
      ...(wsUrl ? [{ kind: "openWeb", label: t("issue.openWeb") }] : []),
      { kind: "delete", label: t("issue.deleteIssue") },
    ];
    const destructiveIndex = actions.length - 1;
    ActionSheet.showActionSheetWithOptions(
      {
        options: actions.map((a) => a.label),
        cancelButtonIndex: 0,
        destructiveButtonIndex: destructiveIndex,
      },
      (i) => {
        const kind = actions[i]?.kind;
        if (kind === "pin") {
          createPin.mutate({ item_type: "project", item_id: project.id });
          return;
        }
        if (kind === "unpin") {
          deletePin.mutate({ itemType: "project", itemId: project.id });
          return;
        }
        if (kind === "edit") {
          if (wsSlug) router.push(`/${wsSlug}/project/${id}/edit`);
          return;
        }
        if (kind === "openWeb" && wsUrl) {
          Linking.openURL(`${wsUrl}/${wsSlug}/projects/${id}`);
          return;
        }
        if (i === destructiveIndex) {
          onDelete();
        }
      },
    );
  };

  const onDelete = () => {
    Alert.alert(
      t("project.deleteTitle"),
      t("project.deleteMessage"),
      [
        { text: t("issue.cancel"), style: "cancel" },
        {
          text: t("issue.delete"),
          style: "destructive",
          onPress: () => {
            deleteProject.mutate(undefined, {
              onSuccess: () => router.back(),
            });
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen
        options={{
          title: project?.title || t("screen.project"),
          headerBackTitle: t("common.back"),
          headerRight: project
            ? () => (
                <IconButton
                  name="ellipsis-horizontal"
                  onPress={onPressMore}
                  accessibilityLabel={t("project.actions")}
                />
              )
            : undefined,
        }}
      />
      {detail.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : detail.error || projectMissing ? (
        <View className="flex-1 items-center justify-center px-6 gap-3">
          <Text className="text-sm text-destructive text-center">
            {t("project.loadError")}
            {detail.error instanceof Error
              ? detail.error.message
              : t("project.notFound")}
          </Text>
          <Button variant="outline" onPress={() => detail.refetch()}>
            <Text>{t("issue.retry")}</Text>
          </Button>
        </View>
      ) : (
        <View className="flex-1">
          <ProjectIssueSurface
            projectId={id}
            onRefreshMeta={onRefreshMeta}
            refreshingMeta={detail.isRefetching}
            header={
              <View>
                <ProjectHeaderCard
                  project={project}
                  onEdit={() => {
                    if (wsSlug) router.push(`/${wsSlug}/project/${id}/edit`);
                  }}
                />
                <ProjectPropertiesSection
                  project={project}
                  onPressStatus={() => {
                    if (wsSlug)
                      router.push({
                        pathname: "/[workspace]/project/[id]/picker/status",
                        params: { workspace: wsSlug, id },
                      });
                  }}
                  onPressPriority={() => {
                    if (wsSlug)
                      router.push({
                        pathname: "/[workspace]/project/[id]/picker/priority",
                        params: { workspace: wsSlug, id },
                      });
                  }}
                  onPressLead={() => {
                    if (wsSlug)
                      router.push({
                        pathname: "/[workspace]/project/[id]/picker/lead",
                        params: { workspace: wsSlug, id },
                      });
                  }}
                />
                <ProjectResourcesSection
                  projectId={id}
                  onAdd={() => {
                    if (wsSlug)
                      router.push({
                        pathname: "/[workspace]/project/[id]/add-resource",
                        params: { workspace: wsSlug, id },
                      });
                  }}
                />
                <View className="h-3" />
              </View>
            }
          />
        </View>
      )}
    </SafeAreaView>
  );
}