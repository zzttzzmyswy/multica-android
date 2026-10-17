/**
 * Project list row — web's COMFORTABLE card (`projects-page.tsx:566-680`),
 * which is the mobile list's default view.
 *
 * Layout:
 *   [📦 icon]  Project title          [3/12]
 *              [● in progress] [▍▍ high] [👤 Ada]   2d ago
 *
 * The three chips on the secondary line are web's three in-place controls
 * (iteration 253, MYS-2202): web renders status, priority AND lead as live
 * pickers on the card. Mobile rendered all three as static text and had no lead
 * line at all — a project's lead was only readable after opening it.
 */
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Project } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ProjectIcon } from "@/components/ui/project-icon";
import { ProjectRowMenu } from "@/components/project/project-row-menu";
import type { ProjectRowMenuProps } from "@/components/project/project-row-menu";
import {
  ProjectLeadCell,
  ProjectPriorityCell,
  ProjectStatusCell,
  type ProjectInlineEdit,
} from "@/components/project/project-inline-cells";
import { useTimeAgo } from "@/lib/time-ago";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

/** Card cells render at the card's own scale — the same 12pt glyphs and
 *  `text-caption` the static cells used before this round. */
const CARD_ICON_SIZE = 12;
const CARD_AVATAR_SIZE = 16;

interface Props {
  project: Project;
  onPress: () => void;
  /** Multi-select (web projects-page checkbox parity): long-press enters the
   *  mode, a leading check column shows selection state, and taps toggle
   *  instead of navigating. */
  selectionMode?: boolean;
  selected?: boolean;
  onLongPress?: () => void;
  /** The row's "⋯" (MYS-2197, web `ProjectRowActions` parity). Omitted by a
   *  caller that has no write path to give it — the trigger then does not
   *  render at all, rather than opening an empty sheet. */
  menu?: ProjectRowMenuProps;
  /** In-row status / priority / lead editors (MYS-2202, web's in-place cells).
   *  Omitted by a caller with no write path, and the three chips render as
   *  static text — the same contract `menu` above has. */
  inlineEdit?: ProjectInlineEdit;
}

export function ProjectRow({
  project,
  onPress,
  onLongPress,
  selectionMode = false,
  selected = false,
  menu,
  inlineEdit,
}: Props) {
  const timeAgo = useTimeAgo();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const totalIssues = project.issue_count;
  const showCount = totalIssues > 0;

  // The card's own selectionMode is what the cells consult: `ProjectRow` takes
  // it as a prop with a default, while the table view threads the screen's flag
  // straight through. Combining here keeps the rule in one place
  // (`projectCellIsEditable`) rather than asking every host to pre-mix it.
  const cellEdit: ProjectInlineEdit | undefined = inlineEdit
    ? { ...inlineEdit, selectionMode }
    : undefined;

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
            className="text-title-sm text-foreground font-medium"
            numberOfLines={2}
          >
            {project.title}
          </Text>
          {/* Secondary line: status, priority and lead, all three editable in
              place (web's card renders exactly these three as controls —
              `projects-page.tsx:597-679`). Each is its own tap target nested
              inside the row's `Pressable`, so the touch goes to the cell and
              every other point on the row still opens the project.

              The lead chip is new to this card. Web puts it in the card's
              footer beside the created date; on a phone that footer line is the
              count + recency column on the right, and a fourth element would
              push the title off a two-line budget. The line below the title is
              where the card's secondary text lives, so the lead joins it. */}
          <View className="flex-row items-center gap-3 flex-wrap">
            <ProjectStatusCell
              project={project}
              edit={cellEdit}
              iconSize={CARD_ICON_SIZE}
            />
            <ProjectPriorityCell
              project={project}
              edit={cellEdit}
              iconSize={CARD_ICON_SIZE}
            />
            <ProjectLeadCell
              project={project}
              edit={cellEdit}
              avatarSize={CARD_AVATAR_SIZE}
            />
          </View>
        </View>
        <View className="items-end gap-1">
          {showCount ? (
            <Text className="text-caption text-muted-foreground tabular-nums">
              {project.done_count}/{totalIssues}
            </Text>
          ) : (
            <Text className="text-caption text-muted-foreground/60">—</Text>
          )}
          <Text className="text-micro text-muted-foreground/70">
            {timeAgo(project.updated_at)}
          </Text>
        </View>
        {/* Row actions (MYS-2197). The trigger claims the touch responder, so
            opening the sheet never falls through to the row's own onPress —
            tapping elsewhere on the row still navigates. In selection mode the
            kebab gives way to the leading checkbox: a row carries one control
            for picking, and picking is what the mode is for (the rule the
            skills, autopilots and labels lists follow). Web renders the menu in
            both of its views; mobile does too, via this prop.

            The right column above stacks count over recency, so the kebab sits
            beside that column rather than inside it — it is a control, not a
            third line of secondary text. */}
        {menu && !selectionMode ? <ProjectRowMenu project={project} {...menu} /> : null}
      </View>
    </Pressable>
  );
}
