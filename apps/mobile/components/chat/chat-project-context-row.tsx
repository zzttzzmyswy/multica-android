/**
 * Chat composer project-context row — the mobile port of web
 * `chat-input.tsx`'s clearable project pill (packages/views/chat/components/
 * chat-input.tsx ~590-660).
 *
 * Rendered above the composer for every existing chat session:
 *   - bound   → the pill body shows the project name and opens the shared
 *               project picker (formSheet) to rebind the session, and the
 *               trailing (x) clears the binding (`project_id: null`);
 *   - unbound → a subdued "add project" chip opens the same picker. Without it
 *               a session could never *gain* a project from the phone — web's
 *               entry point is its composer add-menu, which mobile has no
 *               analogue of;
 *   - when the bound daemon is too old to render the project description into
 *     the run brief, an inline warning sits in the same row (soft gate — see
 *     lib/chat-project-context.ts).
 *
 * All branch decisions live in the pure helpers so this file stays a renderer.
 */
import { useQuery } from "@tanstack/react-query";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { Text } from "@/components/ui/text";
import { ProjectIcon } from "@/components/ui/project-icon";
import { findProject, projectListOptions } from "@/data/queries/projects";
import { useSetChatSessionProject } from "@/data/mutations/chat";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  chatProjectPillAccessibilityLabel,
  resolveChatProjectContext,
} from "@/lib/chat-project-context";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n/react";
import { cn } from "@/lib/utils";

interface Props {
  /** Active session the project is bound to (PATCH target). */
  sessionId: string;
  /** `ChatSession.project_id` — null/undefined renders the "add" chip. */
  projectId: string | null | undefined;
  /** From `chatProjectContextUnsupported(runtime)`; false while unknown. */
  projectContextUnsupported?: boolean;
  /** True while the turn is in flight — web locks the pill and the picker
   *  (`projectSelectionEnabled`) so the binding can't change mid-dispatch. */
  disabled?: boolean;
}

export function ChatProjectContextRow({
  sessionId,
  projectId,
  projectContextUnsupported = false,
  disabled = false,
}: Props) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const setProject = useSetChatSessionProject();
  const { data: projects = [] } = useQuery({
    ...projectListOptions(wsId),
    enabled: !!wsId,
  });

  const context = resolveChatProjectContext(projectId, projects);
  const project = findProject(projects, projectId ?? null);

  const openPicker = () => {
    if (!wsSlug || disabled) return;
    Haptics.selectionAsync().catch(() => {});
    router.push({
      pathname: "/[workspace]/chat-project-picker",
      params: {
        workspace: wsSlug,
        sessionId,
        ...(projectId ? { projectId } : {}),
      },
    });
  };

  const clear = () => {
    if (disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setProject.mutate({ id: sessionId, projectId: null });
  };

  // Unbound: no pill to clear, just the entry point that lets the session
  // acquire a project in the first place.
  if (!context.bound) {
    return (
      <View className="flex-row flex-wrap items-center gap-2 bg-background px-3 pt-2">
        <Pressable
          onPress={openPicker}
          disabled={disabled}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={t("chat.project.add")}
          className={cn(
            "h-7 flex-row items-center gap-1 rounded-full border border-dashed border-border px-2.5 active:opacity-70",
            disabled && "opacity-50",
          )}
        >
          <Ionicons
            name="add"
            size={13}
            color={theme.mutedForeground}
          />
          <Text className="text-xs text-muted-foreground">
            {t("chat.project.add")}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-row flex-wrap items-center gap-2 bg-background px-3 pt-2">
      <View className="flex-row items-center rounded-full border border-border bg-secondary pl-2.5 pr-0.5 h-7">
        <ProjectIcon icon={project?.icon} size="sm" />
        <Pressable
          onPress={openPicker}
          disabled={disabled}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={chatProjectPillAccessibilityLabel(
            context.projectName,
            t,
          )}
          className="max-w-[180px] px-1.5 py-1 active:opacity-70"
        >
          <Text
            className="text-xs font-medium text-foreground"
            numberOfLines={1}
          >
            {context.projectName ?? t("chat.project.change")}
          </Text>
        </Pressable>
        <Pressable
          onPress={clear}
          disabled={disabled}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("chat.project.clear")}
          className="h-6 w-6 items-center justify-center rounded-full active:opacity-70"
        >
          <Ionicons name="close" size={14} color={theme.mutedForeground} />
        </Pressable>
      </View>

      {projectContextUnsupported ? (
        <View className="flex-1 min-w-0 flex-row items-center gap-1">
          <Ionicons
            name="warning-outline"
            size={13}
            color={theme.warning}
          />
          <Text
            className="flex-1 text-xs text-warning"
            numberOfLines={2}
          >
            {t("chat.project.unsupported")}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
