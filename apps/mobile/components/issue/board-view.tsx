/**
 * Board view for the issue workbench — mobile port of web's
 * `packages/views/issues/components/board-view.tsx`, phone-adapted:
 *
 *   - Columns come from the SAME `groupIssues` helper as the list view's
 *     SectionList, so filters / sorting / grouping apply identically to
 *     both views (same store, same derived `sorted` array). Status columns
 *     keep empty lanes visible in BOARD_STATUSES order (web's buildGroups
 *     keeps every status as a drop target); the list view drops them.
 *   - Horizontal `ScrollView` + one vertical `FlatList` per lane — ~1.6
 *     columns are visible on a 375pt phone and lane contents scroll on
 *     touch. Columns pin their own width (no flex-grow inside the row-axis
 *     content container) and stretch to the board height.
 *   - Tap a card → open the issue (detail route owns edits). Drag-and-drop
 *     between lanes is deferred; the detail page's status picker is the
 *     move mechanism this iteration.
 *   - Status columns can be hidden (web `board-column.tsx:215`). Hiding
 *     writes `statusFilters` in the shared filter slice, so the hidden lanes
 *     disappear from the board AND from the server window at once — see
 *     `hideStatus` in issue-filter-slice.ts. Web parks the restore list in a
 *     fixed side rail; a phone has no room for one, so the hidden statuses
 *     render as a trailing lane at the end of the board.
 */
import { memo, useCallback, useMemo } from "react";
import { FlatList, Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Issue, IssueProperty, IssueStatus } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { StatusIcon } from "@/components/ui/status-icon";
import { useStatusLabel, useStatusOptions } from "@/lib/status-options";
import { translate } from "@/lib/i18n";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { ActionSheet } from "@/lib/action-sheet";
import { useUpdateIssue } from "@/data/mutations/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import type { IssueGrouping } from "@/data/stores/issue-filter-slice";
import { useActorLookup } from "@/data/use-actor-name";
import {
  groupIssues,
  type IssueGroupSection,
} from "@/lib/filter-issues";
import { BoardCard, BOARD_COLUMN_WIDTH } from "./board-card";

function ColumnHeader({
  column,
  onCreateIssue,
  onHideStatus,
  statusFixedByView = false,
}: {
  column: IssueGroupSection;
  onCreateIssue?: (section: IssueGroupSection) => void;
  /** Present only for status lanes on a board that can hide them. */
  onHideStatus?: (status: IssueStatus) => void;
  /** A status the open saved view pins cannot be hidden — that would strip
   *  one of the view's own conditions while its chip still reads as active
   *  (web board-column.tsx:119-122). */
  statusFixedByView?: boolean;
}) {
  const { t } = useTranslation();
  const { getName } = useActorLookup();
  const { colorScheme } = useColorScheme();
  const statusLabel = useStatusLabel();
  let leading: React.ReactNode = null;
  let label = "";
  if (column.status) {
    label = statusLabel(column.status);
    leading = <StatusIcon status={column.status} size={14} />;
  } else if (column.propertyId !== undefined) {
    // Select-property lane: the option's own color is the only affordance
    // that ties the lane to the value chips on the cards. The trailing
    // no-value lane has neither color nor name (web board-view.tsx:101-105
    // gives it the plain "No value" title).
    label = column.propertyOptionName ?? t("filter.noPropertyValue");
    leading = column.propertyOptionColor ? (
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: column.propertyOptionColor,
        }}
      />
    ) : (
      <View className="w-[18px]" />
    );
  } else if (column.unassigned) {
    label = translate("filter.noAssignee");
    leading = <View className="w-[18px]" />;
  } else {
    label = getName(column.assigneeType, column.assigneeId);
    leading = (
      <ActorAvatar type={column.assigneeType} id={column.assigneeId} size={16} />
    );
  }
  return (
    <View className="flex-row items-center gap-2 px-1 pb-2">
      {leading}
      <Text
        numberOfLines={1}
        className="flex-shrink text-xs uppercase tracking-wider font-medium text-muted-foreground"
      >
        {label}
      </Text>
      <Text className="ml-auto text-xs text-muted-foreground/60">
        {column.data.length}
      </Text>
      {/* Column-header quick create (web board-column.tsx:226-246, whose
          `+` sits opposite the lane title). The new issue is seeded with
          the column's own status / assignee, so "add here" means here. */}
      {onCreateIssue ? (
        <Pressable
          onPress={() => onCreateIssue(column)}
          hitSlop={10}
          className="active:opacity-60"
          accessibilityRole="button"
          accessibilityLabel={t("issues.boardAddIssue")}
        >
          <Ionicons
            name="add"
            size={15}
            color={THEME[colorScheme].mutedForeground}
          />
        </Pressable>
      ) : null}
      {/* Hide-column entry, status lanes only (a property / assignee lane has
          no status to filter on). */}
      {onHideStatus && column.status ? (
        <Pressable
          onPress={() =>
            !statusFixedByView && onHideStatus(column.status as IssueStatus)
          }
          disabled={statusFixedByView}
          hitSlop={10}
          className={statusFixedByView ? "opacity-30" : "active:opacity-60"}
          accessibilityRole="button"
          accessibilityState={{ disabled: statusFixedByView }}
          accessibilityLabel={t("issues.boardHideColumn")}
        >
          <Ionicons
            name="eye-off-outline"
            size={15}
            color={THEME[colorScheme].mutedForeground}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The restore lane: every status currently hidden, one tap to bring back.
 *
 * web renders this as a fixed rail beside the board
 * (`BoardHiddenColumnsPanel` → `HiddenColumnsPanel`). A phone's board is
 * already wider than the screen, so the rail becomes the LAST lane instead —
 * it is reachable by the same horizontal scroll that reached the columns
 * before it, and it disappears entirely when nothing is hidden.
 */
function HiddenColumnsLane({
  statuses,
  onShowStatus,
}: {
  statuses: IssueStatus[];
  onShowStatus: (status: IssueStatus) => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const statusLabel = useStatusLabel();
  const dim = THEME[colorScheme].mutedForeground;

  return (
    <View
      style={{ width: BOARD_COLUMN_WIDTH * 0.85, alignSelf: "stretch" }}
      className="flex-col rounded-lg border border-dashed border-border bg-background/40"
      accessibilityLabel={t("issues.boardHiddenColumns")}
    >
      <View className="px-3 pt-3 pb-2 flex-row items-center gap-2">
        <Ionicons name="eye-off-outline" size={14} color={dim} />
        <Text className="text-xs uppercase tracking-wider font-medium text-muted-foreground">
          {t("issues.boardHiddenColumns")}
        </Text>
      </View>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 8 }}
      >
        {statuses.map((status) => (
          <Pressable
            key={status}
            onPress={() => onShowStatus(status)}
            className="mx-2 mb-1 flex-row items-center gap-2 rounded-lg bg-secondary/30 px-2.5 py-2.5 active:bg-secondary"
            accessibilityRole="button"
            accessibilityLabel={t("issues.boardShowColumn", {
              name: statusLabel(status),
            })}
          >
            <StatusIcon status={status} size={14} />
            <Text numberOfLines={1} className="flex-1 text-sm text-foreground">
              {statusLabel(status)}
            </Text>
            <Ionicons name="eye-outline" size={15} color={dim} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const BoardColumn = memo(function BoardColumn({
  column,
  onOpenIssue,
  onCreateIssue,
  onHideStatus,
  isStatusFixed,
}: {
  column: IssueGroupSection;
  onOpenIssue: (issue: Issue) => void;
  onCreateIssue?: (section: IssueGroupSection) => void;
  onHideStatus?: (status: IssueStatus) => void;
  isStatusFixed?: (status: IssueStatus) => boolean;
}) {
  const renderItem = useCallback(
    ({ item }: { item: Issue }) => (
      <View className="px-2 pb-2">
        <IssueCardWithMenu issue={item} onOpen={() => onOpenIssue(item)} />
      </View>
    ),
    [onOpenIssue],
  );

  return (
    <View
      style={{ width: BOARD_COLUMN_WIDTH, alignSelf: "stretch" }}
      className="flex-col rounded-lg border border-border bg-background/60"
    >
      <View className="px-2 pt-2">
        <ColumnHeader
          column={column}
          onCreateIssue={onCreateIssue}
          onHideStatus={onHideStatus}
          statusFixedByView={
            !!column.status && !!isStatusFixed?.(column.status)
          }
        />
      </View>
      {column.data.length === 0 ? (
        <View className="flex-1 items-center justify-center px-4 pb-6">
          <Text className="text-xs text-muted-foreground/50">
            {translate("issues.boardEmptyColumn")}
          </Text>
        </View>
      ) : (
        <FlatList
          data={column.data}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
          // Boards can hold dozens of cards; cap batch/initial renders so
          // a board with many issues doesn't paint every card at once.
          // `windowSize` scales the render window per column — the default
          // 21 (viewports) is far past what a 272pt lane shows.
          initialNumToRender={6}
          windowSize={7}
          maxToRenderPerBatch={8}
          updateCellsBatchingPeriod={40}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 8 }}
        />
      )}
    </View>
  );
});

/**
 * Board card + long-press "move to status" menu (web board-view drag parity:
 * the phone has no drag-and-drop, so the long-press action sheet is the
 * move mechanism — the same status mutation the detail page's picker uses).
 * Tap still opens the issue; long-press on the current status re-commits the
 * same value (a no-op server-side, harmless).
 */
function IssueCardWithMenu({
  issue,
  onOpen,
}: {
  issue: Issue;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const updateIssue = useUpdateIssue(issue.id);
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  // Shared with the picker/filter — every entry point that can set a status
  // offers the same set (catalog active statuses incl. custom keys).
  const { options } = useStatusOptions(wsId);

  const onLongPress = () => {
    const labels = options.map((o) => o.label);
    const optionKeys = options.map((o) => o.key);
    const optionsWithCancel = [...labels, t("common.cancel")];
    ActionSheet.showActionSheetWithOptions(
      {
        title: t("filter.moveToStatus"),
        options: optionsWithCancel,
        cancelButtonIndex: optionsWithCancel.length - 1,
      },
      (index) => {
        if (index == null || index >= optionKeys.length) return;
        updateIssue.mutate({ status: optionKeys[index] });
      },
    );
  };

  return <BoardCard issue={issue} onPress={onOpen} onLongPress={onLongPress} />;
}

export function BoardView({
  issues,
  grouping,
  statusOrder,
  groupingProperty,
  onOpenIssue,
  onCreateIssue,
  emptyLabel,
  hiddenStatuses,
  onHideStatus,
  onShowStatus,
  isStatusFixed,
  allStatusesHidden = false,
}: {
  issues: Issue[];
  grouping: IssueGrouping;
  statusOrder: readonly IssueStatus[];
  /**
   * Resolved `select` definition when `grouping` is `property:<id>` — the
   * caller owns the catalog lookup (web board-view.tsx:187-190 does the
   * same). Absent/`null` means the grouping key is stale or the catalog has
   * not loaded, and `groupIssues` falls back to status lanes.
   */
  groupingProperty?: IssueProperty | null;
  onOpenIssue: (issue: Issue) => void;
  /**
   * Column-header quick create. Receives the COLUMN, so the caller can seed
   * the new-issue form with that lane's status / assignee (web
   * `onCreateIssue(group.createData)` — board-column.tsx:226-246). Omitted
   * on surfaces with no create flow, which hides the `+` entirely.
   */
  onCreateIssue?: (section: IssueGroupSection) => void;
  emptyLabel: string;
  /**
   * Status columns the surface has hidden, in board order. Derived by the
   * caller from the shared filter slice (`hiddenStatuses(statusFilters)`), so
   * the board and the server window can never disagree about which lanes are
   * gone. Supplying `onHideStatus` turns on the per-column hide entry.
   */
  hiddenStatuses?: IssueStatus[];
  onHideStatus?: (status: IssueStatus) => void;
  onShowStatus?: (status: IssueStatus) => void;
  /** Statuses pinned by the open saved view — not hideable (web
   *  board-column.tsx:119-122). */
  isStatusFixed?: (status: IssueStatus) => boolean;
  /** Every status column is hidden. The surface owns this because only it can
   *  tell "hidden everything" from "the filter matched nothing". */
  allStatusesHidden?: boolean;
}) {
  const { t } = useTranslation();
  const visibleHidden =
    grouping === "status" ? (hiddenStatuses ?? []) : [];
  const columns = useMemo(
    () => groupIssues(issues, grouping, statusOrder, true, undefined, groupingProperty),
    [issues, grouping, statusOrder, groupingProperty],
  );

  // A board whose every lane is hidden has no columns at all. This is
  // distinguishable from "no issues match" only by the STATUS FILTER being
  // what emptied it, so the surface passes `allStatusesHidden` rather than the
  // board guessing from an empty `issues` (an ordinary empty filter result
  // must keep its own message).
  if (allStatusesHidden) {
    return (
      <View className="flex-1">
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-sm text-muted-foreground text-center">
            {t("issues.boardAllHidden")}
          </Text>
        </View>
        {visibleHidden.length > 0 ? (
          <HiddenColumnsLane
            statuses={visibleHidden}
            onShowStatus={(s) => onShowStatus?.(s)}
          />
        ) : null}
      </View>
    );
  }

  if (issues.length === 0) {
    return (
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-sm text-muted-foreground text-center">
          {emptyLabel}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      className="flex-1"
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        paddingHorizontal: 12,
        paddingTop: 10,
        gap: 10,
        alignItems: "stretch",
        flexGrow: 1,
      }}
    >
      {columns.map((column) => (
        <BoardColumn
          key={column.key}
          column={column}
          onOpenIssue={onOpenIssue}
          onCreateIssue={onCreateIssue}
          onHideStatus={onHideStatus}
          isStatusFixed={isStatusFixed}
        />
      ))}
      {visibleHidden.length > 0 ? (
        <HiddenColumnsLane
          statuses={visibleHidden}
          onShowStatus={(s) => onShowStatus?.(s)}
        />
      ) : null}
    </ScrollView>
  );
}