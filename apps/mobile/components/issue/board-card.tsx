/**
 * Kanban card used by the Board view (`board-view.tsx`). Mobile-port of
 * web's `packages/views/issues/components/board-card.tsx`, stripped to the
 * phone-height essentials that mirror web's default card content:
 * priority + title, a few label chips, then a footer row with date summary
 * and assignee avatar. Tap opens the issue (detail route owns edits —
 * status changes, description, etc.), matching web's board-card Link.
 *
 * Number shows in the footer only when the issue has one assignee and no
 * dates — web renders the assignee name there on its card; mobile keeps the
 * avatar, and the identifier is already surfaced by the title fallback on
 * IssueRow-style rows. Board cards stay dense (no description preview) so a
 * 375pt screen sees ~3 columns worth of lanes.
 */
import { Pressable, View } from "react-native";
import type { Issue } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { PriorityIcon } from "@/components/ui/priority-icon";
import { issueStatusLabel } from "@/lib/issue-status";
import { translate } from "@/lib/i18n";

/** Column width in pt — ~1.6 lanes visible on a 375pt phone. */
export const BOARD_COLUMN_WIDTH = 272;

function formatDayOnly(date: string): string {
  return date.slice(0, 10);
}

export function BoardCard({
  issue,
  onPress,
}: {
  issue: Issue;
  onPress: () => void;
}) {
  const labels = issue.labels ?? [];
  // Footer date summary mirrors web's "due date now" affordance: show what
  // the issue is waiting on without eating the card's line budget.
  const hasStart = !!issue.start_date;
  const hasDue = !!issue.due_date;
  const dateKey = hasDue
    ? "issues.cardDue"
    : hasStart
      ? "issues.cardStart"
      : null;

  return (
    <Pressable
      onPress={onPress}
      className="rounded-lg border border-border bg-card px-3 py-2.5 active:bg-secondary"
      accessibilityRole="button"
      accessibilityLabel={`${issue.title}${issue.status ? `, ${issueStatusLabel(issue.status)}` : ""}`}
    >
      <View className="flex-row items-start gap-1.5">
        <View className="pt-0.5">
          <PriorityIcon priority={issue.priority} size={13} />
        </View>
        <Text numberOfLines={2} className="flex-1 text-sm font-medium leading-snug">
          {issue.title}
        </Text>
      </View>

      {labels.length > 0 ? (
        <View className="mt-1.5 flex-row flex-wrap gap-1">
          {labels.slice(0, 3).map((label) => (
            <View
              key={label.id}
              className="flex-row items-center gap-1 rounded-full bg-secondary/60 px-1.5 py-0.5"
            >
              <View
                style={{ backgroundColor: label.color ?? "#8b8b8b" }}
                className="size-2 rounded-full"
              />
              <Text className="text-[10px] text-muted-foreground">
                {label.name}
              </Text>
            </View>
          ))}
          {labels.length > 3 ? (
            <Text className="text-[10px] text-muted-foreground/70">
              +{labels.length - 3}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View className="mt-2 flex-row items-center justify-between">
        {dateKey ? (
          <Text className="text-[11px] text-muted-foreground">
            {translate(dateKey)}{" "}
            {formatDayOnly(hasDue ? issue.due_date! : issue.start_date!)}
          </Text>
        ) : (
          <View />
        )}
        {issue.assignee_type && issue.assignee_id ? (
          <ActorAvatar
            type={issue.assignee_type}
            id={issue.assignee_id}
            size={20}
          />
        ) : null}
      </View>
    </Pressable>
  );
}