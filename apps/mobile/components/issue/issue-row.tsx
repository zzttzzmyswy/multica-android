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
import { ISSUE_DATE_SHORT, formatIssueDate } from "@/lib/format-date";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { PriorityIcon } from "@/components/ui/priority-icon";
import { StatusIcon } from "@/components/ui/status-icon";
import { ProgressRing } from "@/components/ui/progress-ring";
import { useIssueStatuses } from "@/data/queries/issue-statuses";
import { useColorScheme } from "@/lib/use-color-scheme";
import { useIntlLocale } from "@/lib/i18n/react";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { CustomStatusChip } from "./custom-status-chip";
import { IssueAgentActivityIndicator } from "./issue-agent-activity-indicator";
import type { ChildProgress } from "@/data/queries/issues";

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
  /** THIS issue's own children progress (it can itself be a parent). When
   *  set and `total > 0`, a small ring + "done/total" renders at the row's
   *  trailing edge — mirrors web's SubIssueRow `childProgress` chip
   *  (issue-detail.tsx:775). Drives the nested progress ring on sub-issue
   *  rows (MYS-493). */
  childProgress?: ChildProgress;
  /**
   * Inline edit triggers, mirroring web's SubIssueRow ("inline status &
   * assignee editing", issue-detail.tsx:717-831). Each supplied handler
   * turns its icon into its own press target: React Native gives the
   * innermost Pressable the touch, so tapping the icon edits in place while
   * the rest of the row still runs `onPress` (navigate). Omit a handler and
   * that affordance stays a plain, non-interactive icon.
   */
  onPressStatus?: () => void;
  onPressAssignee?: () => void;
  onPressDueDate?: () => void;
  /**
   * Due date as a date-only "YYYY-MM-DD" string. Rendered as a trailing
   * chip whenever `onPressDueDate` is set — dimmed placeholder when the
   * issue has no date, so the row keeps a stable tap target (web's
   * DueDatePicker renders a dashed placeholder for the same reason).
   */
  dueDate?: string | null;
}

export function IssueRow({
  issue,
  onPress,
  showStatus = false,
  selectionMode = false,
  selected = false,
  onLongPress,
  childProgress,
  onPressStatus,
  onPressAssignee,
  onPressDueDate,
  dueDate,
}: Props) {
  const { colorScheme } = useColorScheme();
  // Subscribes, so a language switch re-renders the due-date chip below.
  const intlLocale = useIntlLocale();
  const statusEntry = useIssueStatuses().entryOf(issue.status);
  const checkColor = THEME[colorScheme].primary;
  const showChildProgress = childProgress && childProgress.total > 0;
  const dueLabel = formatIssueDate(dueDate ?? null, ISSUE_DATE_SHORT, intlLocale);
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
        {showStatus ? (
          <Pressable
            onPress={onPressStatus}
            disabled={!onPressStatus}
            hitSlop={8}
            accessibilityRole={onPressStatus ? "button" : undefined}
            className="flex-row items-center gap-1.5 active:opacity-60"
          >
            <StatusIcon
              status={issue.status}
              category={statusEntry?.category}
              color={statusEntry?.is_system ? undefined : (statusEntry?.color ?? undefined)}
              size={14}
            />
            <CustomStatusChip status={issue.status} />
          </Pressable>
        ) : null}
        <PriorityIcon priority={issue.priority} size={14} />
        <Text
          className="text-xs text-muted-foreground shrink-0 w-16"
          numberOfLines={1}
        >
          {issue.identifier}
        </Text>
        <IssueAgentActivityIndicator issueId={issue.id} />
        <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
          {issue.title}
        </Text>
        {showChildProgress ? (
          <View className="flex-row items-center gap-1 px-1.5 py-0.5 rounded-full bg-secondary shrink-0">
            <ProgressRing done={childProgress.done} total={childProgress.total} size={11} />
            <Text className="text-[11px] text-muted-foreground tabular-nums font-medium">
              {childProgress.done}/{childProgress.total}
            </Text>
          </View>
        ) : null}
        {onPressDueDate ? (
          <Pressable
            onPress={onPressDueDate}
            hitSlop={8}
            accessibilityRole="button"
            className="flex-row items-center gap-0.5 rounded-full px-1.5 py-0.5 active:opacity-60"
          >
            <Ionicons
              name="calendar-outline"
              size={12}
              color={THEME[colorScheme].mutedForeground}
            />
            <Text
              className={cn(
                "text-[11px] tabular-nums",
                dueLabel ? "text-muted-foreground" : "text-muted-foreground/50",
              )}
            >
              {dueLabel ?? "–"}
            </Text>
          </Pressable>
        ) : null}
        {issue.assignee_type && issue.assignee_id ? (
          <Pressable
            onPress={onPressAssignee}
            disabled={!onPressAssignee}
            hitSlop={8}
            accessibilityRole={onPressAssignee ? "button" : undefined}
            className="active:opacity-60"
          >
            <ActorAvatar
              type={issue.assignee_type}
              id={issue.assignee_id}
              size={20}
              showPresence
            />
          </Pressable>
        ) : onPressAssignee ? (
          /* No assignee yet — web's SubIssueRow renders a dashed placeholder
             so the row keeps a tap target for "assign someone". */
          <Pressable
            onPress={onPressAssignee}
            hitSlop={8}
            accessibilityRole="button"
            className="items-center justify-center rounded-full border border-dashed border-muted-foreground/40 active:opacity-60"
            style={{ width: 20, height: 20 }}
          >
            <Ionicons
              name="person-add-outline"
              size={11}
              color={THEME[colorScheme].mutedForeground}
            />
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}
