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
 *   - Tap a card → open the issue (detail route owns edits).
 *   - Status columns can be hidden (web `board-column.tsx:215`). Hiding
 *     writes `statusFilters` in the shared filter slice, so the hidden lanes
 *     disappear from the board AND from the server window at once — see
 *     `hideStatus` in issue-filter-slice.ts. Web parks the restore list in a
 *     fixed side rail; a phone has no room for one, so the hidden statuses
 *     render as a trailing lane at the end of the board.
 *
 * ## Drag-to-reorder (iteration 176, G6)
 *
 * Web's board is a dnd-kit surface: `DndContext` + `DragOverlay`, with
 * `useDragSettle` holding drag/settle locks and `useBoardDragPan` panning when
 * the pointer reaches an edge. A phone has no dnd-kit, and its two scrollers
 * (the board's horizontal one, each lane's vertical one) own exactly the
 * gestures a drag needs — so this is a hand-built port of the same contract,
 * not a library swap.
 *
 * ### Gesture arbitration (the part a phone forces you to decide)
 *
 *   - **Lift**: long-press (350ms) on a card lifts it. Both scrollers freeze
 *     for the duration (`scrollEnabled`), so the finger owns the gesture from
 *     lift to drop and neither a lane nor the board can slide out from under
 *     the card. Freezing them at lift — while the finger is still stationary —
 *     is also what lets the board's JS responder win the move that follows:
 *     the native ScrollViews have already given up their claim by then.
 *     That race is the reason the lift render is kept CHEAP: `dragApi` is
 *     referentially stable and every callback the lanes receive is a
 *     `useCallback` with stable deps, so `setDrag` re-renders the board shell
 *     and at most the two lanes whose props actually changed — never every
 *     card. A lift that re-rendered the whole board took longer than Android's
 *     touch slop, and the board's horizontal ScrollView intercepted the drag
 *     before `scrollEnabled={false}` reached it.
 *   - **Which lane, and which slot** (`resolveDropTarget`): the finger's X is
 *     converted into board CONTENT space (adding the board's scroll offset)
 *     and hit-tested against the lanes' measured frames. Content space, not
 *     viewport space, is what makes edge auto-pan work: as the board scrolls,
 *     the lane under a STATIONARY finger changes by itself, so holding at the
 *     edge walks the board lane by lane. Inside the lane the slot comes from
 *     an ABSOLUTE hit test against the target lane's midpoints — but only when
 *     that lane is not the origin, because the origin lane still holds the
 *     dragged card and an absolute test there measures the finger against the
 *     card's own frame (a grab below its midpoint read as "one slot down"
 *     before the user moved at all). Same-lane slots are incremental instead,
 *     off the finger's displacement since the lift.
 *   - **Edge auto-pan**: inside `EDGE_PAN_ZONE` of either edge the board pans
 *     at up to `EDGE_PAN_MAX_STEP` per frame, ramped by depth (`edgePanStep`).
 *     An animation-frame loop runs only while the finger is in a zone and only
 *     while the gesture is live.
 *   - **Drop**: the release resolves `(lane, slot)`. A drop that changed
 *     nothing writes nothing. A lift the user released WITHOUT ever entering
 *     another slot opens the long-press status action sheet instead — so the
 *     pre-drag muscle memory ("hold a card to change its status") survives the
 *     feature that took its gesture. `onResponderTerminate` (the gesture taken
 *     away) always snaps back and never writes.
 *
 * ### Why the dragged card never leaves its lane
 *
 * The card stays exactly where it is in its origin lane for the whole gesture,
 * dimmed, and the drop slot is drawn as a separate placeholder row. Two things
 * force that: moving the card would reorder the lane's children and detach its
 * native view (Android cancels the touch), and unmounting it would drop the
 * Pressable that owns the gesture before the board has taken it over — which
 * is the path a lift that never moves depends on.
 *
 * Because the card is still IN the list, the origin lane's placeholder slot
 * alone would leave the lane one row taller than it will be after the drop, so
 * the lane jumped a row at lift. The origin row therefore COLLAPSES (zero
 * height, still mounted) for as long as the drop targets somewhere else, which
 * keeps the lane's total height constant and makes the preview exact.
 *
 * ### Locks (web `useDragSettle` parity)
 *
 * Web freezes its local column mirror while dragging AND while the move
 * mutation is settling, so neither a cache push nor the settle refetch can
 * yank a card mid-flight. Mobile derives its lanes straight from the TanStack
 * cache, so the equivalent is: render from the lane order FROZEN AT LIFT while
 * the gesture is live, keep it through `settledLaneIds` (the mutation's
 * flight), and only then fall back to the cache-derived order — one resync,
 * after the move landed. A failed move releases the lock on the error path
 * too, and the mutation's own `onError` rolls the optimistic patch back, so
 * the card returns to its origin.
 *
 * ### Deliberate boundaries
 *
 *   - A drop writes only when the target lane can express the change:
 *     `status` and `assignee` lanes are fields of `MoveIssueRequest`, and a
 *     select-property lane's value rides alongside through
 *     `useSetIssueProperty` (web's `applyPropertyGroupValue`,
 *     board-view.tsx:517-521). The trailing hidden-columns lane is not a drop
 *     target — its statuses feed the server window, so their issues are not
 *     even loaded.
 *   - Same-lane reordering is only offered under `sortBy === "position"`.
 *     Under any other sort the on-screen order is not the server's position
 *     order, so "slot 3" would name a place the move API cannot express. Cross
 *     lane moves still work — they are a group change (web board-view.tsx:464
 *     makes the same split).
 */
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FlatList,
  Pressable,
  ScrollView,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
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
import {
  useSetIssueProperty,
  useUnsetIssueProperty,
} from "@/data/mutations/properties";
import { useWorkspaceStore } from "@/data/workspace-store";
import type { IssueGrouping } from "@/data/stores/issue-filter-slice";
import { useActorLookup } from "@/data/use-actor-name";
import { groupIssues, type IssueGroupSection } from "@/lib/filter-issues";
import {
  CARD_HEIGHT_FALLBACK,
  LANE_GAP,
  BOARD_PADDING,
  edgePanStep,
  insertIdByPosition,
  moveAnchors,
  moveWithinLanes,
  provisionalPosition,
  resolveDropTarget,
  rowFrames,
  storedLaneOrder,
  type LaneFrame,
  type RowFrame,
} from "@/lib/board-drag";
import { BoardCard, BOARD_COLUMN_WIDTH } from "./board-card";

/** Card row wrapper's horizontal padding (`px-2`) — one side. */
const ROW_PADDING_X = 8;
/** Card row wrapper's bottom padding (`pb-2`) — the gap between two cards. */
const ROW_GAP = 8;

/**
 * The drop indicator's synthetic row id. The lifted card keeps its real row in
 * its origin lane — swapping it for a placeholder would unmount the Pressable
 * that owns the gesture, and a lift the user released without moving would then
 * never end — so the slot the card would land in is drawn as an extra row
 * instead. It never reaches a list keyed by issue, and the commit works from
 * `cacheLaneIds`, not from this.
 */
const DROP_PLACEHOLDER = "\u0000board-drop-placeholder";

/**
 * What the lanes read for the lift's own visuals — the dimmed card and the
 * collapsed origin row.
 *
 * Deliberately a REF rather than props: these three values change at lift and
 * again on every slot the drop crosses, and as props they would change the
 * lanes' `renderItem` identity. FlatList re-renders every mounted cell when
 * `renderItem` changes, so the lift would re-render all ~25 cards on the board
 * — and a lift render that slow loses the race against Android's touch slop,
 * letting a native scroller intercept the drag before `scrollEnabled={false}`
 * reaches it. Instead `renderItem` stays referentially stable and the lanes
 * that actually need to repaint are named explicitly through `extraData`.
 */
type LiftState = {
  liftedId: string | null;
  collapsedId: string | null;
  /** Measured height of the lifted card — the drop indicator matches it. */
  placeholderHeight: number;
};

/** The one method the freeze needs from a scroller. */
type NativeScroller = { setNativeProps: (props: { scrollEnabled: boolean }) => void };

type ScrollerLike = {
  getNativeScrollRef?: () => unknown;
  setNativeProps?: unknown;
};

/**
 * The HOST view behind a scroller ref, which is the only one whose
 * `setNativeProps` writes straight to the native view.
 *
 * A `FlatList` ref is the list, and its `getNativeScrollRef()` is the
 * `ScrollView` *component* — neither of which implements `setNativeProps` all
 * the way down (`VirtualizedList.setNativeProps` forwards to a ref that does
 * not define it, so it throws). Walking to the end of the chain lands on the
 * Fabric host node, which does.
 */
function nativeScroller(ref: unknown): NativeScroller | null {
  let node = ref as ScrollerLike | null | undefined;
  for (let depth = 0; node && depth < 4; depth += 1) {
    if (typeof node.getNativeScrollRef !== "function") break;
    const next = node.getNativeScrollRef() as ScrollerLike | null | undefined;
    if (!next || next === node) break;
    node = next;
  }
  return node && typeof node.setNativeProps === "function"
    ? (node as NativeScroller)
    : null;
}

/** A lane's geometry, captured at lift and frozen for the whole gesture. */
type DragSnapshot = {
  /** Droppable lanes, board order, in board CONTENT coordinates. */
  lanes: LaneFrame[];
  /** Each lane's issue ids in RENDER order at lift. The drag renders from this
   *  rather than from the live cache: a push that reorders a lane mid-gesture
   *  would otherwise slide every measured slot out from under the finger. */
  laneIds: Record<string, string[]>;
  /** Card frames per lane key, in that lane's CONTENT coordinates. */
  rows: Record<string, RowFrame[]>;
  /** Window Y of each lane's list viewport top: `fingerY - this + scrollY`
   *  is the finger's position in that lane's content space. */
  listTop: Record<string, number>;
  /** Each lane's vertical scroll offset, frozen at lift (lane scrolling is
   *  disabled for the gesture, so it cannot change). */
  scrollY: Record<string, number>;
  /** The board's own frame in window coordinates. */
  board: { x: number; y: number; width: number };
};

type DragState = {
  issueId: string;
  originLaneKey: string;
  originIndex: number;
  /** Finger offset from the card's top edge, so the overlay does not jump. */
  grabOffsetY: number;
  /** Window Y of the finger at lift. The same-lane slot is measured as the
   *  displacement from here, so a lift that never moved targets its origin
   *  slot no matter where inside the card the finger landed. */
  liftFingerY: number;
  targetLaneKey: string;
  targetIndex: number;
  /** Window coordinates of the finger — where the overlay is painted. */
  fingerX: number;
  fingerY: number;
  /** The card has entered a different slot at least once this gesture. */
  moved: boolean;
  /** Geometry frozen at lift. A stable reference for the whole gesture, which
   *  is what lets the lanes' memo comparison survive the per-frame finger
   *  updates. */
  snapshot: DragSnapshot;
};

/** The move the board asks a card to perform on drop. */
type BoardMoveVars = {
  status?: IssueStatus;
  assignee_type?: "member" | "agent" | "squad" | null;
  assignee_id?: string | null;
  position: number;
  move_intent: { before_id: string | null; after_id: string | null };
};

/**
 * What a card lends the board for the length of a gesture. The move mutation
 * is bound to an issue id, so only the card can run it; the status sheet lives
 * there for the same reason.
 */
type CardHandle = {
  commit: (vars: BoardMoveVars, onSettled: () => void) => void;
  openStatusSheet: () => void;
};

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
 * before it, and it disappears entirely when nothing is hidden. It is not a
 * drop target: a hidden status's issues are not in the server window at all.
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

/**
 * What a lifted card leaves behind. Rendered at the measured height of the
 * card it replaces so nothing below it shifts — a placeholder of a different
 * height makes the lane jump at the moment of the lift, which reads as the
 * board having lost the card.
 */
function CardPlaceholder({ height }: { height: number }) {
  return (
    <View
      style={{ height: Math.max(height - ROW_GAP, 24) }}
      className="rounded-lg border border-dashed border-border/70 bg-secondary/20"
    />
  );
}

/**
 * Board card + its share of the drag.
 *
 * Long-press is shared with the drag: it lifts the card, and the status sheet
 * opens instead when the gesture ends without the board ever taking the
 * responder (see the `onPressOut` note below). A board rendered without a drag
 * layer has no responder to take the gesture, so long-press goes straight to
 * the sheet — the pre-176 behaviour, kept as the fallback path.
 */
function IssueCardWithMenu({
  issue,
  onOpen,
  lifted = false,
  onLift,
  onLiftEnd,
  boardCaptured,
  registerCard,
}: {
  issue: Issue;
  onOpen: () => void;
  /** This card is the one currently lifted. */
  lifted?: boolean;
  onLift?: (event: GestureResponderEvent) => void;
  /**
   * The board's responder never took the gesture, so the finger has lifted
   * without a drop. Read one frame late so a capture landing in the same event
   * batch still counts.
   */
  onLiftEnd?: () => void;
  /** Whether the board's responder owns the current gesture. */
  boardCaptured: React.RefObject<boolean>;
  registerCard?: (id: string, handle: CardHandle | null) => void;
}) {
  const { t } = useTranslation();
  const updateIssue = useUpdateIssue(issue.id);
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  // Shared with the picker/filter — every entry point that can set a status
  // offers the same set (catalog active statuses incl. custom keys).
  const { options } = useStatusOptions(wsId);

  const showStatusSheet = useCallback(() => {
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
  }, [options, t, updateIssue]);

  // The board drives the drop but the mutation hook is bound to an issue id,
  // so the card lends its own mutate (and its sheet) to the board. Refs keep
  // the handle stable, so registering it does not churn the board's map.
  const mutateRef = useRef(updateIssue.mutate);
  mutateRef.current = updateIssue.mutate;
  const sheetRef = useRef(showStatusSheet);
  sheetRef.current = showStatusSheet;
  useEffect(() => {
    if (!registerCard) return;
    registerCard(issue.id, {
      commit: (vars, onSettled) =>
        mutateRef.current(vars, { onSettled }),
      openStatusSheet: () => sheetRef.current(),
    });
    return () => registerCard(issue.id, null);
  }, [registerCard, issue.id]);

  /** Set by the long-press below; read once by `onPressOut`. */
  const liftedByPress = useRef(false);

  return (
    <BoardCard
      issue={issue}
      onPress={onOpen}
      dimmed={lifted}
      onLongPress={
        onLift
          ? (event) => {
              liftedByPress.current = true;
              onLift(event);
            }
          : showStatusSheet
      }
      onPressOut={() => {
        // The card must stay mounted while it is lifted (it is only dimmed,
        // never swapped for a placeholder) or this would never run: the board
        // only ever takes the responder on a MOVE, so a lift the user released
        // without moving would leave the board stuck holding a card forever.
        // Deferred one frame because a capture that lands in the same event
        // batch as this terminate has not necessarily raised the flag yet.
        if (!liftedByPress.current) return;
        liftedByPress.current = false;
        requestAnimationFrame(() => {
          if (boardCaptured.current) return;
          onLiftEnd?.();
        });
      }}
      accessibilityHint={onLift ? t("issues.boardCardHint") : undefined}
      accessibilityActions={[
        { name: "moveToStatus", label: t("filter.moveToStatus") },
      ]}
      onAccessibilityAction={(actionName) => {
        // A screen reader cannot drag, so the sheet stays reachable this way
        // on every board — drag or no drag.
        if (actionName === "moveToStatus") showStatusSheet();
      }}
    />
  );
}

/** Everything the lanes need from the drag layer, in one stable object.
 *
 *  Deliberately free of anything that changes per frame: the lanes are
 *  memoized, and a `dragApi` whose identity moved with the finger would bust
 *  that memo and re-render every card on the board 60 times a second — the
 *  cost that let the native scroller win the gesture race at lift. */
type BoardDragApi = {
  cardHeights: React.RefObject<Record<string, number>>;
  boardCaptured: React.RefObject<boolean>;
  /** The lift's own visuals, read by the cells rather than passed to them —
   *  see `LiftState` for why this is a ref. */
  lift: React.RefObject<LiftState>;
  /** A lane's scroller, for the out-of-band freeze — see `freezeScrollers`. */
  registerLane: (key: string, list: unknown) => void;
  registerCard: (id: string, handle: CardHandle | null) => void;
  onCardLayout: (id: string, e: LayoutChangeEvent) => void;
  onLaneLayout: (key: string, e: LayoutChangeEvent) => void;
  onLaneListLayout: (key: string, e: LayoutChangeEvent) => void;
  onLaneScroll: (key: string, e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onCardLift: (
    column: IssueGroupSection,
    issue: Issue,
    event: GestureResponderEvent,
  ) => void;
  /** The lifted card's Pressable saw the finger leave without the board ever
   *  taking the responder — the gesture is over and nothing was dragged. */
  onLiftEnd: () => void;
};

const BoardColumn = memo(function BoardColumn({
  column,
  laneIds,
  issueById,
  onOpenIssue,
  onCreateIssue,
  onHideStatus,
  isStatusFixed,
  dragApi,
  dragging,
  extraData,
}: {
  column: IssueGroupSection;
  /** The lane's issue ids in RENDER order — the order frozen at lift (or the
   *  settle lock's) plus the drop placeholder, never the live cache. */
  laneIds: string[];
  issueById: Map<string, Issue>;
  onOpenIssue: (issue: Issue) => void;
  onCreateIssue?: (section: IssueGroupSection) => void;
  onHideStatus?: (status: IssueStatus) => void;
  isStatusFixed?: (status: IssueStatus) => boolean;
  dragApi: BoardDragApi;
  /** A card is lifted somewhere on the board. A plain boolean, not part of
   *  `dragApi`, so a per-frame finger update cannot change it. */
  dragging: boolean;
  /**
   * Changes exactly when THIS lane's cells need to repaint for the lift (its
   * card was lifted, its origin row collapsed, or its indicator's height was
   * measured). `null` for every other lane, so the lanes the drag is not
   * touching keep their mounted cells across the whole gesture — which is what
   * keeps the lift render fast enough to freeze the scrollers in time.
   */
  extraData: string | null;
}) {
  const {
    onCardLayout,
    onLaneLayout,
    onLaneListLayout,
    onLaneScroll,
    onCardLift,
    onLiftEnd,
    boardCaptured,
    registerCard,
    registerLane,
    lift,
  } = dragApi;
  const laneRef = useCallback(
    (list: unknown) => registerLane(column.key, list),
    [registerLane, column.key],
  );
  const renderItem = useCallback(
    ({ item }: { item: string }) => {
      if (item === DROP_PLACEHOLDER) {
        return (
          <View className="px-2 pb-2">
            <CardPlaceholder height={lift.current.placeholderHeight} />
          </View>
        );
      }
      const issue = issueById.get(item);
      if (!issue) return null;
      const collapsedId = lift.current.collapsedId;
      const collapsed = item === collapsedId;
      // A zero-height WRAPPER around the card, never a replacement for it. The
      // card has to stay mounted for two reasons: its Pressable is the only
      // path back for a lift the board never captured, and its `registerCard`
      // effect is what puts the move handle in the board's map — rendering a
      // bare View here instead unregistered that handle, and the drop then
      // committed nothing at all (verified on-device: `commit` ran, no request
      // left the app).
      return (
        <View
          className={collapsed ? undefined : "px-2 pb-2"}
          style={collapsed ? { height: 0, overflow: "hidden" } : undefined}
          onLayout={(e: LayoutChangeEvent) => onCardLayout(issue.id, e)}
        >
          <IssueCardWithMenu
            issue={issue}
            onOpen={() => onOpenIssue(issue)}
            lifted={issue.id === lift.current.liftedId}
            onLift={(event) => onCardLift(column, issue, event)}
            onLiftEnd={onLiftEnd}
            boardCaptured={boardCaptured}
            registerCard={registerCard}
          />
        </View>
      );
    },
    [
      onOpenIssue,
      onCardLift,
      onLiftEnd,
      column,
      issueById,
      onCardLayout,
      boardCaptured,
      registerCard,
      lift,
    ],
  );

  return (
    <View
      style={{ width: BOARD_COLUMN_WIDTH, alignSelf: "stretch" }}
      className="flex-col rounded-lg border border-border bg-background/60"
      onLayout={(e) => onLaneLayout(column.key, e)}
    >
      <View className="px-2 pt-2">
        <ColumnHeader
          column={column}
          onCreateIssue={onCreateIssue}
          onHideStatus={onHideStatus}
          statusFixedByView={!!column.status && !!isStatusFixed?.(column.status)}
        />
      </View>
      {laneIds.length === 0 ? (
        <View className="flex-1 items-center justify-center px-4 pb-6">
          <Text className="text-xs text-muted-foreground/50">
            {translate("issues.boardEmptyColumn")}
          </Text>
        </View>
      ) : (
        <FlatList
          ref={laneRef}
          data={laneIds}
          keyExtractor={(item) => item}
          renderItem={renderItem}
          extraData={extraData}
          nestedScrollEnabled
          // Frozen for the gesture: a lane that scrolls under a lifted card
          // changes the slot the finger is over without the finger moving.
          scrollEnabled={!dragging}
          onLayout={(e) => onLaneListLayout(column.key, e)}
          onScroll={(e) => onLaneScroll(column.key, e)}
          scrollEventThrottle={16}
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
  sortBy = "position",
  sortDirection = "asc",
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
  /**
   * The surface's active sort. Same-lane reordering is only offered under
   * `position`: under any other sort the on-screen order is not the server's
   * position order, so the slot a drop names would not mean what it says.
   * Cross-lane moves are offered under every sort (web board-view.tsx:464-520
   * makes the same split).
   */
  sortBy?: string;
  /**
   * Direction of that sort. Descending `position` renders the lane in exactly
   * the reverse of the server's order, so a drop's slot has to be flipped back
   * before it can name a place (`sortDirection === "desc"`).
   */
  sortDirection?: "asc" | "desc";
}) {
  const { t } = useTranslation();
  const setProperty = useSetIssueProperty();
  const unsetProperty = useUnsetIssueProperty();
  const visibleHidden = grouping === "status" ? (hiddenStatuses ?? []) : [];
  const columns = useMemo(
    () =>
      groupIssues(
        issues,
        grouping,
        statusOrder,
        true,
        undefined,
        groupingProperty,
      ),
    [issues, grouping, statusOrder, groupingProperty],
  );

  const issueById = useMemo(() => {
    const map = new Map<string, Issue>();
    for (const issue of issues) map.set(issue.id, issue);
    return map;
  }, [issues]);

  const cacheLaneIds = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const column of columns) map[column.key] = column.data.map((i) => i.id);
    return map;
  }, [columns]);

  const sectionByKey = useMemo(() => {
    const map = new Map<string, IssueGroupSection>();
    for (const column of columns) map.set(column.key, column);
    return map;
  }, [columns]);

  // ---- drag layer -------------------------------------------------------
  const boardRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  const boardWindowRef = useRef({ x: 0, y: 0, width: 0 });
  const scrollXRef = useRef(0);
  const maxScrollXRef = useRef(0);
  const contentWidthRef = useRef(0);
  const laneLayoutRef = useRef<
    Record<string, { x: number; y: number; width: number }>
  >({});
  const laneListYRef = useRef<Record<string, number>>({});
  const laneScrollYRef = useRef<Record<string, number>>({});
  const cardHeightsRef = useRef<Record<string, number>>({});
  const snapshotRef = useRef<DragSnapshot | null>(null);
  const cardsRef = useRef(new Map<string, CardHandle>());
  /** The lift's own visuals. Written every render, read by the cells; see
   *  `LiftState` for why it is not props. */
  const liftRef = useRef<LiftState>({
    liftedId: null,
    collapsedId: null,
    placeholderHeight: CARD_HEIGHT_FALLBACK,
  });
  const panPointRef = useRef({ x: 0, y: 0 });
  const panLoopRef = useRef<number | null>(null);
  /** Whether the board's responder owns the gesture in flight. Read by the
   *  card on release to decide between a drop and the status sheet. */
  const boardCapturedRef = useRef(false);

  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  /** The lane order frozen from the drop until the move mutation settles. */
  const [settledLaneIds, setSettledLaneIds] = useState<Record<
    string,
    string[]
  > | null>(null);

  const measureBoard = useCallback(() => {
    boardRef.current?.measureInWindow((x, y, width) => {
      boardWindowRef.current = { x, y, width };
      maxScrollXRef.current = Math.max(contentWidthRef.current - width, 0);
    });
  }, []);

  const registerCard = useCallback((id: string, handle: CardHandle | null) => {
    if (handle) cardsRef.current.set(id, handle);
    else cardsRef.current.delete(id);
  }, []);

  /**
   * The lanes' scroller refs, kept RAW and resolved on demand.
   *
   * Resolving at registration time does not work: a `FlatList`'s ref callback
   * fires while the list is still mounting, so its inner `ScrollView` (and the
   * host node behind it) does not exist yet and the lane would register
   * nothing for the rest of the session — measured on-device as 4 of 7 lanes
   * registered, which left the other three free to steal the drag.
   */
  const laneScrollersRef = useRef(new Map<string, unknown>());
  const registerLane = useCallback((key: string, list: unknown) => {
    if (list) laneScrollersRef.current.set(key, list);
    else laneScrollersRef.current.delete(key);
  }, []);

  /**
   * Freeze / thaw the board's and the lanes' scrollers OUT OF BAND.
   *
   * The `scrollEnabled` props below are the state the screen is meant to be
   * in, but a prop only reaches the native view after a full React commit —
   * measured at ~220ms on the Pixel 5, most of it the 212-card lane's
   * FlatList. Android hands a gesture to a native scroller as soon as it
   * passes touch slop, which is tens of milliseconds, so by the time that
   * commit landed the lane had already claimed the drag and the card snapped
   * home. Writing the prop straight to the native views at lift closes that
   * window: the commit that follows carries the same value, so the two never
   * disagree.
   */
  const freezeScrollers = useCallback((frozen: boolean) => {
    const board = nativeScroller(scrollRef.current);
    board?.setNativeProps({ scrollEnabled: !frozen });
    let lanes = 0;
    for (const ref of laneScrollersRef.current.values()) {
      const lane = nativeScroller(ref);
      if (!lane) continue;
      lane.setNativeProps({ scrollEnabled: !frozen });
      lanes += 1;
    }
  }, []);

  const onCardLayout = useCallback((id: string, e: LayoutChangeEvent) => {
    const { height } = e.nativeEvent.layout;
    if (height > 0) cardHeightsRef.current[id] = height;
  }, []);

  const onLaneLayout = useCallback((key: string, e: LayoutChangeEvent) => {
    const { x, y, width } = e.nativeEvent.layout;
    laneLayoutRef.current[key] = { x, y, width };
  }, []);

  const onLaneListLayout = useCallback((key: string, e: LayoutChangeEvent) => {
    laneListYRef.current[key] = e.nativeEvent.layout.y;
  }, []);

  const onLaneScroll = useCallback(
    (key: string, e: NativeSyntheticEvent<NativeScrollEvent>) => {
      laneScrollYRef.current[key] = e.nativeEvent.contentOffset.y;
    },
    [],
  );

  const onBoardScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollXRef.current = e.nativeEvent.contentOffset.x;
    },
    [],
  );

  /**
   * Freeze the geometry a drop needs. Read once, at lift: both scrollers are
   * frozen for the gesture, so nothing in here can change under the finger,
   * and re-measuring per frame would be slower AND less consistent — a lane
   * mid-layout would answer differently from the frame the user is looking at.
   */
  const takeSnapshot = useCallback((): DragSnapshot => {
    const board = boardWindowRef.current;
    const lanes: LaneFrame[] = [];
    const laneIds: Record<string, string[]> = {};
    const rows: Record<string, RowFrame[]> = {};
    const listTop: Record<string, number> = {};
    const scrollY: Record<string, number> = {};
    for (const column of columns) {
      const layout = laneLayoutRef.current[column.key];
      if (!layout) continue;
      lanes.push({ key: column.key, x: layout.x, width: layout.width });
      const ids = cacheLaneIds[column.key] ?? [];
      laneIds[column.key] = ids;
      rows[column.key] = rowFrames(ids, cardHeightsRef.current);
      listTop[column.key] =
        board.y + layout.y + (laneListYRef.current[column.key] ?? 0);
      scrollY[column.key] = laneScrollYRef.current[column.key] ?? 0;
    }
    return { lanes, laneIds, rows, listTop, scrollY, board };
  }, [columns, cacheLaneIds]);

  /** Resolve a window-space finger position to a lane + slot. */
  const resolveTarget = useCallback((fingerX: number, fingerY: number) => {
    const snap = snapshotRef.current;
    const current = dragRef.current;
    if (!snap || !current) return null;
    return resolveDropTarget({
      lanes: snap.lanes,
      laneIds: snap.laneIds,
      rows: snap.rows,
      listTop: snap.listTop,
      scrollY: snap.scrollY,
      cardHeights: cardHeightsRef.current,
      boardX: snap.board.x,
      boardScrollX: scrollXRef.current,
      fingerX,
      fingerY,
      originLaneKey: current.originLaneKey,
      originIndex: current.originIndex,
      liftFingerY: current.liftFingerY,
    });
  }, []);

  const applyTarget = useCallback(
    (fingerX: number, fingerY: number) => {
      const current = dragRef.current;
      if (!current) return;
      const target = resolveTarget(fingerX, fingerY);
      if (!target) return;
      const moved =
        current.moved ||
        target.laneKey !== current.originLaneKey ||
        target.index !== current.originIndex;
      if (
        target.laneKey === current.targetLaneKey &&
        target.index === current.targetIndex &&
        fingerX === current.fingerX &&
        fingerY === current.fingerY
      ) {
        return;
      }
      const next: DragState = {
        ...current,
        targetLaneKey: target.laneKey,
        targetIndex: target.index,
        fingerX,
        fingerY,
        moved,
      };
      dragRef.current = next;
      setDrag(next);
      if (moved && !current.moved) Haptics.selectionAsync().catch(() => {});
    },
    [resolveTarget],
  );

  /**
   * Edge auto-pan. Runs while the finger sits in a zone; each frame scrolls
   * the board a little and re-resolves the target, because the lane under a
   * STATIONARY finger changes as the board moves — that is the whole point of
   * panning rather than making the finger reach the far lane.
   */
  const runPanLoop = useCallback(() => {
    if (panLoopRef.current !== null) return;
    const step = () => {
      panLoopRef.current = null;
      if (!dragRef.current) return;
      const board = boardWindowRef.current;
      const delta = edgePanStep({
        x: panPointRef.current.x,
        viewportLeft: board.x,
        viewportRight: board.x + board.width,
      });
      if (delta === 0) return;
      const next = Math.min(
        Math.max(scrollXRef.current + delta, 0),
        maxScrollXRef.current,
      );
      if (next === scrollXRef.current) return;
      scrollXRef.current = next;
      scrollRef.current?.scrollTo({ x: next, animated: false });
      applyTarget(panPointRef.current.x, panPointRef.current.y);
      panLoopRef.current = requestAnimationFrame(step);
    };
    panLoopRef.current = requestAnimationFrame(step);
  }, [applyTarget]);

  const stopPanLoop = useCallback(() => {
    if (panLoopRef.current !== null) {
      cancelAnimationFrame(panLoopRef.current);
      panLoopRef.current = null;
    }
  }, []);

  useEffect(() => stopPanLoop, [stopPanLoop]);

  const endDrag = useCallback(() => {
    stopPanLoop();
    dragRef.current = null;
    setDrag(null);
    freezeScrollers(false);
  }, [stopPanLoop, freezeScrollers]);

  const onCardLift = useCallback(
    (column: IssueGroupSection, issue: Issue, event: GestureResponderEvent) => {
      // Before anything else: the finger is stationary now and will not stay
      // that way, so the scrollers have to be out of the race first.
      freezeScrollers(true);
      measureBoard();
      const snap = takeSnapshot();
      snapshotRef.current = snap;
      boardCapturedRef.current = false;
      const { pageX, pageY } = event.nativeEvent;
      panPointRef.current = { x: pageX, y: pageY };
      const originIds = snap.laneIds[column.key] ?? [];
      const originIndex = Math.max(originIds.indexOf(issue.id), 0);
      // Where the card's top edge sits relative to the finger, so the overlay
      // hangs off the finger exactly where the card was picked up.
      const row = (snap.rows[column.key] ?? [])[originIndex];
      const cardTop =
        (snap.listTop[column.key] ?? 0) -
        (snap.scrollY[column.key] ?? 0) +
        (row?.top ?? 0);
      const next: DragState = {
        issueId: issue.id,
        originLaneKey: column.key,
        originIndex,
        grabOffsetY: pageY - cardTop,
        liftFingerY: pageY,
        targetLaneKey: column.key,
        targetIndex: originIndex,
        fingerX: pageX,
        fingerY: pageY,
        moved: false,
        snapshot: snap,
      };
      dragRef.current = next;
      setDrag(next);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    },
    [measureBoard, takeSnapshot],
  );

  /** Drop. Writes nothing when the slot did not change. */
  const commitDrop = useCallback(
    (current: DragState) => {
      const targetIds = moveWithinLanes(
        // The order the user was LOOKING at, not whatever the cache holds now:
        // a push that landed mid-gesture would otherwise move the card to a
        // slot nobody aimed at.
        current.snapshot.laneIds,
        current.originLaneKey,
        current.targetLaneKey,
        current.issueId,
        current.targetIndex,
      );
      // Engage the settle lock BEFORE the mutation can invalidate anything:
      // the refetch would otherwise win the race and the card would jump back
      // for a frame before landing.
      setSettledLaneIds(targetIds);
      endDrag();

      // The preview order is what the SCREEN shows; the move's anchors and
      // position are relative to the order the server STORES, which descending
      // `position` renders backwards.
      const rendered = targetIds[current.targetLaneKey] ?? [];
      const stored = storedLaneOrder(rendered, sortBy, sortDirection);
      const moved = issueById.get(current.issueId);
      const positionsOf = (ids: readonly string[]) =>
        Object.fromEntries(ids.map((id) => [id, issueById.get(id)?.position]));
      // Under any sort but `position` the lane is not in position order, so the
      // slot the finger picked says nothing about the manual order: the card
      // keeps its position and falls in where that position belongs (web
      // board-view.tsx:490-511 does the same).
      const lane =
        sortBy === "position"
          ? stored
          : insertIdByPosition(
              stored.filter((id) => id !== current.issueId),
              current.issueId,
              moved?.position ?? 0,
              positionsOf(stored),
            );
      const at = lane.indexOf(current.issueId);
      const section = sectionByKey.get(current.targetLaneKey);
      const position =
        sortBy === "position"
          ? provisionalPosition(lane, at, positionsOf(lane))
          : (moved?.position ?? 0);
      const onSettled = () => setSettledLaneIds(null);
      const handle = cardsRef.current.get(current.issueId);
      if (handle && section) {
        handle.commit(
          {
            ...(section.status ? { status: section.status } : {}),
            ...(section.assigneeType && section.assigneeId
              ? {
                  assignee_type: section.assigneeType,
                  assignee_id: section.assigneeId,
                }
              : {}),
            ...(section.unassigned
              ? { assignee_type: null, assignee_id: null }
              : {}),
            position,
            move_intent: moveAnchors(lane, at),
          },
          onSettled,
        );
      } else {
        onSettled();
      }

      // A select-property lane's value is not part of the move request, so it
      // rides alongside it — web's `applyPropertyGroupValue`
      // (board-view.tsx:517-521) does the same.
      if (section?.propertyId !== undefined) {
        const optionId = section.propertyOptionId ?? null;
        const raw = issueById.get(current.issueId)?.properties?.[
          section.propertyId
        ];
        const currentValue = typeof raw === "string" ? raw : null;
        if (optionId === null) {
          if (currentValue !== null) {
            unsetProperty.mutate({
              issueId: current.issueId,
              propertyId: section.propertyId,
            });
          }
        } else if (currentValue !== optionId) {
          setProperty.mutate({
            issueId: current.issueId,
            propertyId: section.propertyId,
            value: optionId,
          });
        }
      }
    },
    [
      endDrag,
      issueById,
      sectionByKey,
      setProperty,
      sortBy,
      sortDirection,
      unsetProperty,
    ],
  );

  const handleRelease = useCallback(() => {
    const current = dragRef.current;
    if (!current) return;
    const sameLane = current.targetLaneKey === current.originLaneKey;
    const changed =
      sameLane
        ? current.moved && current.targetIndex !== current.originIndex
        : current.moved;
    // Under any sort other than `position` the on-screen order is not the
    // server's position order, so a same-lane slot would name a place the move
    // API cannot express. Cross-lane still works — it is a group change.
    if (!changed || (sameLane && sortBy !== "position")) {
      endDrag();
      // A lift released without the card ever entering another slot is the
      // pre-176 long-press: the user wanted the status menu, not a drag.
      if (!current.moved) {
        cardsRef.current.get(current.issueId)?.openStatusSheet();
      }
      return;
    }
    commitDrop(current);
  }, [commitDrop, endDrag, sortBy]);

  /**
   * End of a gesture the board never took. The card's own Pressable reports it
   * (see the `onPressOut` note in `IssueCardWithMenu`), which is the only path
   * that exists when the finger never moved: a responder only ever transfers
   * on a MOVE, so without this the board would hold a lifted card forever.
   * Nothing was dragged, so this is the pre-176 long-press — open the sheet.
   */
  const onLiftEnd = useCallback(() => {
    const current = dragRef.current;
    if (!current) return;
    endDrag();
    cardsRef.current.get(current.issueId)?.openStatusSheet();
  }, [endDrag]);

  /**
   * The board-level responder. It only ever captures while a card is lifted,
   * so ordinary touches keep scrolling the board and its lanes — a card that
   * took the gesture on touch-down would make the board unscrollable wherever
   * a card happens to sit. Capture rather than bubble because the board's own
   * ScrollView would otherwise claim the move first.
   */
  const panResponder = useMemo(
    () => ({
      onMoveShouldSetResponderCapture: () => {
        return dragRef.current !== null;
      },
      onResponderGrant: () => {
        boardCapturedRef.current = true;
        const current = dragRef.current;
        if (current) panPointRef.current = { x: current.fingerX, y: current.fingerY };
      },
      onResponderMove: (event: GestureResponderEvent) => {
        const { pageX, pageY } = event.nativeEvent;
        panPointRef.current = { x: pageX, y: pageY };
        applyTarget(pageX, pageY);
        const board = boardWindowRef.current;
        if (
          edgePanStep({
            x: pageX,
            viewportLeft: board.x,
            viewportRight: board.x + board.width,
          }) !== 0
        ) {
          runPanLoop();
        }
      },
      onResponderRelease: () => {
        handleRelease();
      },
      onResponderTerminationRequest: () => {
        // Once the board owns the gesture it keeps it. Without this the
        // ScrollView's own JS pan responder — which asks on every move it
        // sees — can talk the board out of a drag that is already in flight,
        // and the card snaps home mid-gesture. `true` when nothing is lifted
        // is what keeps ordinary scrolling unaffected.
        return dragRef.current === null;
      },
      onResponderTerminate: () => {
        // The gesture was taken away (an incoming call, a system sheet). Snap
        // back and write nothing.
        endDrag();
      },
    }),
    [applyTarget, endDrag, handleRelease, runPanLoop],
  );

  /**
   * The order each lane renders while a card is lifted.
   *
   * The dragged card is NOT moved between lanes here: it stays in its own lane
   * so its Pressable — which owns the gesture until the board captures it —
   * keeps its identity and position in the tree. (Swapping the card for a
   * placeholder, which is what this did first, unmounted that Pressable and
   * left a lift that never moved stuck on screen.) The slot it would land in is
   * drawn as a separate indicator row instead, and the card's own row collapses
   * (see `collapsedId`) so the lane's height does not change.
   *
   * The base order is the one FROZEN AT LIFT, not the live cache: a push that
   * reordered a lane mid-gesture would slide every measured slot out from under
   * the finger while the drop index stayed where the user put it.
   *
   * Deliberately memoized on the target's PRIMITIVES rather than on `drag`,
   * which is a new object every frame. Depending on `drag` would hand every
   * lane a fresh `data` array 60 times a second and re-render the whole board
   * mid-drag.
   */
  const targetLaneKey = drag?.targetLaneKey ?? null;
  const targetIndex = drag?.targetIndex ?? -1;
  const dragSnapshot = drag?.snapshot ?? null;

  /**
   * Whether the drop currently names a DIFFERENT slot than the card's own.
   *
   * Everything the lift paints hangs off this one flag. While it is false the
   * gesture has not moved the card anywhere, so there is nothing to preview:
   * inserting the indicator at the card's own slot would make the lane a row
   * taller than it will be after the drop — the jump the lift used to have —
   * and collapsing the origin row at the same time would blank the very card
   * the user is holding.
   */
  const dropMoved =
    drag !== null &&
    (targetLaneKey !== drag.originLaneKey || targetIndex !== drag.originIndex);

  /** The lifted card's row collapses only while the indicator stands in for it
   *  somewhere else, which is what keeps the lane's height constant. */
  const collapsedId = dropMoved ? drag!.issueId : null;
  const placeholderHeight =
    cardHeightsRef.current[drag?.issueId ?? ""] ?? CARD_HEIGHT_FALLBACK;
  liftRef.current = {
    liftedId: drag?.issueId ?? null,
    collapsedId,
    placeholderHeight,
  };

  const laneIdsForRender = useMemo(() => {
    if (settledLaneIds) return settledLaneIds;
    const base = dragSnapshot?.laneIds ?? cacheLaneIds;
    if (!dropMoved || targetLaneKey === null) return base;
    const lane = base[targetLaneKey];
    if (!lane) return base;
    const at = Math.min(Math.max(targetIndex, 0), lane.length);
    return {
      ...base,
      [targetLaneKey]: [...lane.slice(0, at), DROP_PLACEHOLDER, ...lane.slice(at)],
    };
  }, [
    settledLaneIds,
    dragSnapshot,
    dropMoved,
    targetLaneKey,
    targetIndex,
    cacheLaneIds,
  ]);

  /**
   * The `extraData` a lane needs, or `null` when the drag cannot change
   * anything it paints. `null` for a lane means its mounted cells survive the
   * whole gesture untouched — including the lift, which is the frame that has
   * to land before Android's touch slop lets a native scroller steal the drag.
   */
  const liftToken = `${drag?.issueId ?? ""}|${collapsedId ?? ""}|${placeholderHeight}`;
  const laneExtraData = useCallback(
    (key: string) =>
      key === drag?.originLaneKey || key === targetLaneKey ? liftToken : null,
    [drag?.originLaneKey, targetLaneKey, liftToken],
  );

  const dragApi = useMemo<BoardDragApi>(
    () => ({
      cardHeights: cardHeightsRef,
      boardCaptured: boardCapturedRef,
      lift: liftRef,
      registerLane,
      registerCard,
      onCardLayout,
      onLaneLayout,
      onLaneListLayout,
      onLaneScroll,
      onCardLift,
      onLiftEnd,
    }),
    [
      registerLane,
      registerCard,
      onCardLayout,
      onLaneLayout,
      onLaneListLayout,
      onLaneScroll,
      onCardLift,
      onLiftEnd,
    ],
  );

  const liftedIssue = drag ? issueById.get(drag.issueId) : undefined;
  const targetLane = targetLaneKey
    ? laneLayoutRef.current[targetLaneKey]
    : undefined;

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
    <View ref={boardRef} className="flex-1" onLayout={measureBoard} {...panResponder}>
      <ScrollView
        ref={scrollRef}
        horizontal
        className="flex-1"
        // Frozen for the gesture: while a card is lifted the board pans only
        // through the drag layer's edge auto-pan.
        scrollEnabled={drag === null}
        onScroll={onBoardScroll}
        scrollEventThrottle={16}
        onContentSizeChange={(w) => {
          contentWidthRef.current = w;
          maxScrollXRef.current = Math.max(w - boardWindowRef.current.width, 0);
        }}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: BOARD_PADDING,
          paddingTop: 10,
          gap: LANE_GAP,
          alignItems: "stretch",
          flexGrow: 1,
        }}
      >
        {columns.map((column) => (
          <BoardColumn
            key={column.key}
            column={column}
            laneIds={laneIdsForRender[column.key] ?? []}
            issueById={issueById}
            onOpenIssue={onOpenIssue}
            onCreateIssue={onCreateIssue}
            onHideStatus={onHideStatus}
            isStatusFixed={isStatusFixed}
            dragApi={dragApi}
            dragging={drag !== null}
            extraData={laneExtraData(column.key)}
          />
        ))}
        {visibleHidden.length > 0 ? (
          <HiddenColumnsLane
            statuses={visibleHidden}
            onShowStatus={(s) => onShowStatus?.(s)}
          />
        ) : null}
      </ScrollView>
      {/* The lifted card itself, painted above the scrollers. Never
          interactive — the responder belongs to the board.
          `left` adds the row wrapper's own `px-2`: the lane's x is the lane's
          border, and the card inside it starts ROW_PADDING_X in. Omitting it
          left the overlay 8pt to the left of the card it replaced. */}
      {drag && liftedIssue ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left:
              (targetLane?.x ?? BOARD_PADDING) +
              ROW_PADDING_X -
              scrollXRef.current,
            top: drag.fingerY - boardWindowRef.current.y - drag.grabOffsetY,
            width: Math.max(
              (targetLane?.width ?? BOARD_COLUMN_WIDTH) - ROW_PADDING_X * 2,
              80,
            ),
          }}
        >
          <BoardCard issue={liftedIssue} onPress={() => {}} lifted />
        </View>
      ) : null}
    </View>
  );
}
