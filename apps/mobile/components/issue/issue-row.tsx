/**
 * Shared issue row used by every list-style issue surface on mobile —
 * (tabs)/my-issues, more/issues (workspace-wide), and project detail's
 * related-issues bucket.
 *
 * Layout mirrors web's `packages/views/issues/components/list-row.tsx`:
 *   [status?]  priority  identifier  title  …  assignee
 *
 * `showStatus` is opt-in because the my-issues SectionList already groups
 * by status (rendering it again per-row would be visual noise). The
 * project-related-issues view doesn't section by status, so it asks for
 * the inline status icon. New callers should default to false unless they
 * mix multiple statuses inside a single ungrouped list.
 *
 * Behavioral parity:
 *   - Same `Issue` type, same `assignee_type`/`assignee_id` semantics
 *     (root CLAUDE.md "Data identity must agree").
 *   - Mirrors web `packages/views/issues/components/list-row.tsx:52`:
 *     render the assignee whenever `assignee_type && assignee_id` are both
 *     truthy — `ActorAvatar` itself handles member / agent / squad rendering
 *     (rounded square + people glyph or `squad.avatar_url` for squads). A
 *     future fourth enum value falls through to ActorAvatar's initials
 *     fallback, which is the real "enum drift downgrades, not crashes"
 *     behavior — earlier whitelist (member/agent only) silently dropped
 *     squad assignees instead.
 */
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Issue } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { PriorityIcon } from "@/components/ui/priority-icon";
import { StatusIcon } from "@/components/ui/status-icon";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

interface Props {
  issue: Issue;
  onPress: () => void;
  /** Render the status icon inline at the start of the row. Default: false. */
  showStatus?: boolean;
  /**
   * Multi-select mode (batch actions). When true, the row renders a leading
   * selection indicator and `onPress` toggles membership instead of
   * navigating. Opted in by list surfaces that host the BatchActionBar.
   */
  selectionMode?: boolean;
  /** Whether this row's issue is in the active selection. */
  selected?: boolean;
  /** Long-press enters multi-select pre-selecting this row. */
  onLongPress?: () => void;
}

export function IssueRow({
  issue,
  onPress,
  showStatus = false,
  selectionMode = false,
  selected = false,
  onLongPress,
}: Props) {
  const { colorScheme } = useColorScheme();
  const checkColor = THEME[colorScheme].primary;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      className={`active:bg-secondary px-4 py-3 ${selected ? "bg-primary/5" : ""}`}
      accessibilityState={{ selected }}
    >
      <View className="flex-row items-center gap-3">
        {selectionMode ? (
          <Ionicons
            name={selected ? "checkmark-circle" : "ellipse-outline"}
            size={22}
            color={selected ? checkColor : THEME[colorScheme].mutedForeground}
          />
        ) : null}
        {showStatus ? <StatusIcon status={issue.status} size={14} /> : null}
        <PriorityIcon priority={issue.priority} size={14} />
        <Text className="text-xs text-muted-foreground shrink-0 w-16">
          {issue.identifier}
        </Text>
        <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
          {issue.title}
        </Text>
        {issue.assignee_type && issue.assignee_id ? (
          <ActorAvatar
            type={issue.assignee_type}
            id={issue.assignee_id}
            size={20}
            showPresence
          />
        ) : null}
      </View>
    </Pressable>
  );
}
