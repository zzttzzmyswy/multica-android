/**
 * Project list row. Mirrors the IssueRow layout shape from
 * `(tabs)/my-issues.tsx` (left icon + flex title + right column for
 * counts + time), per apps/mobile/CLAUDE.md "Visual alignment is baseline
 * → row's right-side elements stack vertically into a column".
 *
 * Layout:
 *   [📦 icon]  Project title          [3/12]
 *              [● in progress] [▍▍ high]   2d ago
 */
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Project } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ProjectIcon } from "@/components/ui/project-icon";
import { ProjectStatusIcon } from "@/components/ui/project-status-icon";
import { ProjectPriorityIcon } from "@/components/ui/project-priority-icon";
import {
  projectPriorityLabel,
  projectStatusLabel,
} from "@/lib/project-status";
import { useTimeAgo } from "@/lib/time-ago";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

interface Props {
  project: Project;
  onPress: () => void;
  /** Multi-select (web projects-page checkbox parity): long-press enters the
   *  mode, a leading check column shows selection state, and taps toggle
   *  instead of navigating. */
  selectionMode?: boolean;
  selected?: boolean;
  onLongPress?: () => void;
}

export function ProjectRow({
  project,
  onPress,
  onLongPress,
  selectionMode = false,
  selected = false,
}: Props) {
  const timeAgo = useTimeAgo();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const totalIssues = project.issue_count;
  const showCount = totalIssues > 0;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      className={cn("active:bg-secondary px-4 py-3", selected && "bg-brand/5")}
    >
      <View className="flex-row items-start gap-3">
        {selectionMode ? (
          <View className="w-6 items-center justify-center pt-2.5">
            <Ionicons
              name={selected ? "checkmark-circle" : "ellipse-outline"}
              size={20}
              color={selected ? THEME[colorScheme].brand : muted}
            />
          </View>
        ) : null}
        <ProjectIcon icon={project.icon} size="lg" />
        <View className="flex-1 gap-1">
          <Text
            className="text-base text-foreground font-medium"
            numberOfLines={2}
          >
            {project.title}
          </Text>
          <View className="flex-row items-center gap-3">
            <View className="flex-row items-center gap-1.5">
              <ProjectStatusIcon status={project.status} size={12} />
              <Text className="text-xs text-muted-foreground">
                {projectStatusLabel(project.status)}
              </Text>
            </View>
            {project.priority !== "none" ? (
              <View className="flex-row items-center gap-1.5">
                <ProjectPriorityIcon priority={project.priority} size={12} />
                <Text className="text-xs text-muted-foreground">
                  {projectPriorityLabel(project.priority)}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
        <View className="items-end gap-1">
          {showCount ? (
            <Text className="text-xs text-muted-foreground tabular-nums">
              {project.done_count}/{totalIssues}
            </Text>
          ) : (
            <Text className="text-xs text-muted-foreground/60">—</Text>
          )}
          <Text className="text-[11px] text-muted-foreground/70">
            {timeAgo(project.updated_at)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
