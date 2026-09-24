/**
 * Swimlane view for the issue workbench — mobile port of web's
 * `packages/views/issues/components/swimlane-view.tsx`, phone-adapted.
 *
 * Web's swimlane is a grid: one ROW per lane (the grouping value), one
 * COLUMN per issue status, under a sticky status header row. It reads the
 * same on a phone, with two adaptations for a 375pt screen:
 *
 *   - A lane's status cells scroll HORIZONTALLY inside the lane, and the
 *     lane header sits above them instead of being a frozen left grid
 *     column. On desktop the lane identity rides a sticky-left column; on a
 *     phone that column would eat a third of the width and the lane name
 *     would scroll away the moment you look at a later status. Per-lane
 *     scrolling keeps "which lane am I in" on screen at all times.
 *   - Lanes come from the same `sorted` issue array the list/board/table
 *     views render, so filters, sort and the query window apply identically
 *     in every mode (same store, same derived array).
 *
 * Move mechanics (web's drag-and-drop has no cheap touch equivalent):
 * long-press a card → "移动到状态…" (the board's own status sheet) or
 * "移动到泳道…" (the active grouping's lanes, plus the field's own picker
 * for a value the current lanes don't contain). Both write through the
 * mutations the detail page already uses — `useUpdateIssue` for status, the
 * existing `issue/[id]/picker/*` routes for the grouping field — so each
 * field keeps ONE optimistic-update path instead of a swimlane-only copy.
 *
 * Lane order and lane folding are the OTHER half of the workbench, and both
 * are per-device: web keeps them in localStorage (`swimlaneOrders` /
 * `collapsedSwimlanes` in `packages/core/issues/stores/view-store.ts`) and
 * deliberately leaves them out of a saved view's payload, so there is no API
 * for either. Mobile mirrors that through
 * `data/stores/issue-workbench-layout-store.ts` (one JSON file per
 * workspace).
 *
 * The lane drag uses a dedicated handle rather than the whole header row:
 * the header's tap must keep folding the lane, and the handle's PanResponder
 * takes the gesture in the CAPTURE phase so the outer FlatList never sees a
 * swipe that began on it (the same wiring the pinned list uses — see
 * `components/pin/pinned-screen.tsx`). The drag rewrites only the rendered
 * preview order; the persisted order is written once, on release, through
 * `mergeLaneOrder` so lanes hidden by the current filter are not dropped.
 *
 * Degenerate cases, defined rather than incidental:
 *   - No issues at all → `emptyLabel`, exactly like the board.
 *   - An empty lane exists only when it is pinned: the "no X" lane always
 *     renders because it is the move target that clears the dimension.
 *   - An empty cell renders as a visible (short) drop target, like an empty
 *     board column.
 *   - Cells cap at `SWIMLANE_CELL_LIMIT` cards with a "+N" footer. Cells
 *     hold no virtualized list of their own, so this cap is what keeps a
 *     500-card lane from painting 500 rows.
 *   - Pinned lanes (the "no X" lane, and parent grouping's "Other parents")
 *     carry no drag handle: they are pinned to the top by construction.
 */
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { FlatList, PanResponder, Pressable, ScrollView, View } from "react-native";
import type { LayoutChangeEvent } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useQueries, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import type {
  Issue,
  IssueAssigneeType,
  IssueStatus,
  UpdateIssueRequest,
} from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { StatusIcon } from "@/components/ui/status-icon";
import { IssuesLoading } from "@/components/issue/issues-loading";
import { useStatusLabel, useStatusOptions } from "@/lib/status-options";
import { translate } from "@/lib/i18n";
import { useTranslation } from "@/lib/i18n/react";
import { ActionSheet } from "@/lib/action-sheet";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { dragTargetIndex, reorderByMove } from "@/lib/pin-reorder";
import {
  swimlaneBucket,
  useCollapsedKeys,
  useLaneOrder,
  useSetLaneOrder,
  useToggleCollapsed,
} from "@/data/stores/issue-workbench-layout-store";
import { useUpdateIssue } from "@/data/mutations/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useActorLookup } from "@/data/use-actor-name";
import { issueDetailOptions } from "@/data/queries/issues";
import { projectListOptions } from "@/data/queries/projects";
import {
  buildSwimlaneLanes,
  laneMovePatch,
  mergeLaneOrder,
  SWIMLANE_GROUPINGS,
  type SwimlaneGrouping,
  type SwimlaneLane,
} from "@/lib/swimlane";
import { BoardCard } from "./board-card";

/** Cell width — one full status cell plus a peek of the next fits a 375pt
 *  phone beside the lane gutter. */
const CELL_WIDTH = 232;
/** Cards rendered per cell before the "+N more" footer. */
export const SWIMLANE_CELL_LIMIT = 30;

const GROUPING_LABEL_KEY: Record<SwimlaneGrouping, string> = {
  assignee: "issues.swimlane.groupAssignee",
  project: "issues.swimlane.groupProject",
  parent: "issues.swimlane.groupParent",
};

/** Picker route per grouping — the issue detail attribute rows' screens, so
 *  the write path for each field stays shared rather than re-implemented. */
const GROUPING_PICKER_PATHNAME = {
  assignee: "/[workspace]/issue/[id]/picker/assignee",
  project: "/[workspace]/issue/[id]/picker/project",
  parent: "/[workspace]/issue/[id]/picker/parent",
} as const;

/** Applies a lane move to one issue — `SwimlaneCard` supplies its own
 *  `useUpdateIssue`-backed writer. */
type MoveWriter = (patch: UpdateIssueRequest) => void;

function LaneGlyph({ lane }: { lane: SwimlaneLane }) {
  if (lane.orphan) {
    return <Ionicons name="help-circle-outline" size={15} color="#8b8b8b" />;
  }
  if (lane.grouping === "assignee") {
    if (!lane.assigneeType || !lane.assigneeId) return <View className="w-4" />;
    return (
      <ActorAvatar type={lane.assigneeType} id={lane.assigneeId} size={16} />
    );
  }
  if (lane.grouping === "project") {
    return <Ionicons name="folder-outline" size={14} color="#8b8b8b" />;
  }
  if (!lane.parentIssueId) return <View className="w-4" />;
  return <Ionicons name="git-branch-outline" size={14} color="#8b8b8b" />;
}

export function SwimlaneView({
  issues,
  grouping,
  onGroupingChange,
  statusOrder,
  onOpenIssue,
  emptyLabel,
  hiddenStatuses = [],
  onShowStatus,
}: {
  issues: Issue[];
  grouping: SwimlaneGrouping;
  onGroupingChange: (grouping: SwimlaneGrouping) => void;
  statusOrder: readonly IssueStatus[];
  onOpenIssue: (issue: Issue) => void;
  emptyLabel: string;
  /** Statuses hidden from the board/swimlane. Same list the board takes — the
   *  cells disappear because the shared filter slice already excludes them,
   *  so this is only the RESTORE entry (web's side rail). */
  hiddenStatuses?: IssueStatus[];
  onShowStatus?: (status: IssueStatus) => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const statusLabel = useStatusLabel();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { getName } = useActorLookup();
  const { data: projects = [] } = useQuery(projectListOptions(wsId));
  // Lane folds and lane order are per device, per workspace — see the module
  // doc. Both live in one store so a workspace switch cannot mix them.
  const collapsed = useCollapsedKeys(wsId, swimlaneBucket(grouping));
  const toggleLane = useToggleCollapsed(wsId, swimlaneBucket(grouping));
  const storedOrder = useLaneOrder(wsId, grouping);
  const setStoredOrder = useSetLaneOrder(wsId, grouping);

  // The order rendered while a lane drag is in flight. Rewriting `storedOrder`
  // on every slot the drag crosses would re-render (and re-mount) the moving
  // lane, dropping the gesture; the store is written once, on release.
  const [dragOrder, setDragOrder] = useState<SwimlaneLane[] | null>(null);
  // The order the drag started from — `from` is resolved against THIS, so a
  // mid-drag preview rewrite cannot shift it.
  const lanesAtStartRef = useRef<SwimlaneLane[]>([]);
  const laneHeightsRef = useRef<Record<string, number>>({});

  // `getName` is rebuilt on every render by `useActorLookup`; read it through
  // a ref so the lane memo doesn't invalidate on every parent render.
  const getNameRef = useRef(getName);
  getNameRef.current = getName;
  const actorName = useCallback(
    (type: IssueAssigneeType, id: string) => getNameRef.current(type, id),
    [],
  );

  const projectTitle = useCallback(
    (id: string) => projects.find((p) => p.id === id)?.title ?? id,
    [projects],
  );

  // Parent lanes are named by the parent issue itself (web's
  // `childrenByParentsOptions`): fetch the distinct parents the filtered
  // window references. A parent still in flight counts as "not loaded", so
  // its children render in the pinned orphan lane for that frame — web's
  // buildParentLanes rule, not a mobile invention.
  const parentIds = useMemo(() => {
    if (grouping !== "parent") return [];
    const ids = new Set<string>();
    for (const issue of issues) {
      if (issue.parent_issue_id) ids.add(issue.parent_issue_id);
    }
    return [...ids];
  }, [grouping, issues]);

  const parentQueries = useQueries({
    queries: parentIds.map((id) => issueDetailOptions(wsId, id)),
  });

  const parentById = useMemo(() => {
    const map = new Map<string, Issue>();
    for (const query of parentQueries) {
      if (query.data) map.set(query.data.id, query.data);
    }
    return map;
    // `parentQueries` is a fresh array every render; the map is rebuilt from
    // whatever is loaded, which is cheap and always current.
  }, [parentQueries]);

  const builtLanes = useMemo(
    () =>
      buildSwimlaneLanes({
        issues,
        grouping,
        statusOrder,
        actorName,
        projectTitle,
        knownParentIds: new Set(parentById.keys()),
        storedOrder,
      }),
    [
      issues,
      grouping,
      statusOrder,
      actorName,
      projectTitle,
      parentById,
      storedOrder,
    ],
  );

  // The drag's preview order, or the built order when no drag is in flight.
  const lanes = dragOrder ?? builtLanes;

  /** Draggable lanes in render order — the pinned lanes have no move value
   *  and no handle, so they never take part in a lane drag (web disables
   *  `useSortable` for them). Ids are RAW lane ids: that is what the
   *  persisted order holds (web's `swimlaneOrders`).
   *
   *  The builder always emits the pinned lanes as a prefix, so their count is
   *  also the offset between a full-array index and a movable-only index. */
  const pinnedCount = useMemo(
    () => builtLanes.filter((lane) => lane.pinned).length,
    [builtLanes],
  );
  const movableRawIds = useMemo(
    () => builtLanes.slice(pinnedCount).map((lane) => lane.rawId),
    [builtLanes, pinnedCount],
  );

  // Gesture-time state lives in refs: the responders below are built once and
  // must not close over a stale order. Indices are into the FULL lane array
  // (what `dragTargetIndex` walks); `pinnedCount` is subtracted only when the
  // drop is folded into the persisted movable-only order.
  const dragFromRef = useRef(0);
  const dragTargetRef = useRef(0);
  const laneIdsRef = useRef<string[]>([]);
  const builtLanesRef = useRef(builtLanes);
  builtLanesRef.current = builtLanes;
  const pinnedCountRef = useRef(pinnedCount);
  pinnedCountRef.current = pinnedCount;
  const movableRawIdsRef = useRef(movableRawIds);
  movableRawIdsRef.current = movableRawIds;
  // `useSetLaneOrder` hands back a fresh closure every render and the stored
  // order changes on commit, so reading either directly in `onLaneDrop` would
  // give it a new identity each render. That identity feeds the handle's
  // `useMemo`, and a `PanResponder` swapped mid-gesture resets its
  // `gestureState` — the preview then snaps back to the original slot and the
  // drop commits nothing (measured on-device: `dy` went -113 → -29 across one
  // render, `to` 1 → 2, `from === to` on release). Both are read through refs
  // so the responder is built once.
  const storedOrderRef = useRef(storedOrder);
  storedOrderRef.current = storedOrder;
  const setStoredOrderRef = useRef(setStoredOrder);
  setStoredOrderRef.current = setStoredOrder;

  const onLaneLayout = useCallback((key: string, e: LayoutChangeEvent) => {
    const { height } = e.nativeEvent.layout;
    if (height > 0) laneHeightsRef.current[key] = height;
  }, []);

  const onLaneDragStart = useCallback((index: number) => {
    dragFromRef.current = index;
    dragTargetRef.current = index;
    laneIdsRef.current = builtLanesRef.current.map((lane) => lane.key);
    lanesAtStartRef.current = builtLanesRef.current;
    setDragOrder(builtLanesRef.current);
  }, []);

  const onLaneDragTo = useCallback((delta: number) => {
    // A lane is only crossed once the finger passes its midpoint, and the
    // pinned lanes at the top are not a slot a movable lane may land on.
    const raw = dragTargetIndex({
      ids: laneIdsRef.current,
      heights: laneHeightsRef.current,
      startIndex: dragFromRef.current,
      delta,
    });
    const to = Math.max(raw, pinnedCountRef.current);
    if (to === dragTargetRef.current) return;
    dragTargetRef.current = to;
    Haptics.selectionAsync().catch(() => {});
    setDragOrder(reorderByMove(lanesAtStartRef.current, dragFromRef.current, to));
  }, []);

  const onLaneDrop = useCallback(() => {
    setDragOrder(null);
    const from = dragFromRef.current;
    const to = dragTargetRef.current;
    if (from === to) return;
    // Fold the visible reorder into the persisted order so lanes the current
    // filter hides keep their slots — see `mergeLaneOrder`.
    const pinned = pinnedCountRef.current;
    setStoredOrderRef.current(
      mergeLaneOrder({
        stored: storedOrderRef.current,
        visible: movableRawIdsRef.current,
        from: from - pinned,
        to: to - pinned,
      }),
    );
  }, []);

  const laneLabel = useCallback(
    (lane: SwimlaneLane): string => {
      if (lane.orphan) return t("issues.swimlane.groupOtherParents");
      if (lane.grouping === "assignee") {
        if (!lane.assigneeType || !lane.assigneeId) {
          return t("filter.noAssignee");
        }
        return actorName(lane.assigneeType, lane.assigneeId);
      }
      if (lane.grouping === "project") {
        if (!lane.projectId) return t("picker.noProject");
        return projectTitle(lane.projectId);
      }
      if (!lane.parentIssueId) return t("issues.swimlane.groupNoParent");
      const parent = parentById.get(lane.parentIssueId);
      return parent ? `${parent.identifier} · ${parent.title}` : lane.parentIssueId;
    },
    [t, actorName, projectTitle, parentById],
  );

  /** "移动到泳道…" — this grouping's lanes plus the field's own picker. */
  const openLaneSheet = useCallback(
    (issue: Issue, move: MoveWriter) => {
      const targets = lanes.filter((lane) => !lane.orphan);
      const labels = targets.map(laneLabel);
      labels.push(t("issues.swimlane.pickOther"));
      labels.push(t("common.cancel"));
      ActionSheet.showActionSheetWithOptions(
        {
          title: t("issues.swimlane.moveToLane"),
          options: labels,
          cancelButtonIndex: labels.length - 1,
        },
        (index) => {
          if (index == null) return;
          if (index < targets.length) {
            move(laneMovePatch(targets[index]) as UpdateIssueRequest);
            return;
          }
          if (index === targets.length && wsSlug) {
            router.push({
              pathname: GROUPING_PICKER_PATHNAME[grouping],
              params: { workspace: wsSlug, id: issue.id },
            });
          }
        },
      );
    },
    [lanes, laneLabel, t, wsSlug, grouping],
  );

  const parentLoading =
    grouping === "parent" && parentQueries.some((query) => query.isLoading);

  const renderLane = useCallback(
    ({ item: lane, index }: { item: SwimlaneLane; index: number }) => {
      const isCollapsed = collapsed.has(lane.key);
      return (
        <View
          className="pb-3"
          onLayout={(e) => onLaneLayout(lane.key, e)}
        >
          <View className="flex-row items-center gap-1 px-3">
            <Pressable
              onPress={() => toggleLane(lane.key)}
              className="flex-1 flex-row items-center gap-2 py-2"
              accessibilityRole="button"
              accessibilityState={{ expanded: !isCollapsed }}
              accessibilityLabel={laneLabel(lane)}
            >
              <Ionicons
                name={isCollapsed ? "chevron-forward" : "chevron-down"}
                size={13}
                color={THEME[colorScheme].mutedForeground}
              />
              <LaneGlyph lane={lane} />
              <Text
                numberOfLines={1}
                className="flex-shrink text-sm font-medium text-foreground"
              >
                {laneLabel(lane)}
              </Text>
            </Pressable>
            <Text className="text-xs text-muted-foreground/60">
              {lane.total}
            </Text>
            {lane.pinned ? null : (
              <LaneDragHandle
                index={index}
                onDragStart={onLaneDragStart}
                onDragTo={onLaneDragTo}
                onDrop={onLaneDrop}
              />
            )}
          </View>
          {isCollapsed ? null : (
            <ScrollView
              horizontal
              nestedScrollEnabled
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                paddingHorizontal: 12,
                paddingBottom: 4,
                gap: 8,
              }}
            >
              {lane.cells.map((cell) => (
                <SwimlaneCell
                  key={`${lane.key}:${cell.status}`}
                  status={cell.status}
                  issues={cell.issues}
                  onOpenIssue={onOpenIssue}
                  onOpenLaneSheet={openLaneSheet}
                />
              ))}
            </ScrollView>
          )}
        </View>
      );
    },
    [
      collapsed,
      toggleLane,
      laneLabel,
      colorScheme,
      onOpenIssue,
      openLaneSheet,
      onLaneLayout,
      onLaneDragStart,
      onLaneDragTo,
      onLaneDrop,
    ],
  );

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
    <View className="flex-1">
      <View className="flex-row items-center px-3 pb-1">
        <Pressable
          onPress={() => {
            const labels = SWIMLANE_GROUPINGS.map((g) =>
              t(GROUPING_LABEL_KEY[g]),
            );
            labels.push(t("common.cancel"));
            ActionSheet.showActionSheetWithOptions(
              {
                title: t("issues.swimlane.groupBy"),
                options: labels,
                cancelButtonIndex: labels.length - 1,
              },
              (index) => {
                if (index == null || index >= SWIMLANE_GROUPINGS.length) return;
                onGroupingChange(SWIMLANE_GROUPINGS[index]);
              },
            );
          }}
          className="flex-row items-center gap-1 rounded-lg border border-border bg-secondary/40 px-2 py-1"
          accessibilityRole="button"
          accessibilityLabel={t("issues.swimlane.groupBy")}
        >
          <Text className="text-xs text-muted-foreground">
            {t("issues.swimlane.groupBy")}
          </Text>
          <Text className="text-xs font-medium text-foreground">
            {t(GROUPING_LABEL_KEY[grouping])}
          </Text>
          <Ionicons
            name="chevron-down"
            size={12}
            color={THEME[colorScheme].mutedForeground}
          />
        </Pressable>
        {/* Restore entry for hidden status cells. The board carries the same
            list as a trailing lane; a swimlane has no trailing position, so
            it lives in the header bar — same data, one tap, no scrolling
            past every lane to find it. */}
        {hiddenStatuses.length > 0 ? (
          <Pressable
            onPress={() =>
              ActionSheet.showActionSheetWithOptions(
                {
                  title: t("issues.boardHiddenColumns"),
                  options: [
                    ...hiddenStatuses.map((s) => statusLabel(s)),
                    t("common.cancel"),
                  ],
                  cancelButtonIndex: hiddenStatuses.length,
                },
                (index) => {
                  if (index == null || index >= hiddenStatuses.length) return;
                  onShowStatus?.(hiddenStatuses[index]);
                },
              )
            }
            className="ml-auto flex-row items-center gap-1 rounded-lg border border-dashed border-border px-2 py-1"
            accessibilityRole="button"
            accessibilityLabel={t("issues.boardHiddenColumns")}
          >
            <Ionicons
              name="eye-off-outline"
              size={13}
              color={THEME[colorScheme].mutedForeground}
            />
            <Text className="text-xs font-medium text-muted-foreground">
              {hiddenStatuses.length}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {parentLoading ? (
        <IssuesLoading />
      ) : (
        <FlatList
          data={lanes}
          keyExtractor={(lane) => lane.key}
          renderItem={renderLane}
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
          // A lane is a header plus a row of cells — tall. 2 covers the
          // viewport with margin, so a 40-lane board never mounts 40 rows
          // of cards at once.
          initialNumToRender={2}
          windowSize={5}
          maxToRenderPerBatch={2}
          updateCellsBatchingPeriod={40}
          contentContainerStyle={{ paddingBottom: 12 }}
        />
      )}
    </View>
  );
}

/**
 * The lane header's drag handle. A dedicated handle rather than the whole
 * header row for two reasons: the header's tap must keep folding the lane
 * (web solves the same conflict with a 5px activation distance on its
 * pointer sensor), and a PanResponder that owns its own gesture can take the
 * responder in the CAPTURE phase — the handle sits inside the lane
 * FlatList's row, and with bubble-phase handlers alone the FlatList claims
 * the vertical drag before the child ever sees it (measured on-device for
 * the pinned list: grant/move counts stayed 0 across a swipe that scrolled
 * the list).
 *
 * The handle reports the finger's travel, not a slot: `onDragTo` resolves
 * the slot from measured lane heights, which is the only mapping that stays
 * right when lanes have different heights (a collapsed lane is one header,
 * an expanded one is a header plus a card row).
 */
function LaneDragHandle({
  index,
  onDragStart,
  onDragTo,
  onDrop,
}: {
  index: number;
  onDragStart: (index: number) => void;
  onDragTo: (delta: number) => void;
  onDrop: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const indexRef = useRef(index);
  indexRef.current = index;

  const responder = useMemo(
    () =>
      PanResponder.create({
        // CAPTURE, not bubble — see the doc comment above.
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dy) > 2,
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 2,
        onPanResponderGrant: () => {
          onDragStart(indexRef.current);
          Haptics.selectionAsync().catch(() => {});
        },
        onPanResponderMove: (_e, g) => onDragTo(g.dy),
        // Release and terminate both commit: a gesture the system takes away
        // (a notification shade pull, an incoming call) still has to clear
        // the preview order, or the board would stay frozen in drag state.
        onPanResponderRelease: () => onDrop(),
        onPanResponderTerminate: () => onDrop(),
      }),
    [onDragStart, onDragTo, onDrop],
  );

  return (
    <View
      {...responder.panHandlers}
      className="px-1 py-2"
      hitSlop={8}
      accessibilityRole="adjustable"
      accessibilityLabel={t("issues.swimlane.reorderLane")}
      accessibilityHint={t("issues.swimlane.reorderLaneHint")}
    >
      <Ionicons
        name="reorder-two"
        size={15}
        color={THEME[colorScheme].mutedForeground}
      />
    </View>
  );
}

/**
 * One status cell inside a lane. Owns the per-issue mutation hook through
 * its cards (hooks can't be called from the parent's render callback) and
 * shows the "+N more" footer when the cell is over the render cap.
 */
const SwimlaneCell = memo(function SwimlaneCell({
  status,
  issues,
  onOpenIssue,
  onOpenLaneSheet,
}: {
  status: IssueStatus;
  issues: Issue[];
  onOpenIssue: (issue: Issue) => void;
  onOpenLaneSheet: (issue: Issue, move: MoveWriter) => void;
}) {
  const { t } = useTranslation();
  const statusLabel = useStatusLabel();
  const shown = issues.slice(0, SWIMLANE_CELL_LIMIT);

  return (
    <View
      style={{ width: CELL_WIDTH }}
      className="flex-col rounded-lg border border-border bg-background/60"
    >
      <View className="flex-row items-center gap-1.5 px-2 pt-2 pb-1.5">
        <StatusIcon status={status} size={13} />
        <Text
          numberOfLines={1}
          className="flex-shrink text-[11px] uppercase tracking-wider font-medium text-muted-foreground"
        >
          {statusLabel(status)}
        </Text>
        <Text className="ml-auto text-[11px] text-muted-foreground/60">
          {issues.length}
        </Text>
      </View>
      {issues.length === 0 ? (
        <View className="min-h-[30px] justify-center px-2 pb-2">
          <Text className="text-[11px] text-muted-foreground/40">
            {translate("issues.swimlane.emptyCell")}
          </Text>
        </View>
      ) : (
        <View className="gap-1.5 px-1.5 pb-1.5">
          {shown.map((issue) => (
            <SwimlaneCard
              key={issue.id}
              issue={issue}
              onOpen={() => onOpenIssue(issue)}
              onOpenLaneSheet={onOpenLaneSheet}
            />
          ))}
          {issues.length > shown.length ? (
            <Text className="px-1 py-1 text-[11px] text-muted-foreground/70">
              {t("issues.swimlane.moreCards", {
                count: issues.length - shown.length,
              })}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
});

/**
 * A card plus the move menu it opens — long-press → status (the board's own
 * sheet) or lane (the grouping's lanes). Writes go through this issue's
 * `useUpdateIssue`, the same optimistic path the detail page uses; the board
 * card itself is reused unchanged.
 */
const SwimlaneCard = memo(function SwimlaneCard({
  issue,
  onOpen,
  onOpenLaneSheet,
}: {
  issue: Issue;
  onOpen: () => void;
  onOpenLaneSheet: (issue: Issue, move: MoveWriter) => void;
}) {
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { options } = useStatusOptions(wsId);
  const updateIssue = useUpdateIssue(issue.id);

  const move = useCallback(
    (patch: UpdateIssueRequest) => updateIssue.mutate(patch),
    [updateIssue],
  );

  const onLongPress = useCallback(() => {
    const labels = [
      t("filter.moveToStatus"),
      t("issues.swimlane.moveToLane"),
      t("common.cancel"),
    ];
    ActionSheet.showActionSheetWithOptions(
      { title: issue.identifier, options: labels, cancelButtonIndex: 2 },
      (index) => {
        if (index === 0) {
          const statusLabels = options.map((o) => o.label);
          const statusKeys = options.map((o) => o.key);
          const withCancel = [...statusLabels, t("common.cancel")];
          ActionSheet.showActionSheetWithOptions(
            {
              title: t("filter.moveToStatus"),
              options: withCancel,
              cancelButtonIndex: withCancel.length - 1,
            },
            (statusIndex) => {
              if (statusIndex == null || statusIndex >= statusKeys.length) return;
              updateIssue.mutate({ status: statusKeys[statusIndex] });
            },
          );
          return;
        }
        if (index === 1) onOpenLaneSheet(issue, move);
      },
    );
  }, [issue, t, options, updateIssue, move, onOpenLaneSheet]);

  return <BoardCard issue={issue} onPress={onOpen} onLongPress={onLongPress} />;
});
