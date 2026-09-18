/**
 * Projects compact table (iteration-135) — the mobile port of web's
 * `viewMode === "compact"` projects table
 * (`packages/views/projects/components/projects-page.tsx:141-200,1180-1250`).
 *
 * Why it exists: the projects list had one rendering — a card row with a
 * fixed 3-line layout — so a user who only reads progress and recency paid
 * for priority, lead and the icon column on every row. Web's answer is a
 * density switch plus a column set the user owns; this is that, sized for a
 * phone.
 *
 * Layout, and why:
 *   - `name` + `status` are pinned (`pinnedWidth`) because web makes them the
 *     non-hideable core (`view-store.ts:46`) and because a table row whose
 *     subject can scroll out of view is unreadable. They are therefore NOT in
 *     the surface's column array.
 *   - The remaining columns live in the surface's ordered visible array
 *     (`data/stores/project-table-columns.ts`) and scroll horizontally, so a
 *     user who wants only `progress` + `created` can have exactly that with
 *     no scrolling at all.
 *   - Header and body are two sibling horizontal scrollers (the pinned pane
 *     has to sit outside both), synced through the same feedback-loop-guarded
 *     pattern the issue table uses (iteration 132/133 fixes).
 *   - Rows have no inline editors: every cell here is read-only, and the one
 *     action (open the project) is the row tap. Long-press enters the same
 *     multi-select mode the card list uses, so the existing batch toolbar
 *     works unchanged in either view.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Project } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ProjectIcon } from "@/components/ui/project-icon";
import { ProjectStatusIcon } from "@/components/ui/project-status-icon";
import { ProjectPriorityIcon } from "@/components/ui/project-priority-icon";
import { ProgressRing } from "@/components/ui/progress-ring";
import { ColumnResizeHandle } from "@/components/ui/column-resize-handle";
import {
  columnWidthOf,
  nextProjectColumnWidth,
  PROJECT_TABLE_COLUMNS,
  projectColumnMoveAvailability,
  projectSortFieldForColumn,
  type ProjectTableColumnKey,
  type ProjectTableColumnWidths,
} from "@/data/stores/project-table-columns";
import {
  nextProjectSort,
  type ProjectSortDirection,
  type ProjectSortField,
} from "@/lib/filter-projects";
import {
  projectPriorityLabel,
  projectStatusLabel,
} from "@/lib/project-status";
import { useActorLookup } from "@/data/use-actor-name";
import { useTimeAgo } from "@/lib/time-ago";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/react";

/** Pinned pane width. Fits a project icon plus a legible title at the phone's
 *  393dp width while leaving the majority of the row for the columns the user
 *  chose — the whole point of the view. */
const PINNED_WIDTH = 148;

/** Row / header heights. The row is two text lines (title, status) — the same
 *  information the card row leads with, at roughly half its height. */
const ROW_HEIGHT = 52;
const HEADER_HEIGHT = 34;
const RESIZE_HANDLE_WIDTH = 20;

interface Props {
  projects: readonly Project[];
  sortField: ProjectSortField;
  sortDirection: ProjectSortDirection;
  onSort: (field: ProjectSortField, direction: ProjectSortDirection) => void;
  columns: ProjectTableColumnKey[];
  columnWidths: ProjectTableColumnWidths;
  onToggleColumn: (column: ProjectTableColumnKey) => void;
  onResizeColumn: (column: ProjectTableColumnKey, width: number) => void;
  onReorderColumn: (column: ProjectTableColumnKey, delta: -1 | 1) => void;
  onResetColumns: () => void;
  /** The column sheet's open state is owned by the screen: its trigger (`列`)
   *  lives in the screen's control strip next to the view toggle, so all the
   *  list controls stay in one place instead of a nested per-view toolbar. */
  columnMenuOpen: boolean;
  onColumnMenuClose: () => void;
  onOpenProject: (project: Project) => void;
  selectionMode: boolean;
  selectedIds: ReadonlySet<string>;
  onToggleSelected: (id: string) => void;
  onEnterSelection: (id: string) => void;
  /** Pull-to-refresh, wired to BOTH panes: the gesture can start on either
   *  side of the pinned split, and the two lists are one surface to the user. */
  refreshing: boolean;
  onRefresh: () => void;
}

export function ProjectTableView({
  projects,
  sortField,
  sortDirection,
  onSort,
  columns,
  columnWidths,
  onToggleColumn,
  onResizeColumn,
  onReorderColumn,
  onResetColumns,
  columnMenuOpen,
  onColumnMenuClose,
  onOpenProject,
  selectionMode,
  selectedIds,
  onToggleSelected,
  onEnterSelection,
  refreshing,
  onRefresh,
}: Props) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const { getName } = useActorLookup();
  const timeAgo = useTimeAgo();

  /** In-flight resize drag: which column, and its provisional width. */
  const [resizing, setResizing] = useState<{
    column: ProjectTableColumnKey;
    width: number;
  } | null>(null);

  // --- column widths ------------------------------------------------------
  // A live drag keeps its width here and only commits on release, so an
  // abandoned drag never reaches the store. `displayWidths` is the single
  // array the header and the body both lay out from — that is what keeps the
  // two panes aligned mid-drag.
  const displayWidths = useMemo(
    () =>
      columns.map((column) =>
        resizing?.column === column
          ? resizing.width
          : columnWidthOf(column, columnWidths),
      ),
    [columns, columnWidths, resizing],
  );
  const bodyContentWidth = useMemo(
    () => displayWidths.reduce((sum, w) => sum + w, 0),
    [displayWidths],
  );

  const handleResizeMove = useCallback(
    (column: ProjectTableColumnKey, startWidth: number, dx: number) => {
      const width = nextProjectColumnWidth(startWidth, dx);
      setResizing((prev) =>
        prev && prev.column === column && prev.width === width
          ? prev
          : { column, width },
      );
    },
    [],
  );
  const handleResizeCommit = useCallback(
    (column: ProjectTableColumnKey, startWidth: number, dx: number) => {
      setResizing(null);
      const width = nextProjectColumnWidth(startWidth, dx);
      if (width !== columnWidthOf(column, columnWidths)) {
        onResizeColumn(column, width);
      }
    },
    [columnWidths, onResizeColumn],
  );

  // --- vertical sync (pinned pane ↔ scrolled pane) ------------------------
  const pinRef = useRef<FlatList<Project>>(null);
  const mainRef = useRef<FlatList<Project>>(null);
  const pinOffset = useRef(0);
  const mainOffset = useRef(0);
  const syncMain = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = event.nativeEvent.contentOffset.y;
      // Guard against feedback loops: only push when the twin is behind.
      if (Math.abs(y - mainOffset.current) < 1) return;
      mainOffset.current = y;
      pinRef.current?.scrollToOffset({ offset: y, animated: false });
    },
    [],
  );
  const syncPinned = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = event.nativeEvent.contentOffset.y;
      if (Math.abs(y - pinOffset.current) < 1) return;
      pinOffset.current = y;
      mainRef.current?.scrollToOffset({ offset: y, animated: false });
    },
    [],
  );

  // --- horizontal sync (header ↔ body) -----------------------------------
  const headerRef = useRef<ScrollView>(null);
  const bodyRef = useRef<ScrollView>(null);
  const headerX = useRef(0);
  const bodyX = useRef(0);
  const syncBodyToHeader = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = event.nativeEvent.contentOffset.x;
      if (Math.abs(x - headerX.current) < 1) return;
      headerX.current = x;
      headerRef.current?.scrollTo({ x, animated: false });
    },
    [],
  );
  const syncHeaderToBody = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = event.nativeEvent.contentOffset.x;
      if (Math.abs(x - bodyX.current) < 1) return;
      bodyX.current = x;
      bodyRef.current?.scrollTo({ x, animated: false });
    },
    [],
  );

  // See the issue table's twin effect (components/issue/table-view.tsx): a
  // column appearing, disappearing or moving resizes the strip both scrollers
  // move over, and the two panes then clamp at different maxima and stop
  // lining up. Snap back to the leading edge. Widths stay out of the key so a
  // resize drag is not interrupted.
  const columnSetKey = columns.join("|");
  useEffect(() => {
    headerX.current = 0;
    bodyX.current = 0;
    headerRef.current?.scrollTo({ x: 0, animated: false });
    bodyRef.current?.scrollTo({ x: 0, animated: false });
  }, [columnSetKey]);

  // --- header sort --------------------------------------------------------
  const headerSort = (column: ProjectTableColumnKey) => {
    const field = projectSortFieldForColumn(column);
    if (!field) return;
    const next = nextProjectSort(sortField, sortDirection, field);
    onSort(next.field, next.direction);
  };

  /** Name is sortable too (web's `name` column is in SORTABLE_COLUMNS), so the
   *  pinned header participates in the same cycle. */
  const headerSortByName = () => {
    const next = nextProjectSort(sortField, sortDirection, "name");
    onSort(next.field, next.direction);
  };

  const arrowForField = (field: ProjectSortField) =>
    sortField === field ? (
      <Ionicons
        name={sortDirection === "asc" ? "arrow-up" : "arrow-down"}
        size={11}
        color={theme.primary}
      />
    ) : null;

  const columnLabel = useCallback(
    (column: ProjectTableColumnKey) => {
      const def = PROJECT_TABLE_COLUMNS.find((c) => c.key === column);
      return def ? t(def.labelKey) : t("table.column.unknown");
    },
    [t],
  );

  const cellFor = (project: Project, column: ProjectTableColumnKey) => {
    switch (column) {
      case "priority":
        // `none` is a real value, not a missing one — the row shows it as the
        // em dash so the column does not appear broken on projects that
        // legitimately have no priority.
        return project.priority === "none" ? (
          <Text className="text-xs text-muted-foreground/60">—</Text>
        ) : (
          <View className="flex-row items-center gap-1.5">
            <ProjectPriorityIcon priority={project.priority} size={12} />
            <Text className="text-xs text-muted-foreground" numberOfLines={1}>
              {projectPriorityLabel(project.priority)}
            </Text>
          </View>
        );
      case "progress":
        // Web's ProgressRing rule: a project with no tasks has no progress to
        // report, so it renders the em dash rather than "0/0".
        return project.issue_count === 0 ? (
          <Text className="text-xs text-muted-foreground/60">—</Text>
        ) : (
          <View className="flex-row items-center gap-1.5">
            <ProgressRing
              done={project.done_count}
              total={project.issue_count}
              size={12}
            />
            <Text className="text-xs text-muted-foreground tabular-nums">
              {project.done_count}/{project.issue_count}
            </Text>
          </View>
        );
      case "lead": {
        const name =
          project.lead_type && project.lead_id
            ? getName(project.lead_type, project.lead_id)
            : null;
        return name ? (
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {name}
          </Text>
        ) : (
          <Text className="text-xs text-muted-foreground/60">—</Text>
        );
      }
      case "issues":
        return (
          <Text className="text-xs text-muted-foreground tabular-nums">
            {project.issue_count}
          </Text>
        );
      case "created":
        return (
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {timeAgo(project.created_at)}
          </Text>
        );
    }
  };

  const bottomPadding = selectionMode ? 200 : 12;

  const renderRow = (
    { item }: { item: Project },
    pinned: boolean,
  ) => {
    const selected = selectedIds.has(item.id);
    if (pinned) {
      return (
        <Pressable
          onPress={() =>
            selectionMode ? onToggleSelected(item.id) : onOpenProject(item)
          }
          onLongPress={() => onEnterSelection(item.id)}
          accessibilityRole="button"
          accessibilityState={{ selected }}
          className={cn(
            "flex-row items-center gap-2 pl-3 pr-2",
            selected && "bg-brand/5",
          )}
          style={{ width: PINNED_WIDTH, height: ROW_HEIGHT }}
        >
          <ProjectIcon icon={item.icon} size="sm" />
          <View className="flex-1 min-w-0 justify-center">
            <Text
              className="text-[13px] font-medium text-foreground"
              numberOfLines={1}
            >
              {item.title}
            </Text>
            <View className="flex-row items-center gap-1">
              <ProjectStatusIcon status={item.status} size={10} />
              <Text
                className="text-[11px] text-muted-foreground"
                numberOfLines={1}
              >
                {projectStatusLabel(item.status)}
              </Text>
            </View>
          </View>
          {selectionMode ? (
            <Ionicons
              name={selected ? "checkmark-circle" : "ellipse-outline"}
              size={16}
              color={selected ? theme.brand : theme.mutedForeground}
            />
          ) : null}
        </Pressable>
      );
    }
    return (
      <Pressable
        onPress={() =>
          selectionMode ? onToggleSelected(item.id) : onOpenProject(item)
        }
        onLongPress={() => onEnterSelection(item.id)}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        className={cn("flex-row", selected && "bg-brand/5")}
        style={{ width: bodyContentWidth, height: ROW_HEIGHT }}
      >
        {columns.map((column, index) => (
          <View
            key={column}
            style={{ width: displayWidths[index] }}
            className="justify-center pl-2 pr-1"
          >
            {cellFor(item, column)}
          </View>
        ))}
      </Pressable>
    );
  };

  return (
    <View className="flex-1">
      {/* Header row: pinned name header + scrollable column headers */}
      <View className="flex-row border-b border-border bg-secondary/30">
        <View
          style={{ width: PINNED_WIDTH, height: HEADER_HEIGHT }}
          className="pl-3 pr-1 justify-center"
        >
          <Pressable
            onPress={headerSortByName}
            className="flex-row items-center gap-1"
            accessibilityRole="button"
            accessibilityLabel={t("a11y.projectsSortByName")}
          >
            <Text
              className="text-xs font-semibold text-foreground"
              numberOfLines={1}
            >
              {t("projects.sortName")}
            </Text>
            {arrowForField("name")}
          </Pressable>
        </View>
        <ScrollView
          ref={headerRef}
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={syncHeaderToBody}
          scrollEventThrottle={16}
          style={{ flex: 1 }}
        >
          <View className="flex-row">
            {columns.map((column, index) => {
              const label = columnLabel(column);
              const field = projectSortFieldForColumn(column);
              return (
                <View
                  key={column}
                  style={{ width: displayWidths[index], height: HEADER_HEIGHT }}
                  className="flex-row"
                >
                  <Pressable
                    onPress={() => headerSort(column)}
                    disabled={!field}
                    className="flex-1 flex-row items-center gap-1 pl-2"
                    accessibilityLabel={
                      field
                        ? t("a11y.projectsSortByColumn", { column: label })
                        : undefined
                    }
                  >
                    <Text
                      className="text-xs font-semibold text-foreground"
                      numberOfLines={1}
                    >
                      {label}
                    </Text>
                    {field ? arrowForField(field) : null}
                  </Pressable>
                  <ColumnResizeHandle
                    label={t("a11y.projectsResizeColumn", { column: label })}
                    startWidth={displayWidths[index]}
                    height={HEADER_HEIGHT}
                    width={RESIZE_HANDLE_WIDTH}
                    onStart={() => {}}
                    onMove={(startWidth, dx) =>
                      handleResizeMove(column, startWidth, dx)
                    }
                    onCommit={(startWidth, dx) =>
                      handleResizeCommit(column, startWidth, dx)
                    }
                  />
                </View>
              );
            })}
            <View style={{ width: 8 }} />
          </View>
        </ScrollView>
      </View>

      {projects.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6 py-10">
          <Text className="text-sm text-muted-foreground text-center">
            {t("projects.noMatches")}
          </Text>
        </View>
      ) : (
        <View className="flex-1 flex-row">
          <View style={{ width: PINNED_WIDTH }}>
            <FlatList
              ref={pinRef}
              data={projects as Project[]}
              keyExtractor={(item) => item.id}
              onScroll={syncMain}
              scrollEventThrottle={16}
              initialNumToRender={12}
              windowSize={9}
              maxToRenderPerBatch={10}
              updateCellsBatchingPeriod={40}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: bottomPadding }}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
              }
              renderItem={(info) => renderRow(info, true)}
            />
          </View>
          <ScrollView
            ref={bodyRef}
            horizontal
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={syncBodyToHeader}
            scrollEventThrottle={16}
            style={{ flex: 1 }}
          >
            <View style={{ width: bodyContentWidth }}>
              <FlatList
                ref={mainRef}
                data={projects as Project[]}
                keyExtractor={(item) => item.id}
                onScroll={syncPinned}
                scrollEventThrottle={16}
                // Required for the OUTER horizontal ScrollView to receive a
                // horizontal drag that starts on a row: without it the inner
                // (vertical) list is not a nested-scrolling child, so a drag
                // it cannot consume is dropped instead of bubbling up — and
                // the only way left to pan the columns would be to drag the
                // 34pt header strip.
                nestedScrollEnabled
                initialNumToRender={12}
                windowSize={9}
                maxToRenderPerBatch={10}
                updateCellsBatchingPeriod={40}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: bottomPadding }}
                refreshControl={
                  <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
                }
                renderItem={(info) => renderRow(info, false)}
              />
            </View>
          </ScrollView>
        </View>
      )}

      <ProjectColumnMenu
        visible={columnMenuOpen}
        onClose={onColumnMenuClose}
        columns={columns}
        columnLabel={columnLabel}
        onToggleColumn={onToggleColumn}
        onReorderColumn={onReorderColumn}
        onResetColumns={onResetColumns}
      />
    </View>
  );
}

/**
 * Column visibility + order sheet. Same shape as the issue table's
 * `ColumnMenu` (iteration 134) including its two hard-won rules: the move
 * affordances are their OWN full-width rows (a 44px icon-sized target at the
 * sheet's left edge does not reliably receive touches on this device family,
 * while the full-width visibility rows do), and the sheet shows the current
 * display order in words so a move is visible without closing it.
 */
function ProjectColumnMenu({
  visible,
  onClose,
  columns,
  columnLabel,
  onToggleColumn,
  onReorderColumn,
  onResetColumns,
}: {
  visible: boolean;
  onClose: () => void;
  columns: ProjectTableColumnKey[];
  columnLabel: (column: ProjectTableColumnKey) => string;
  onToggleColumn: (column: ProjectTableColumnKey) => void;
  onReorderColumn: (column: ProjectTableColumnKey, delta: -1 | 1) => void;
  onResetColumns: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable className="flex-1 bg-black/40" onPress={onClose}>
        <View className="flex-1 justify-end">
          <Pressable
            onPress={() => {}}
            className="bg-popover rounded-t-2xl max-h-[75%]"
          >
            <View className="px-4 py-3 border-b border-border flex-row items-center justify-between">
              <Text className="text-base font-semibold text-foreground">
                {t("table.columnsTitle")}
              </Text>
              <View className="flex-row items-center gap-3">
                <Pressable
                  onPress={onResetColumns}
                  hitSlop={8}
                  accessibilityRole="button"
                >
                  <Text className="text-xs text-muted-foreground">
                    {t("table.resetColumns")}
                  </Text>
                </Pressable>
                <Pressable onPress={onClose} hitSlop={8}>
                  <Ionicons name="close" size={20} color="currentColor" />
                </Pressable>
              </View>
            </View>
            <ScrollView className="max-h-[55vh]">
              {columns.length > 0 ? (
                <Text
                  className="px-4 pt-3 text-[11px] text-muted-foreground"
                  numberOfLines={1}
                >
                  {columns.map((c) => columnLabel(c)).join(" › ")}
                </Text>
              ) : null}
              <Text className="px-4 pt-3 pb-1 text-xs uppercase tracking-wider text-muted-foreground font-medium">
                {t("table.columnsSystem")}
              </Text>
              {PROJECT_TABLE_COLUMNS.map((def) => {
                const position = columns.indexOf(def.key);
                const { left, right } = projectColumnMoveAvailability(
                  position,
                  columns.length,
                );
                return (
                  <View key={def.key}>
                    <Pressable
                      onPress={() => onToggleColumn(def.key)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: position >= 0 }}
                      accessibilityLabel={t(def.labelKey)}
                      className="flex-row items-center gap-2 py-2.5 px-4 active:bg-secondary/60"
                    >
                      <Ionicons
                        name={position >= 0 ? "checkbox" : "square-outline"}
                        size={17}
                        color={position >= 0 ? THEME[colorScheme].primary : muted}
                      />
                      <Text className="flex-1 text-sm text-foreground">
                        {t(def.labelKey)}
                      </Text>
                    </Pressable>
                    {/* Move rows only for a visible column: a hidden one has
                        nothing to place, and the store would refuse it. */}
                    {position >= 0 ? (
                      <>
                        <MoveRow
                          direction="left"
                          disabled={!left}
                          label={t("a11y.projectsMoveColumnUp", {
                            column: t(def.labelKey),
                          })}
                          onPress={() => onReorderColumn(def.key, -1)}
                        />
                        <MoveRow
                          direction="right"
                          disabled={!right}
                          label={t("a11y.projectsMoveColumnDown", {
                            column: t(def.labelKey),
                          })}
                          onPress={() => onReorderColumn(def.key, 1)}
                        />
                      </>
                    ) : null}
                  </View>
                );
              })}
              <Text className="px-4 pt-3 pb-2 text-[11px] text-muted-foreground">
                {t("projects.columnsCoreHint")}
              </Text>
            </ScrollView>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

function MoveRow({
  direction,
  disabled,
  label,
  onPress,
}: {
  direction: "left" | "right";
  disabled: boolean;
  label: string;
  onPress: () => void;
}) {
  const { colorScheme } = useColorScheme();
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      className={cn(
        "flex-row items-center gap-2 py-2.5 pl-5",
        disabled ? "opacity-50" : "active:bg-secondary/60",
      )}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={label}
    >
      <Ionicons
        name={direction === "left" ? "arrow-back" : "arrow-forward"}
        size={15}
        color={THEME[colorScheme].mutedForeground}
      />
    </Pressable>
  );
}
