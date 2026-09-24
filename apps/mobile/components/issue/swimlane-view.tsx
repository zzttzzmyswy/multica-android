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
 * Degenerate cases, defined rather than incidental:
 *   - No issues at all → `emptyLabel`, exactly like the board.
 *   - An empty lane exists only when it is pinned: the "no X" lane always
 *     renders because it is the move target that clears the dimension.
 *   - An empty cell renders as a visible (short) drop target, like an empty
 *     board column.
 *   - Cells cap at `SWIMLANE_CELL_LIMIT` cards with a "+N" footer. Cells
 *     hold no virtualized list of their own, so this cap is what keeps a
 *     500-card lane from painting 500 rows.
 */
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
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
import { useUpdateIssue } from "@/data/mutations/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useActorLookup } from "@/data/use-actor-name";
import { issueDetailOptions } from "@/data/queries/issues";
import { projectListOptions } from "@/data/queries/projects";
import {
  buildSwimlaneLanes,
  laneMovePatch,
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
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

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

  const lanes = useMemo(
    () =>
      buildSwimlaneLanes({
        issues,
        grouping,
        statusOrder,
        actorName,
        projectTitle,
        knownParentIds: new Set(parentById.keys()),
      }),
    [issues, grouping, statusOrder, actorName, projectTitle, parentById],
  );

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

  const toggleLane = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const parentLoading =
    grouping === "parent" && parentQueries.some((query) => query.isLoading);

  const renderLane = useCallback(
    ({ item: lane }: { item: SwimlaneLane }) => {
      const isCollapsed = collapsed.has(lane.key);
      return (
        <View className="pb-3">
          <Pressable
            onPress={() => toggleLane(lane.key)}
            className="flex-row items-center gap-2 px-3 py-2"
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
            <Text className="ml-auto text-xs text-muted-foreground/60">
              {lane.total}
            </Text>
          </Pressable>
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
    [collapsed, toggleLane, laneLabel, colorScheme, onOpenIssue, openLaneSheet],
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
