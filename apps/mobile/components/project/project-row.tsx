/**
 * Project list row — web's COMFORTABLE card (`projects-page.tsx:566-680`),
 * which is the mobile list's default view.
 *
 * Layout:
 *   [icon]  Project title                  [menu]
 *           [status] [priority] [lead]
 *           [progress] [recency]
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
import { ProgressRing } from "@/components/ui/progress-ring";
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
import { useTranslation } from "@/lib/i18n/react";
import { projectVisibilityIsPrivate } from "@/lib/project-access";
import { cn } from "@/lib/utils";
import { useThemePalette } from "@/lib/appearance-a11y-runtime";

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
  const palette = useThemePalette();
  const timeAgo = useTimeAgo();
  const { t } = useTranslation();
  const muted = palette.mutedForeground;
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
      className={cn("px-4 py-3.5 active:bg-secondary", selected && "bg-brand/10")}
      accessibilityState={selectionMode ? { selected } : undefined}
    >
      <View className="flex-row items-start gap-3">
        {selectionMode ? (
          <View className="w-6 items-center justify-center pt-2.5">
            <Ionicons
              name={selected ? "checkmark-circle" : "ellipse-outline"}
              size={20}
              color={selected ? palette.brand : muted}
            />
          </View>
        ) : null}
        <View className="size-10 items-center justify-center rounded-xl bg-surface-1">
          <ProjectIcon icon={project.icon} size="lg" />
        </View>
        <View className="min-w-0 flex-1 gap-2">
          <View className="flex-row items-start gap-1.5">
            <Text
              className="shrink text-title-sm font-semibold text-foreground"
              numberOfLines={2}
            >
              {project.title}
            </Text>
            {/* Private marker (MUL-8472, MYS-2915). Web has no list-level lock,
                but on a phone the list is the only surface a user browses, so a
                private project that looks identical to a public one means the
                reader cannot tell who else sees it without opening every
                project. The glyph carries the fact; `accessibilityLabel` makes
                it readable to a screen reader, which a bare icon is not. */}
            {projectVisibilityIsPrivate(project) ? (
              <Ionicons
                name="lock-closed"
                size={12}
                color={muted}
                style={{ marginTop: 4 }}
                accessibilityLabel={t("projects.access.private")}
              />
            ) : null}
          </View>
          {/* Same in-place editors as the web card; wrap them on a phone
              so metadata never takes space from the project title. */}
          <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
            <ProjectStatusCell
              card
              project={project}
              edit={cellEdit}
              iconSize={CARD_ICON_SIZE}
            />
            <ProjectPriorityCell
              card
              project={project}
              edit={cellEdit}
              iconSize={CARD_ICON_SIZE}
            />
            <ProjectLeadCell
              card
              project={project}
              edit={cellEdit}
              avatarSize={CARD_AVATAR_SIZE}
            />
          </View>
          <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
            {showCount ? (
              <View className="flex-row items-center gap-1.5">
                <ProgressRing done={project.done_count} total={totalIssues} size={12} />
                <Text className="text-caption font-medium tabular-nums text-muted-foreground">
                  {project.done_count}/{totalIssues}
                </Text>
              </View>
            ) : null}
            <Text className="text-caption text-muted-foreground">
              {timeAgo(project.updated_at)}
            </Text>
          </View>
        </View>
        {/* Row actions stay independent of opening or selecting the row. */}
        {menu && !selectionMode ? <ProjectRowMenu project={project} {...menu} /> : null}
      </View>
    </Pressable>
  );
}
