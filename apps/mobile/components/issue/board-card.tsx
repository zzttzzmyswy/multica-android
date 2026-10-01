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
 *
 * Which of those fields render is the user's `cardProperties` display setting
 * (web's board-card reads the same key off its view store). The caller passes
 * it down rather than this card reading a store: mobile has three independent
 * issue surfaces, each with its own store, and the card cannot know which one
 * is hosting it. A missing prop means "all on", so a call site that does not
 * care (the drag overlay) renders exactly the default card.
 *
 * Only five fields are gated, because only five exist on this card: priority,
 * labels, assignee, and the single start/due footer date. Web's
 * `description` / `project` / `childProgress` have no content here — the
 * toggle rows are still offered in the Display panel and still round-trip
 * through saved views (see issues-filter.tsx), they just gate nothing on a
 * phone-height card.
 *
 * A second, independent display dimension rides alongside: `cardPropertyIds`
 * names workspace custom properties whose VALUES render as chips here, exactly
 * as web's board card does (web `board-card.tsx:64-72`, `:211`). The chips sit
 * in their own row under the labels; `lib/card-properties.ts` owns which
 * configured ids actually produce one.
 */
import { Pressable, View } from "react-native";
import type {
  AccessibilityActionEvent,
  AccessibilityActionInfo,
  GestureResponderEvent,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { Issue } from "@multica/core/types";
import type { CardProperties } from "@/data/stores/issue-filter-slice";
import { isPastDateOnly } from "@multica/core/issues/date";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { useActorProfileStore } from "@/data/stores/actor-profile-store";
import { PriorityIcon } from "@/components/ui/priority-icon";
import { useStatusLabel } from "@/lib/status-options";
import { translate } from "@/lib/i18n";
import { propertyActiveOptions } from "@/data/queries/properties";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  cardPropertyChip,
  limitCardPropertyEntries,
  resolveCardPropertyEntries,
} from "@/lib/card-properties";
import { propertyTypeIcon } from "@/lib/issue-properties";
import Ionicons from "@expo/vector-icons/Ionicons";
import { CustomStatusChip } from "./custom-status-chip";
import { IssueAgentActivityIndicator } from "./issue-agent-activity-indicator";

/** Column width in pt — ~1.6 lanes visible on a 375pt phone. */
export const BOARD_COLUMN_WIDTH = 272;

/** Every field on, matching web's view-store default (view-store.ts:287-296).
 *  Also the fallback when a caller passes no `cardProperties`. */
export const ALL_CARD_PROPERTIES_ON: CardProperties = {
  priority: true,
  description: true,
  assignee: true,
  startDate: true,
  dueDate: true,
  project: true,
  childProgress: true,
  labels: true,
};

/** Stable identity for "no custom chips". A fresh `[]` per render would
 *  invalidate the board's memoised lanes on every frame. */
const EMPTY_CARD_PROPERTY_IDS: readonly string[] = [];

function formatDayOnly(date: string): string {
  return date.slice(0, 10);
}

export function BoardCard({
  issue,
  onPress,
  onLongPress,
  onPressOut,
  lifted = false,
  dimmed = false,
  accessibilityHint,
  accessibilityActions,
  onAccessibilityAction,
  cardProperties = ALL_CARD_PROPERTIES_ON,
  cardPropertyIds = EMPTY_CARD_PROPERTY_IDS,
}: {
  issue: Issue;
  /** Which fields to draw — the hosting surface's `cardProperties` display
   *  setting. Defaults to all-on (see the module doc). */
  cardProperties?: CardProperties;
  /**
   * Custom-property definition ids to draw as chips — web's `cardPropertyIds`
   * display dimension. Resolved against the workspace catalog (read below) and
   * this issue's own values; ids that do not resolve render nothing (see
   * `lib/card-properties.ts`).
   *
   * A prop rather than a store read, unlike the catalog: the three issue
   * surfaces keep three independent view stores and the card cannot know which
   * one hosts it.
   */
  cardPropertyIds?: readonly string[];
  onPress: () => void;
  /** Carries the responder event: the board's drag reads the touch's window
   *  coordinates off it to place the lifted card under the finger. */
  onLongPress?: (event: GestureResponderEvent) => void;
  /** Only used by the drag: a long-press released without the board ever
   *  taking the responder is the status sheet's gesture. */
  onPressOut?: () => void;
  /** Rendered as the drag overlay rather than as a lane card. */
  lifted?: boolean;
  /**
   * The card is lifted off the board and follows the finger as an overlay.
   * Its lane row stays mounted — dimmed and dashed — because that row's
   * Pressable is what owns the gesture until the board takes it over; see the
   * `onPressOut` note in board-view.tsx.
   */
  dimmed?: boolean;
  /** Says how a screen reader reaches what the drag does with a finger. */
  accessibilityHint?: string;
  /** The board's drag owns the pointer gesture, which a screen reader cannot
   *  perform — the status sheet stays reachable through an accessibility
   *  action instead. */
  accessibilityActions?: AccessibilityActionInfo[];
  onAccessibilityAction?: (actionName: string) => void;
}) {
  const labels = issue.labels ?? [];
  const statusLabel = useStatusLabel();
  // The assignee avatar is the only element on the card that does not already
  // own a gesture — the card's tap opens the issue and its long-press starts
  // the drag. An inner press target on the avatar is therefore safe here
  // (web's card hangs a hover card off the same spot, `board-card.tsx:139`).
  const openProfile = useActorProfileStore((s) => s.open);
  // Footer date summary mirrors web's "due date now" affordance: show what
  // the issue is waiting on without eating the card's line budget.
  // Each date is gated by its own switch, then the footer keeps whichever
  // survives. Mobile has ONE date line (no room for two on a 272pt card), so
  // when both are on it prefers the due date — the same precedence the ungated
  // card had, and the one that matters more (a deadline beats a start).
  const hasStart = !!issue.start_date && cardProperties.startDate;
  const hasDue = !!issue.due_date && cardProperties.dueDate;
  const dateKey = hasDue
    ? "issues.cardDue"
    : hasStart
      ? "issues.cardStart"
      : null;
  // Web paints a past due date in `text-destructive` on its board card; the
  // start date never turns (web's `isPastDateOnly` guard is due-date only).
  const overdue = hasDue && isPastDateOnly(issue.due_date);
  // The catalog is workspace-scoped, not per-surface, so one shared cache
  // entry serves every card on every board.
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  // Custom-property chips — web's `cardPropertyIds` dimension
  // (board-card.tsx:64-72). The catalog is the ACTIVE definitions, which is
  // what web's board card queries (`propertyListOptions(cardWsId)`,
  // board-card.tsx:65, includeArchived defaulting to false), so an archived
  // definition renders no chip in either client. The query is shared across
  // every card through react-query's cache.
  const catalog = useQuery({
    ...propertyActiveOptions(wsId),
    enabled: cardPropertyIds.length > 0,
  }).data;
  const customEntries =
    catalog && cardPropertyIds.length > 0
      ? limitCardPropertyEntries(
          resolveCardPropertyEntries(
            cardPropertyIds,
            catalog,
            issue.properties ?? {},
          ),
        )
      : null;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressOut={onPressOut}
      delayLongPress={350}
      accessibilityHint={accessibilityHint}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={
        onAccessibilityAction
          ? (e: AccessibilityActionEvent) =>
              onAccessibilityAction(e.nativeEvent.actionName)
          : undefined
      }
      className={`rounded-lg border bg-card px-3 py-2.5 ${
        lifted
          ? "border-border shadow-lg"
          : dimmed
            ? "border-dashed border-border/70 opacity-40"
            : "border-border active:bg-secondary"
      }`}
      accessibilityRole="button"
      accessibilityLabel={`${issue.title}${issue.status ? `, ${statusLabel(issue.status)}` : ""}`}
    >
      <View className="flex-row items-start gap-1.5">
        {cardProperties.priority ? (
          <View className="pt-0.5">
            <PriorityIcon priority={issue.priority} size={13} />
          </View>
        ) : null}
        <Text numberOfLines={2} className="flex-1 text-sm font-medium leading-snug">
          {issue.title}
        </Text>
        {issue.status ? (
          <View className="pt-0.5">
            <CustomStatusChip status={issue.status} />
          </View>
        ) : null}
      </View>

      {cardProperties.labels && labels.length > 0 ? (
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

      {/* Custom-property chips — web's `cardPropertyIds` dimension. Placed
          after the label row for the same reason web puts it after labels in
          one flex container (board-card.tsx:211-224): both are the card's
          "what is on this issue" band, above the date/assignee footer. Plain
          Views, not pressables: the card already owns tap (open) and
          long-press (drag), and web's card chips are likewise not tappable. */}
      {customEntries && customEntries.shown.length > 0 ? (
        <View className="mt-1.5 flex-row flex-wrap gap-1">
          {customEntries.shown.map(({ property, display }) => {
            const chip = cardPropertyChip(display, translate);
            return (
              <View
                key={property.id}
                className="max-w-[160px] flex-row items-center gap-1 rounded-full bg-secondary/60 px-1.5 py-0.5"
              >
                {chip.color ? (
                  <View
                    style={{ backgroundColor: chip.color }}
                    className="size-2 shrink-0 rounded-full"
                  />
                ) : (
                  <Ionicons
                    name={propertyTypeIcon(property.type)}
                    size={10}
                    className="text-muted-foreground"
                  />
                )}
                <Text
                  numberOfLines={1}
                  className="flex-shrink text-[10px] text-muted-foreground"
                >
                  {chip.text}
                </Text>
                {chip.rest ? (
                  <Text className="text-[10px] text-muted-foreground/70">
                    +{chip.rest}
                  </Text>
                ) : null}
              </View>
            );
          })}
          {customEntries.rest > 0 ? (
            <Text className="text-[10px] text-muted-foreground/70">
              +{customEntries.rest}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View className="mt-2 flex-row items-center justify-between">
        {dateKey ? (
          <Text
            className={`text-[11px] ${
              overdue ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {translate(dateKey)}{" "}
            {formatDayOnly(hasDue ? issue.due_date! : issue.start_date!)}
          </Text>
        ) : (
          <View />
        )}
        <View className="flex-row items-center gap-1.5">
          <IssueAgentActivityIndicator issueId={issue.id} ringClassName="bg-card" />
          {cardProperties.assignee && issue.assignee_type && issue.assignee_id ? (
            <ActorAvatar
              type={issue.assignee_type}
              id={issue.assignee_id}
              size={20}
              onPressProfile={() =>
                openProfile(issue.assignee_type!, issue.assignee_id!)
              }
            />
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}