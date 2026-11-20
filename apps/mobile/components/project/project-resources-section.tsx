/**
 * Project resources section. Read-mostly list of typed external pointers.
 *
 * Two types today (`packages/core/types/project.ts:67`):
 *
 *   - `github_repo`: tap a row to open the URL in the system browser.
 *   - `local_directory` (iteration 135): a folder on a specific machine. Tap
 *     opens an action sheet instead of a URL — there is nothing to open, and
 *     the row now has a real action (changing how tasks use the folder) that
 *     had no other entry point. The subtitle carries the path and a mode
 *     badge, because "which folder, and does it get edited in place" is what
 *     a reader needs from this row.
 *
 * Long-press detaches on either type, unchanged.
 *
 * Schema-tolerant by design — `resource_ref` is typed `unknown` in the mobile
 * schema (server may extend the shape per resource_type). We narrow via
 * `lib/project-resources.ts` only when the dispatch knows the type, so a
 * future resource_type renders as a generic row with its label instead of
 * crashing, and never borrows a field from another type.
 */
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import type {
  LocalDirectoryExecutionMode,
  ProjectResource,
} from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { LocalDirectoryModeOptions } from "@/components/project/local-directory-mode-options";
import { projectResourcesOptions } from "@/data/queries/projects";
import {
  useDeleteProjectResource,
  useUpdateProjectResource,
} from "@/data/mutations/projects";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { ActionSheet } from "@/lib/action-sheet";
import {
  executionModeOf,
  githubResourceUrl,
  localDirectoryRef,
  resourceSubtitle,
  worktreeUnsupportedInfo,
  type WorktreeUnsupportedInfo,
} from "@/lib/project-resources";
import { projectResourceState } from "@/lib/project-resource-state";
import { useThemePalette } from "@/lib/appearance-a11y-runtime";

interface Props {
  projectId: string;
  onAdd: () => void;
}

export function ProjectResourcesSection({ projectId, onAdd }: Props) {
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: resources, isError, isFetching, refetch } = useQuery(
    projectResourcesOptions(wsId, projectId),
  );
  // Same typed resources and row actions as the web sidebar, but mobile keeps
  // failure recovery beside the list instead of collapsing an unanswered read
  // into the empty state. React Query retains the last successful rows.
  const state = projectResourceState({ resources, isError });
  const remove = useDeleteProjectResource(projectId);
  /** The local directory whose mode sheet is open, if any. Held as the whole
   *  resource (not just its id) because the sheet needs the current mode and
   *  the path, and a refetch mid-edit would otherwise move the target. */
  const [editingMode, setEditingMode] = useState<ProjectResource | null>(null);

  const onOpen = useCallback(
    (resource: ProjectResource) => {
      const ref = localDirectoryRef(resource);
      if (ref) {
        setEditingMode(resource);
        return;
      }
      void openGithubResource(resource);
    },
    [],
  );

  const confirmDetach = useCallback(
    (resource: ProjectResource) => {
      Alert.alert(t("resource.detachTitle"), resourceSubtitle(resource), [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("resource.detach"),
          style: "destructive",
          onPress: () => remove.mutate(resource.id),
        },
      ]);
    },
    [remove, t],
  );

  const onLongPress = useCallback(
    (resource: ProjectResource) => {
      const isLocal = localDirectoryRef(resource) !== null;
      if (!isLocal) {
        confirmDetach(resource);
        return;
      }
      // A local directory has two actions, so long-press cannot keep the
      // detach shortcut the repository rows have without making one of the
      // two unreachable. Offer both instead.
      ActionSheet.showActionSheetWithOptions(
        {
          title: t("resource.actions"),
          options: [t("resource.modeEdit"), t("resource.detach"), t("common.cancel")],
          destructiveButtonIndex: 1,
          cancelButtonIndex: 2,
        },
        (index) => {
          if (index === 0) setEditingMode(resource);
          else if (index === 1) confirmDetach(resource);
        },
      );
    },
    [confirmDetach, t],
  );

  return (
    <View className="mx-4 mt-4 overflow-hidden rounded-2xl border border-border bg-background">
      <View className="flex-row items-center justify-between gap-3 px-4 py-2 bg-secondary/30">
        <Text accessibilityRole="header" className="flex-1 text-label text-muted-foreground font-semibold">
          {t("resource.sectionTitle")}
        </Text>
        <Pressable
          onPress={onAdd}
          accessibilityRole="button"
          accessibilityLabel={t("resource.add")}
          className="min-h-11 items-center justify-center px-3 active:bg-secondary rounded-lg"
        >
          <Text className="text-label font-medium text-brand">{t("resource.add")}</Text>
        </Pressable>
      </View>
      {state === "error" || state === "stale" ? (
        <View className="gap-3 border-t border-border px-4 py-4">
          <Text accessibilityRole="alert" accessibilityLiveRegion="polite" className="text-body text-muted-foreground">
            {t(state === "error" ? "resource.loadFailed" : "resource.refreshFailed")}
          </Text>
          <Button
            variant="outline"
            onPress={() => void refetch()}
            disabled={isFetching}
            accessibilityLabel={t("common.retry")}
            accessibilityState={{ disabled: isFetching, busy: isFetching }}
            className="min-h-11 self-start"
          >
            {isFetching ? <ActivityIndicator size="small" /> : null}
            <Text>{t("common.retry")}</Text>
          </Button>
        </View>
      ) : null}
      {state === "loading" ? (
        <View className="px-4 py-6 items-center" accessibilityState={{ busy: true }}>
          <ActivityIndicator size="small" />
        </View>
      ) : state === "empty" ? (
        <View className="px-4 py-5 border-t border-border">
          <Text className="text-body text-muted-foreground">
            {t("project.noResources")}
          </Text>
        </View>
      ) : (
        resources?.map((resource) => (
          <ResourceRow
            key={resource.id}
            resource={resource}
            onPress={() => onOpen(resource)}
            onLongPress={() => onLongPress(resource)}
          />
        ))
      )}

      {editingMode ? (
        <LocalDirectoryModeSheet
          projectId={projectId}
          resource={editingMode}
          onClose={() => setEditingMode(null)}
        />
      ) : null}
    </View>
  );
}

async function openGithubResource(resource: ProjectResource) {
  const url = githubResourceUrl(resource);
  if (!url) return;
  const canOpen = await Linking.canOpenURL(url);
  if (canOpen) await Linking.openURL(url);
}

function ResourceRow({
  resource,
  onPress,
  onLongPress,
}: {
  resource: ProjectResource;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const palette = useThemePalette();
  const { t } = useTranslation();
  const local = localDirectoryRef(resource);
  const subtitle = resourceSubtitle(resource);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      accessibilityRole="button"
      accessibilityLabel={resource.label ?? subtitle}
      className="flex-row items-center gap-3 px-4 py-3.5 min-h-14 active:bg-secondary border-t border-border"
    >
      <Ionicons
        name={iconFor(resource.resource_type)}
        size={16}
        color={palette.mutedForeground}
      />
      <View className="flex-1 min-w-0">
        <Text className="text-body font-medium text-foreground" numberOfLines={2}>
          {resource.label ?? subtitle}
        </Text>
        {resource.label ? (
          <Text className="text-caption text-muted-foreground" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        {local ? (
          <View
            className={
              executionModeOf(local) === "worktree"
                ? "mt-2 self-start rounded-full border border-brand/40 bg-brand/10 px-2 py-0.5"
                : "mt-2 self-start rounded-full border border-border bg-secondary/60 px-2 py-0.5"
            }
          >
            <Text
              className={
                executionModeOf(local) === "worktree"
                  ? "text-micro font-medium text-brand"
                  : "text-micro text-muted-foreground"
              }
            >
              {executionModeOf(local) === "worktree"
                ? t("resource.modeBadgeWorktree")
                : t("resource.modeBadgeInPlace")}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function iconFor(type: string): keyof typeof Ionicons.glyphMap {
  if (type === "github_repo") return "logo-github";
  if (type === "local_directory") return "folder-open-outline";
  return "link-outline";
}

/**
 * Sheet for changing how tasks use a local directory. Mounted only while open,
 * so each opening starts from the resource's current mode rather than the
 * previous edit's selection.
 *
 * A failed save keeps the sheet open and shows why: the only failure the
 * client can hit that it did not already prevent is the server's
 * daemon-capability gate, and closing on that would leave the user with a
 * message and no way to act on it (web's `handleConfirmMode` does the same).
 */
function LocalDirectoryModeSheet({
  projectId,
  resource,
  onClose,
}: {
  projectId: string;
  resource: ProjectResource;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const update = useUpdateProjectResource(projectId);
  const ref = localDirectoryRef(resource);
  const [mode, setMode] = useState<LocalDirectoryExecutionMode>(
    ref ? executionModeOf(ref) : "in_place",
  );
  const [error, setError] = useState<WorktreeUnsupportedInfo | null>(null);

  const path = ref?.local_path ?? "";

  const save = () => {
    if (!ref || update.isPending) return;
    if (executionModeOf(ref) === mode) {
      onClose();
      return;
    }
    setError(null);
    update.mutate(
      {
        resourceId: resource.id,
        data: {
          // The server REPLACES a supplied ref rather than deep-merging it
          // (server/internal/handler/project_resource.go:60), so every other
          // field has to ride along or the path and daemon would be dropped.
          resource_ref: { ...ref, execution_mode: mode },
        },
      },
      {
        onSuccess: onClose,
        onError: (err) => {
          const unsupported = worktreeUnsupportedInfo(err);
          if (unsupported) {
            setError(unsupported);
            return;
          }
          setError({
            message: err instanceof Error ? err.message : t("resource.modeUpdateFailed"),
            currentVersion: "",
            minVersion: "",
          });
        },
      },
    );
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40" onPress={onClose}>
        <View className="flex-1 justify-end">
          <Pressable onPress={() => {}} className="bg-popover rounded-t-2xl">
            <View className="px-4 py-3 border-b border-border flex-row items-center justify-between">
              <Text className="text-title-sm font-semibold text-foreground">
                {t("resource.modeEdit")}
              </Text>
              <Pressable onPress={onClose} hitSlop={8}>
                <Ionicons name="close" size={20} color="currentColor" />
              </Pressable>
            </View>
            <ScrollView className="px-4 py-3 max-h-[70vh]">
              <Text className="text-caption text-muted-foreground">
                {t("resource.modeDescription")}
              </Text>
              <View
                className="mt-2 mb-3 rounded-md bg-secondary/60 px-2.5 py-1.5"
                // Absolute paths are long and their shape carries the meaning
                // (which machine, which root) — wrap rather than truncate.
              >
                <Text className="font-mono text-micro text-muted-foreground">
                  {path}
                </Text>
              </View>
              <LocalDirectoryModeOptions
                value={mode}
                onChange={(next) => {
                  setMode(next);
                  setError(null);
                }}
                error={error}
              />
              {update.isPending ? (
                <View className="pt-3 items-center">
                  <ActivityIndicator size="small" />
                </View>
              ) : null}
              <View className="flex-row justify-end gap-2 pt-4 pb-2">
                <Button variant="ghost" onPress={onClose}>
                  <Text>{t("common.cancel")}</Text>
                </Button>
                <Button variant="default" onPress={save} disabled={update.isPending}>
                  <Text>{t("resource.modeSave")}</Text>
                </Button>
              </View>
            </ScrollView>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
