/**
 * Activity (non-comment) timeline row. Mirrors the visual contract of web's
 * `packages/views/issues/components/issue-detail.tsx:1046-1100`:
 *
 *   1. Single-line layout — `[lead icon] [actor name] [verb...truncate] [×N badge?] [time→]`
 *   2. Contextual lead icon by action:
 *        - status_changed   → StatusIcon for the NEW status (details.to)
 *        - priority_changed → PriorityIcon for the NEW priority (details.to)
 *        - due_date_changed → Calendar glyph
 *        - everything else  → small ActorAvatar (size 16)
 *      The icon does the recognition work — user sees the new state at a
 *      glance before they read the verb.
 *   3. Whole row is `text-caption text-muted-foreground` (web parity). Actor name
 *      is `font-medium` but inherits the muted color — activity is supposed
 *      to feel quiet next to comment bubbles.
 *   4. Time is **relative**, right-aligned (`ml-auto`). Web shows absolute
 *      time in a hover tooltip; mobile has no hover so we just rely on
 *      relative for v1 (long-press → absolute time can be V2).
 *   5. Coalesce ×N chip when `coalesced_count > 1`, except `task_completed` /
 *      `task_failed` which already bake the count into their phrase.
 */
import { View } from "react-native";
import Svg, { Line, Rect } from "react-native-svg";
import type {
  IssuePriority,
  IssueStatus,
  TimelineEntry,
} from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { StatusIcon } from "@/components/ui/status-icon";
import { PriorityIcon } from "@/components/ui/priority-icon";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { activityRowText } from "@/lib/activity-search";
import { useIntlLocale } from "@/lib/i18n/react";
import { useStatusLabel } from "@/lib/status-options";
import { useIssueStatuses } from "@/data/queries/issue-statuses";
import { useTimeAgo } from "@/lib/time-ago";
import { useActorLookup } from "@/data/use-actor-name";
import { useColorScheme } from "@/lib/use-color-scheme";
import { HighlightOverlay } from "./highlight-overlay";
import { THEME } from "@/lib/theme";

function CalendarGlyph({
  size = 14,
  stroke,
}: {
  size?: number;
  stroke: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Rect
        x={2}
        y={3.5}
        width={12}
        height={10.5}
        rx={1.5}
        stroke={stroke}
        strokeWidth={1.2}
      />
      <Line
        x1={5}
        y1={1.5}
        x2={5}
        y2={4.5}
        stroke={stroke}
        strokeWidth={1.2}
        strokeLinecap="round"
      />
      <Line
        x1={11}
        y1={1.5}
        x2={11}
        y2={4.5}
        stroke={stroke}
        strokeWidth={1.2}
        strokeLinecap="round"
      />
      <Line x1={2} y1={6.8} x2={14} y2={6.8} stroke={stroke} strokeWidth={1} />
    </Svg>
  );
}

function LeadIcon({
  entry,
  mutedFg,
}: {
  entry: TimelineEntry;
  mutedFg: string;
}) {
  const details = (entry.details ?? {}) as Record<string, string>;
  const statusCatalog = useIssueStatuses();
  if (entry.action === "status_changed" && details.to) {
    const statusEntry = statusCatalog.entryOf(details.to);
    return (
      <StatusIcon
        status={details.to as IssueStatus}
        category={statusEntry?.category}
        color={statusEntry?.is_system ? undefined : (statusEntry?.color ?? undefined)}
        size={14}
      />
    );
  }
  if (entry.action === "priority_changed" && details.to) {
    return <PriorityIcon priority={details.to as IssuePriority} size={14} />;
  }
  if (
    entry.action === "due_date_changed" ||
    entry.action === "start_date_changed"
  ) {
    return <CalendarGlyph size={14} stroke={mutedFg} />;
  }
  return (
    <ActorAvatar
      type={entry.actor_type as "member" | "agent"}
      id={entry.actor_id}
      size={16}
    />
  );
}

export function ActivityRow({
  entry,
  highlighted = false,
}: {
  entry: TimelineEntry;
  /** True while an in-page find step is landing on this row. The flash is the
   *  same affordance the comment rows use, so a reader stepping onto an
   *  activity sees where they landed rather than having to guess.
   *
   *  Until MYS-2109 this row had no highlight prop at all — activities were not
   *  a find target, so there was nothing to flash. Now that they are, the row
   *  takes the same bit `CommentCard` does. */
  highlighted?: boolean;
}) {
  const { resolveActorName } = useActorLookup();
  const { colorScheme } = useColorScheme();
  const timeAgo = useTimeAgo();
  const mutedFg = THEME[colorScheme].mutedForeground;
  const statusLabel = useStatusLabel();
  // The text comes from `lib/activity-search.ts` — the SAME call in-page find's
  // index makes. Rendering and searching must not be able to drift: if this row
  // drew its own sentence, find would report words that are not on screen (or
  // miss ones that are), which is the entire class of bug this row is now part
  // of. See that module for what is deliberately left out (the ×N chip and the
  // timestamp).
  //
  // The resolver is `resolveActorName`, not `getName`: while the actor's
  // directory has not answered this row must paint a load state rather than
  // print 「Unknown」 as if it were the actor's name (MYS-2215's rule, wired to
  // this surface in MYS-2219). `actor` therefore arrives empty in exactly the
  // case the skeleton is drawn, and find's index for this row is empty with it.
  const intlLocale = useIntlLocale();
  const { actor: actorName, verb } = activityRowText(entry, {
    resolveActorName,
    statusLabel,
    // The row and find's haystack must format the same instant the same way;
    // both read the ACTIVE app locale, never the device's (MYS-2429).
    locale: intlLocale,
  });
  const showCoalesceBadge =
    (entry.coalesced_count ?? 1) > 1 &&
    entry.action !== "task_completed" &&
    entry.action !== "task_failed";

  return (
    <View className="px-4">
      <View className="rounded-lg">
        <View className="flex-row items-center gap-2">
          <View className="w-4 items-center justify-center shrink-0">
            <LeadIcon entry={entry} mutedFg={mutedFg} />
          </View>
          <Text
            className="text-caption text-muted-foreground flex-1"
            numberOfLines={1}
          >
            {/* The name run, or a load state where the name would be. Drawn as
             *  a skeleton rather than omitted: the verb starts with a space, so
             *  an empty run would leave the line reading 「 changed status …」
             *  with a hole at the head and nothing explaining it. The verb
             *  already tolerates a missing name (`formatActivity`'s `|| id`
             *  fallbacks), so the sentence still identifies which actor it is
             *  about while the row withholds the name itself. */}
            {actorName ? (
              <Text className="text-caption text-muted-foreground font-medium">
                {actorName}
              </Text>
            ) : (
              <Skeleton
                className="h-3 w-14"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              />
            )}
            {verb ? (
              <Text className="text-caption text-muted-foreground"> {verb}</Text>
            ) : null}
          </Text>
          {showCoalesceBadge ? (
            <View className="bg-muted rounded px-1.5 py-0.5 shrink-0">
              <Text className="text-caption font-medium text-muted-foreground tabular-nums">
                ×{entry.coalesced_count}
              </Text>
            </View>
          ) : null}
          <Text className="text-caption text-muted-foreground shrink-0">
            {timeAgo(entry.created_at)}
          </Text>
        </View>
        {/* Same overlay and same timing as a comment row (see
         *  `HighlightOverlay`): one "this is the row you asked for" affordance
         *  across all three find targets, not a fourth look. */}
        <ActivityHighlightOverlay active={highlighted} />
      </View>
    </View>
  );
}

/** The activity row's flash. Wash only, no border — closest to the reply row's
 *  chrome, and for the same reason: an activity is a quiet caption line, and a
 *  brand border around a one-line caption would shout louder than the content
 *  it marks. */
function ActivityHighlightOverlay({ active }: { active: boolean }) {
  return (
    <HighlightOverlay
      active={active}
      className="absolute inset-0 rounded-lg bg-brand/10"
    />
  );
}
