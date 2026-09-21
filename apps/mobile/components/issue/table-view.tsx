/**
 * Table view for the issue workbench (MYS-440) — mobile port of web's
 * `packages/views/issues/components/table-view.tsx`, phone-adapted.
 *
 * What it shares with web:
 *   - The same visible-column model: `tableColumns` ordered array from the
 *     surface's view store, `title` permanent + first (web toggleTableColumn).
 *   - Header-tap sorting mapped onto the shared sort store (web uses an
 *     explicit asc/desc menu; the phone's tap-to-cycle is the mobile
 *     adaptation — tapping a fresh column applies asc, tapping the active
 *     column flips direction, arrow glyph shows the active sort).
 *   - A pinned first column (web columnPinning left): checkbox + title stay
 *     fixed while the remaining columns scroll horizontally as one unit
 *     (header and rows are separate horizontal scrollers — the pinned column
 *     has to sit outside both — kept in lockstep by the header/body sync
 *     below, so alignment can't drift).
 *   - CSV export of the visible row set through the same serialization
 *     (`lib/issue-table-export.ts`), shared to the system share sheet.
 *   - Table grouping by status / assignee / a select-or-checkbox property
 *     (web's `tableGroupSpec`). Web asks the SERVER to group and paginates per
 *     (groupKey, parentId) branch; mobile segments the loaded window itself
 *     and rebuilds the hierarchy inside each segment
 *     (`lib/issue-table-groups.ts`), so a sub-issue whose parent landed in a
 *     different group reads as a root in its own group — the same thing the
 *     branch fetch produces.
 *
 * Group collapse and parent collapse are two separate sets: folding a segment
 * and folding a subtree are different gestures and must not share state.
 *
 * The pinned column's vertical movement is driven by the main list's scroll
 * events (scrollToOffset on a sibling FlatList with the same data + fixed
 * row heights) — the classic dual-list table pattern; both lists feed each
 * other so a gesture starting on either pane scrolls the whole grid.
 *
 * Iteration 134 adds the two column-configuration gestures the web table gets
 * from TanStack Table + dnd-kit: a resize handle on each header's trailing
 * edge (PanResponder — there is no dnd-kit on the phone, and a phone header
 * has no hover to reveal one), and per-column move rows in the column menu
 * (`reorderTableColumn`). Both write to the surface view store, so the
 * column set, order and widths travel together.
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
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { Issue, IssueProperty, IssueStatusEntry } from "@multica/core/types";
import { ISSUE_DATE_SHORT, formatIssueDate } from "@/lib/format-date";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { ProjectIcon } from "@/components/ui/project-icon";
import { PriorityIcon } from "@/components/ui/priority-icon";
import { StatusIcon } from "@/components/ui/status-icon";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useActorLookup } from "@/data/use-actor-name";
import { useIssueBatchSelectionStore } from "@/data/stores/issue-batch-selection-store";
import {
  columnMoveAvailability,
  columnWidthOf,
  nextColumnWidth,
  nextTableSort,
  propertyIdFromTableColumn,
  TABLE_SYSTEM_COLUMNS,
  type TableColumnDefinition,
  type TableColumnKey,
  type TableColumnWidths,
  type TableSystemColumn,
} from "@/data/stores/issue-table-columns";
import { ColumnResizeHandle } from "@/components/ui/column-resize-handle";
import type {
  IssueSortDirection,
  IssueSortField,
} from "@/data/stores/issue-filter-slice";
import { propertyActiveOptions } from "@/data/queries/properties";
import { projectListOptions } from "@/data/queries/projects";
import { useIssueStatuses } from "@/data/queries/issue-statuses";
import {
  useIssueTableGroupCounts,
  type IssueTableGroupCountQuery,
} from "@/data/queries/issue-table-groups";
import { useStatusLabel } from "@/lib/status-options";
import { formatPropertyValue } from "@/lib/issue-properties";
import { MAX_DEPTH, type IssueTableRow } from "@/lib/issue-table-hierarchy";
import {
  buildIssueTableDisplayRows,
  isGroupableProperty,
  propertyIdFromGrouping,
  type IssueTableDisplayRow,
  type IssueTableGroupActor,
  type IssueTableGrouping,
  type IssueTableGroupValue,
} from "@/lib/issue-table-groups";
import {
  IssueCellEditor,
  isEditableTableColumn,
  type CellEditorTarget,
} from "@/components/issue/table-cell-editor";
import { useUpdateIssue } from "@/data/mutations/issues";
import { ActionSheet } from "@/lib/action-sheet";
import {
  buildIssuesCsv,
  csvExportFileName,
  exportHeaderLabels,
  tableCellText,
  type IssueTableExportContext,
} from "@/lib/issue-table-export";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useIntlLocale, useTranslation } from "@/lib/i18n/react";

/** Fixed row height — the dual-list scroll sync assumes uniform rows. */
const ROW_HEIGHT = 48;
/** Pinned left column width (checkbox + title) at depth 0. */
const PINNED_WIDTH = 176;
/** Header-row height (pinned cell + column headers share it). */
const HEADER_HEIGHT = 34;
/** Touch target for the column-resize handle on a header cell's right edge.
 *  Wide enough for a thumb (the visible rule inside is 2px). */
const RESIZE_HANDLE_WIDTH = 20;
/** Group segment header height. Matches the column header so a collapsed
 *  table still reads as a grid, and stays uniform across the two synced
 *  lists (the vertical scroll sync assumes identical row sequences). */
const GROUP_HEADER_HEIGHT = HEADER_HEIGHT;
/** Indent per parent hop in the pinned title cell. Web uses 18px on a wide
 *  desktop table; the phone's pinned column has to keep room for the title,
 *  so it indents less and widens itself by the same amount (see
 *  `pinnedWidth` in the component). */
const INDENT_PER_LEVEL = 14;
/** Two taps closer together than this on the pinned title rename the issue
 *  (web's double-click on InlineTitle). */
const DOUBLE_TAP_MS = 280;

function columnDefinition(
  column: TableSystemColumn,
): TableColumnDefinition | undefined {
  return TABLE_SYSTEM_COLUMNS.find((c) => c.key === column);
}

const STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
] as const;

const PRIORITIES = ["urgent", "high", "medium", "low", "none"] as const;

/** i18n translate signature used across the sub-render helpers. */
type Translate = (
  id: string,
  params?: Record<string, string | number>,
) => string;

interface Props {
  /** Visible issue rows, already filtered + sorted by the surface. */
  issues: Issue[];
  /** The surface store's visible-column list (title always first). */
  columns: TableColumnKey[];
  /** Passed straight through to the store's toggleTableColumn. */
  onToggleColumn: (column: TableColumnKey) => void;
  /** Per-column width overrides (surface store's `tableColumnWidths`). */
  columnWidths: TableColumnWidths;
  /** Passed straight through to the store's setTableColumnWidth. */
  onResizeColumn: (column: TableColumnKey, width: number) => void;
  /** Passed straight through to the store's reorderTableColumn. */
  onReorderColumn: (column: TableColumnKey, delta: -1 | 1) => void;
  /** Passed straight through to the store's resetTableColumns. */
  onResetColumns: () => void;
  sortBy: IssueSortField;
  sortDirection: IssueSortDirection;
  /** Header-tap sort: field + explicit direction (surface store setters). */
  onSort: (field: IssueSortField, direction: IssueSortDirection) => void;
  onOpenIssue: (issue: Issue) => void;
  /** Row-level "new sub-issue" entry (web's InlineTitle `+` button): opens
   *  the new-issue form with this issue preset as the parent. */
  onCreateSubIssue: (issue: Issue) => void;
  /** Shown when there are no rows (parent surfaces usually pre-empt this). */
  emptyLabel: string;
  /** Active grouping dimension (surface store's `tableGrouping`). */
  grouping: IssueTableGrouping;
  /** Passed straight through to the store's setTableGrouping. */
  onGroupingChange: (grouping: IssueTableGrouping) => void;
  /** The scope + filter window this surface is showing. Supplying it turns
   *  the group headers' counts server-authoritative (they then count the
   *  complete result set, not just the loaded window). Surfaces that omit it
   *  keep the local count. */
  groupCountQuery?: IssueTableGroupCountQuery | null;
  /** The Table's quick search box. Owned by the SURFACE, not this component:
   *  the query travels to the server as `q` (see `buildIssueWindow`), so the
   *  surface is where the fetch window is assembled. Omit both props on a
   *  surface with no search — the toolbar entry then hides entirely. */
  search?: string;
  onSearchChange?: (query: string) => void;
}

export function IssueTableView({
  issues,
  columns,
  onToggleColumn,
  columnWidths,
  onResizeColumn,
  onReorderColumn,
  onResetColumns,
  sortBy,
  sortDirection,
  onSort,
  onOpenIssue,
  onCreateSubIssue,
  emptyLabel,
  grouping,
  onGroupingChange,
  groupCountQuery,
  search,
  onSearchChange,
}: Props) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const statusLabel = useStatusLabel(wsId);
  const { activeStatuses } = useIssueStatuses(wsId);
  const {
    data: properties = [],
    isSuccess: propertiesSettled,
  } = useQuery(propertyActiveOptions(wsId));
  const { data: projects = [] } = useQuery(projectListOptions(wsId));
  const { getName } = useActorLookup();
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const selectionMode = useIssueBatchSelectionStore((s) => s.selectionMode);
  const selectedIds = useIssueBatchSelectionStore((s) => s.selectedIds);
  const enterSelection = useIssueBatchSelectionStore((s) => s.enterSelection);
  const setSelected = useIssueBatchSelectionStore((s) => s.setSelected);
  const clearSelection = useIssueBatchSelectionStore((s) => s.clear);
  const toggleSelection = useIssueBatchSelectionStore((s) => s.toggle);

  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  /** Collapsed parents — local to this table instance (web keeps the same
   *  per-surface expansion state in its table store). Not persisted: a
   *  collapsed subtree is a transient reading aid, not a saved preference. */
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  /** Collapsed GROUP segments — deliberately a second set, not a shared one:
   *  folding a status segment and folding a parent's subtree are different
   *  gestures, and collapsing one must never expand the other. */
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  /** Open inline cell editor, keyed by row + column. */
  const [editorKey, setEditorKey] = useState<{
    issueId: string;
    column: TableColumnKey;
  } | null>(null);
  /** Row being renamed from the pinned title cell. */
  const [renaming, setRenaming] = useState<Issue | null>(null);
  /** In-flight column-resize drag: which column, and its provisional width.
   *  Held here rather than written straight to the store so the store sees one
   *  write per gesture instead of one per frame. */
  const [resizing, setResizing] = useState<{
    column: TableColumnKey;
    width: number;
  } | null>(null);

  const groupActorName = useCallback(
    (actor: IssueTableGroupActor) => getName(actor.type, actor.id),
    [getName],
  );

  /** Counts over the complete result set, keyed by the group keys built
   *  below. Undefined until the first response — headers then report the
   *  loaded window's own count, which is what they did before this existed. */
  const serverGroupCounts = useIssueTableGroupCounts(
    wsId,
    groupCountQuery,
    grouping,
  );

  /** The flat sequence both synced lists render: group headers interleaved
   *  with rows (no headers at all when grouping is off). Hierarchy is built
   *  per segment inside, so a row's indent only ever reflects a parent it can
   *  actually see. */
  const displayRows = useMemo(() => {
    const built = buildIssueTableDisplayRows(
      issues,
      grouping,
      properties,
      collapsedIds,
      collapsedGroupIds,
      { actorName: groupActorName },
    );
    if (!serverGroupCounts || serverGroupCounts.size === 0) return built;
    return built.map((entry) =>
      entry.kind === "group"
        ? { ...entry, count: serverGroupCounts.get(entry.key) ?? entry.count }
        : entry,
    );
  }, [
    issues,
    grouping,
    properties,
    collapsedIds,
    collapsedGroupIds,
    groupActorName,
    serverGroupCounts,
  ]);

  const rows = useMemo(
    () =>
      displayRows.flatMap((entry) => (entry.kind === "row" ? [entry.row] : [])),
    [displayRows],
  );

  // A grouping whose definition vanished (deleted, archived, or changed to a
  // non-groupable type) is reset rather than left rendering one opaque
  // "value unavailable" bucket — web's `group_property_unavailable` path.
  const groupingPropertyId = propertyIdFromGrouping(grouping);
  useEffect(() => {
    if (!groupingPropertyId || !propertiesSettled) return;
    if (
      properties.some(
        (p) => p.id === groupingPropertyId && isGroupableProperty(p),
      )
    ) {
      return;
    }
    onGroupingChange("none");
  }, [groupingPropertyId, propertiesSettled, properties, onGroupingChange]);

  // Widen the pinned column exactly as far as the loaded tree needs to be
  // legible — a flat list keeps the original width, so nothing regresses
  // when there is no nesting to show.
  const pinnedWidth =
    PINNED_WIDTH +
    Math.min(
      rows.reduce((max, row) => Math.max(max, row.depth), 0),
      MAX_DEPTH,
    ) *
      INDENT_PER_LEVEL;

  const toggleCollapse = useCallback((issueId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(issueId)) next.delete(issueId);
      else next.add(issueId);
      return next;
    });
  }, []);

  const toggleGroupCollapse = useCallback((key: string) => {
    setCollapsedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  /** Group header text — web `serverGroupLabel`: statuses through the status
   *  catalog (a status this client doesn't know still renders its raw value),
   *  assignees through the actor lookup with an explicit unassigned bucket,
   *  and property buckets through the definition's options with the
   *  no-value / value-unavailable states called out. */
  const groupLabel = useCallback(
    (value: IssueTableGroupValue): string => {
      if (value.kind === "status") {
        return value.status ? statusLabel(value.status) : "";
      }
      if (value.kind === "assignee") {
        return value.actor
          ? getName(value.actor.type, value.actor.id)
          : t("picker.unassigned");
      }
      if (value.kind === "property") {
        if (value.state === "unset") return t("table.noValue");
        if (value.state === "unavailable") return t("table.valueUnavailable");
        const property = properties.find((p) => p.id === value.propertyId);
        if (property?.type === "checkbox") {
          return value.raw === "true"
            ? t("properties.value.true")
            : t("properties.value.false");
        }
        return (
          property?.config.options?.find((o) => o.id === value.raw)?.name ??
          String(value.raw ?? "")
        );
      }
      return "";
    },
    [statusLabel, getName, t, properties],
  );

  // Re-derive from the live rows so the editor always shows the current
  // value (a label toggle keeps the sheet open across writes); a row that
  // leaves the filtered list closes the sheet.
  const editorTarget: CellEditorTarget | null = useMemo(() => {
    if (!editorKey) return null;
    const issue = issues.find((i) => i.id === editorKey.issueId);
    return issue ? { issue, column: editorKey.column } : null;
  }, [editorKey, issues]);

  // --- dual-list vertical sync -------------------------------------------
  const pinRef = useRef<FlatList<IssueTableDisplayRow>>(null);
  const mainRef = useRef<FlatList<IssueTableDisplayRow>>(null);
  const pinOffset = useRef(0);
  const mainOffset = useRef(0);

  const syncPinned = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = event.nativeEvent.contentOffset.y;
      // Guard against feedback loops: only push when the twin is behind.
      if (Math.abs(y - pinOffset.current) < 1) return;
      pinOffset.current = y;
      mainRef.current?.scrollToOffset({ offset: y, animated: false });
    },
    [],
  );
  const syncMain = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = event.nativeEvent.contentOffset.y;
      if (Math.abs(y - mainOffset.current) < 1) return;
      mainOffset.current = y;
      pinRef.current?.scrollToOffset({ offset: y, animated: false });
    },
    [],
  );

  // --- header/body horizontal sync ---------------------------------------
  // The column header and the rows are two sibling horizontal scrollers (the
  // pinned column has to sit outside both), so without this the header stays
  // put while the columns slide away underneath it. Mirrors the vertical
  // pairing above, including the feedback-loop guard.
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

  // Showing or hiding a column (or reordering one) resizes the strip both
  // scrollers move over. Left alone, the pair wedges: each clamps at its own
  // new maximum, and the "don't push the twin when it is already there" guard
  // above then holds the two panes at different offsets, so the header stops
  // lining up with the rows. Return to the leading edge, which is where the
  // column menu leaves the reader anyway. Widths are deliberately not in the
  // key — a resize drag must not yank the strip out from under the finger.
  const columnSetKey = columns.join("|");
  useEffect(() => {
    headerX.current = 0;
    bodyX.current = 0;
    headerRef.current?.scrollTo({ x: 0, animated: false });
    bodyRef.current?.scrollTo({ x: 0, animated: false });
  }, [columnSetKey]);

  // --- selection ---------------------------------------------------------
  // "Visible" means what is on screen right now — a row inside a collapsed
  // subtree is not selectable by the header checkbox.
  const visibleIds = useMemo(
    () => rows.map((row) => row.issue.id),
    [rows],
  );
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const anyVisibleSelected = visibleIds.some((id) => selectedIds.has(id));

  const toggleSelectAll = () => {
    if (allVisibleSelected) clearSelection();
    else {
      enterSelection();
      setSelected(visibleIds);
    }
  };

  // --- column header sort -------------------------------------------------
  const headerSort = (def: TableColumnDefinition | undefined) => {
    const field = def?.sortField;
    if (!field || exporting) return;
    const next = nextTableSort(sortBy, sortDirection, field);
    onSort(next.field, next.direction);
  };

  const arrowForField = (field: IssueSortField) =>
    sortBy === field ? (
      <Ionicons
        name={sortDirection === "asc" ? "arrow-up" : "arrow-down"}
        size={11}
        color={THEME[colorScheme].primary}
      />
    ) : null;

  // --- export scaffolding --------------------------------------------------
  const projectTitle = useCallback(
    (id: string | null) =>
      id ? projects.find((p) => p.id === id)?.title ?? "" : "",
    [projects],
  );
  const actorName = useCallback(
    (type: "member" | "agent" | "squad", id: string) => {
      const name = getName(type, id);
      return name === "Unknown" ||
        name === "Unknown Agent" ||
        name === "Squad" ||
        name === "System"
        ? ""
        : name;
    },
    [getName],
  );

  const columnLabel = useCallback(
    (column: TableColumnKey) => {
      const propertyId = propertyIdFromTableColumn(column);
      if (propertyId) {
        return (
          properties.find((p) => p.id === propertyId)?.name ??
          t("table.column.property")
        );
      }
      const def = columnDefinition(column as TableSystemColumn);
      return def ? t(def.labelKey) : t("table.column.unknown");
    },
    [properties, t],
  );

  const selectedIssues = useMemo(
    () => issues.filter((i) => selectedIds.has(i.id)),
    [issues, selectedIds],
  );

  const openExportSheet = () => {
    if (exporting) return;
    const choices: ("all" | "selected")[] =
      selectedIssues.length > 0 ? ["all", "selected"] : ["all"];
    const labels = choices.map((scope) =>
      scope === "all"
        ? t("table.exportAll")
        : t("table.exportSelected", { count: selectedIssues.length }),
    );
    ActionSheet.showActionSheetWithOptions(
      {
        title: t("table.exportTitle"),
        options: [...labels, t("common.cancel")],
        cancelButtonIndex: labels.length,
      },
      (index) => {
        if (index == null || index >= labels.length) return;
        const scope = choices[index];
        const rows = scope === "all" ? issues : selectedIssues;
        const ctx: IssueTableExportContext = {
          // Built-ins resolve through i18n; custom statuses append their
          // catalog keys and resolve through the catalog name.
          statusLabels: Object.fromEntries(
            [...STATUSES, ...activeStatuses.map((e) => e.key)].map((s) => [
              s,
              statusLabel(s),
            ]),
          ),
          priorityLabels: Object.fromEntries(
            PRIORITIES.map((p) => [p, t(`enum.priority.${p}`)]),
          ),
          actorName,
          projectTitle,
          propertyDefinitions: properties,
        };
        setExporting(true);
        const now = new Date();
        const dateOnly = [
          String(now.getFullYear()),
          String(now.getMonth() + 1).padStart(2, "0"),
          String(now.getDate()).padStart(2, "0"),
        ].join("-");
        void writeAndShareCsv(rows, columns, ctx, columnLabel, scope, dateOnly)
          .catch(() => {})
          .finally(() => setExporting(false));
      },
    );
  };

  const bottomPadding = selectionMode && visibleIds.length > 0 ? 200 : 12;
  const bodyColumns = useMemo(
    () => columns.filter((c) => c !== "title"),
    [columns],
  );

  // --- column widths ------------------------------------------------------
  // A live drag keeps its width in `resizing` and only commits on release, so
  // an abandoned drag never reaches the store. `displayWidths` is the one
  // array the header and the body both lay out from, which is what keeps the
  // two panes aligned mid-drag.
  const displayWidths = useMemo(
    () =>
      bodyColumns.map((column) =>
        resizing?.column === column
          ? resizing.width
          : columnWidthOf(column, columnWidths),
      ),
    [bodyColumns, columnWidths, resizing],
  );
  const bodyContentWidth = useMemo(
    () => displayWidths.reduce((sum, w) => sum + w, 0),
    [displayWidths],
  );

  const handleResizeMove = useCallback(
    (column: TableColumnKey, startWidth: number, dx: number) => {
      const width = nextColumnWidth(startWidth, dx);
      setResizing((prev) =>
        prev && prev.column === column && prev.width === width
          ? prev
          : { column, width },
      );
      // The header is the pane the gesture drives, so it does not emit scroll
      // events while the columns move under it — push the body to match. Only
      // when the body's offset actually differs: an unconditional dispatch
      // every frame re-enters the sync loop for no movement.
      if (Math.abs(headerX.current - bodyX.current) >= 1) {
        bodyRef.current?.scrollTo({ x: headerX.current, animated: false });
      }
    },
    [],
  );

  const handleResizeCommit = useCallback(
    (column: TableColumnKey, startWidth: number, dx: number) => {
      setResizing(null);
      const width = nextColumnWidth(startWidth, dx);
      if (width !== columnWidthOf(column, columnWidths)) {
        onResizeColumn(column, width);
      }
    },
    [columnWidths, onResizeColumn],
  );

  // A cell tap: select in selection mode, else open the editor for an
  // editable column. Stable identity (issue id + column in, nothing out) so
  // the memoised rows can actually skip a re-render — an inline arrow per row
  // per render made the comparison meaningless.
  const handlePressCell = useCallback(
    (issueId: string, column: TableColumnKey) => {
      if (selectionMode) toggleSelection(issueId);
      else if (isEditableTableColumn(column)) {
        setEditorKey({ issueId, column });
      }
    },
    [selectionMode, toggleSelection],
  );

  // The search box renders in BOTH the empty and the populated state. A
  // search that matches nothing must still show the box it was typed into —
  // otherwise the only way out of "no results" is to leave the screen, and
  // the query is still in the server window.
  const searchBar = onSearchChange ? (
    <View className="px-3 pt-1.5">
      <View className="flex-row items-center gap-2 rounded-lg border border-border bg-secondary/30 px-2.5 h-9">
        <Ionicons
          name="search"
          size={14}
          color={THEME[colorScheme].mutedForeground}
        />
        <TextInput
          value={search ?? ""}
          onChangeText={onSearchChange}
          placeholder={t("table.searchPlaceholder")}
          placeholderTextColor={THEME[colorScheme].mutedForeground}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel={t("table.searchPlaceholder")}
          className="flex-1 text-sm text-foreground py-0"
        />
        {search ? (
          <Pressable
            onPress={() => onSearchChange("")}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("table.searchClear")}
            className="active:opacity-60"
          >
            <Ionicons
              name="close-circle"
              size={16}
              color={THEME[colorScheme].mutedForeground}
            />
          </Pressable>
        ) : null}
      </View>
    </View>
  ) : null;

  if (issues.length === 0) {
    return (
      <View className="flex-1">
        {searchBar}
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-sm text-muted-foreground text-center">
            {/* A search that matched nothing gets web's search-specific copy
                (`table.no_results`) instead of the surface's generic empty
                state — "no issues in this filter" is the wrong thing to say
                when the filter is fine and the query is what excluded them. */}
            {search?.trim() ? t("table.noResults") : emptyLabel}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1">
      {searchBar}
      {/* Toolbar: column visibility + grouping + CSV export */}
      <View className="flex-row items-center justify-between px-4 py-1.5 border-b border-border bg-background">
        <ToolbarButton
          icon="options-outline"
          label={t("table.columns")}
          onPress={() => setColumnMenuOpen(true)}
        />
        <ToolbarButton
          icon="albums-outline"
          label={t("table.groupBy")}
          onPress={() => setGroupMenuOpen(true)}
        />
        <ToolbarButton
          icon="download-outline"
          label={t("table.export")}
          onPress={openExportSheet}
          busy={exporting}
        />
      </View>

      <View className="flex-1">
        {/* Header row: pinned title header + scrollable column headers */}
        <View className="flex-row border-b border-border bg-secondary/30">
          <View
            style={{ width: pinnedWidth, height: HEADER_HEIGHT }}
            className="flex-row items-center gap-1.5 pl-3 pr-1"
          >
            <Pressable
              onPress={toggleSelectAll}
              hitSlop={6}
              accessibilityLabel={t("a11y.tableSelectAll")}
            >
              <Ionicons
                name={
                  allVisibleSelected
                    ? "checkbox"
                    : anyVisibleSelected
                      ? "remove"
                      : "square-outline"
                }
                size={16}
                color={
                  allVisibleSelected || anyVisibleSelected
                    ? THEME[colorScheme].primary
                    : THEME[colorScheme].mutedForeground
                }
              />
            </Pressable>
            <Pressable
              onPress={() => headerSort(columnDefinition("title"))}
              className="flex-1 flex-row items-center gap-1"
              accessibilityLabel={t("a11y.tableSortTitle")}
            >
              <Text className="text-xs font-semibold text-foreground" numberOfLines={1}>
                {t("table.column.title")}
              </Text>
              {arrowForField("title")}
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
              {bodyColumns.map((column, index) => {
                const def = columnDefinition(column as TableSystemColumn);
                const field = def?.sortField ?? null;
                return (
                  <HeaderCell
                    key={column}
                    column={column}
                    label={columnLabel(column)}
                    width={displayWidths[index]}
                    sortable={!!field}
                    sortArrow={field ? arrowForField(field) : null}
                    onPressSort={() => headerSort(def)}
                    onResizeStart={setResizing}
                    onResizeMove={handleResizeMove}
                    onResizeCommit={handleResizeCommit}
                  />
                );
              })}
              <View style={{ width: 8 }} />
            </View>
          </ScrollView>
        </View>

        {/* Body: pinned column + scrollable columns share one vertical
            scroll (dual-list sync). */}
        <View className="flex-1 flex-row">
          <View style={{ width: pinnedWidth }}>
            <FlatList
              ref={pinRef}
              data={displayRows}
              keyExtractor={displayRowKey}
              onScroll={syncMain}
              scrollEventThrottle={16}
              initialNumToRender={12}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: bottomPadding }}
              renderItem={({ item }) =>
                item.kind === "group" ? (
                  <PinnedGroupHeader
                    group={item}
                    label={groupLabel(item.value)}
                    width={pinnedWidth}
                    onToggle={() => toggleGroupCollapse(item.key)}
                  />
                ) : (
                  <PinnedRow
                    row={item.row}
                    height={ROW_HEIGHT}
                    selectionMode={selectionMode}
                    selected={selectedIds.has(item.row.issue.id)}
                    onPressCheckbox={() => {
                      if (selectionMode) toggleSelection(item.row.issue.id);
                      else enterSelection(item.row.issue.id);
                    }}
                    onPressRow={() => {
                      if (selectionMode) toggleSelection(item.row.issue.id);
                      else onOpenIssue(item.row.issue);
                    }}
                    onLongPress={() => enterSelection(item.row.issue.id)}
                    onToggleCollapse={() => toggleCollapse(item.row.issue.id)}
                    onRename={() => setRenaming(item.row.issue)}
                    onCreateSubIssue={() => onCreateSubIssue(item.row.issue)}
                  />
                )
              }
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
                data={displayRows}
                keyExtractor={displayRowKey}
                onScroll={syncPinned}
                scrollEventThrottle={16}
                initialNumToRender={12}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: bottomPadding }}
                renderItem={({ item }) =>
                  item.kind === "group" ? (
                    <DataGroupHeader
                      group={item}
                      width={bodyContentWidth}
                      onToggle={() => toggleGroupCollapse(item.key)}
                    />
                  ) : (
                    <DataRow
                      issue={item.row.issue}
                      columns={bodyColumns}
                      widths={displayWidths}
                      height={ROW_HEIGHT}
                      properties={properties}
                      projects={projects}
                      getName={getName}
                      selected={selectedIds.has(item.row.issue.id)}
                      columnLabel={columnLabel}
                      onPressCell={handlePressCell}
                    />
                  )
                }
              />
            </View>
          </ScrollView>
        </View>
      </View>

      <IssueCellEditor
        target={editorTarget}
        onClose={() => setEditorKey(null)}
        title={editorTarget ? columnLabel(editorTarget.column) : ""}
      />

      <RenameIssueDialog
        issue={renaming}
        onClose={() => setRenaming(null)}
      />

      <ColumnMenu
        visible={columnMenuOpen}
        onClose={() => setColumnMenuOpen(false)}
        columns={columns}
        properties={properties}
        columnLabel={columnLabel}
        onToggleColumn={onToggleColumn}
        onReorderColumn={onReorderColumn}
        onResetColumns={onResetColumns}
      />

      <GroupMenu
        visible={groupMenuOpen}
        onClose={() => setGroupMenuOpen(false)}
        properties={properties}
        grouping={grouping}
        onSelect={(next) => {
          setGroupMenuOpen(false);
          if (next === grouping) return;
          // A new dimension means a new set of segment keys; carrying the old
          // collapsed keys over would collapse arbitrary segments of the new
          // grouping (the keys are opaque strings to this component).
          setCollapsedGroupIds(new Set());
          onGroupingChange(next);
        }}
      />
    </View>
  );
}

/** Stable identity for a display row — issue id, or the group key. */
function displayRowKey(entry: IssueTableDisplayRow): string {
  return entry.kind === "group" ? `group:${entry.key}` : entry.row.issue.id;
}

/**
 * One scrollable column header: the sort target plus the resize handle on its
 * trailing edge.
 *
 * Web gets column resizing free from TanStack Table's column-sizing feature
 * (a drag on the header's resize affordance); on the phone the handle is an
 * explicit touch target, because a header tap already means "sort" and a
 * 34px-tall header has no spare gesture. The handle is a SIBLING of the sort
 * Pressable, not a child, so the two never compete for the same touch.
 */
function HeaderCell({
  column,
  label,
  width,
  sortable,
  sortArrow,
  onPressSort,
  onResizeStart,
  onResizeMove,
  onResizeCommit,
}: {
  column: TableColumnKey;
  label: string;
  width: number;
  sortable: boolean;
  sortArrow: React.ReactNode;
  onPressSort: () => void;
  onResizeStart: (resizing: { column: TableColumnKey; width: number }) => void;
  onResizeMove: (column: TableColumnKey, startWidth: number, dx: number) => void;
  onResizeCommit: (column: TableColumnKey, startWidth: number, dx: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={{ width, height: HEADER_HEIGHT }} className="flex-row">
      <Pressable
        onPress={onPressSort}
        disabled={!sortable}
        className="flex-1 flex-row items-center gap-1 pl-2"
        accessibilityLabel={sortable ? t("a11y.tableSortColumn") : undefined}
      >
        <Text className="text-xs font-semibold text-foreground" numberOfLines={1}>
          {label}
        </Text>
        {sortArrow}
      </Pressable>
      <ColumnResizeHandle
        label={t("a11y.tableResizeColumn", { column: label })}
        startWidth={width}
        height={HEADER_HEIGHT}
        width={RESIZE_HANDLE_WIDTH}
        onStart={() => onResizeStart({ column, width })}
        onMove={(startWidth, dx) => onResizeMove(column, startWidth, dx)}
        onCommit={(startWidth, dx) => onResizeCommit(column, startWidth, dx)}
      />
    </View>
  );
}

/** Build the CSV, write it to the cache dir, hand it to the system sheet.
 *  Failures surface only via the sheet (nothing to recover from). */
async function writeAndShareCsv(
  rows: readonly Issue[],
  columns: readonly TableColumnKey[],
  ctx: IssueTableExportContext,
  columnLabel: (column: TableColumnKey) => string,
  scope: "all" | "selected",
  dateOnly: string,
): Promise<void> {
  const csv = buildIssuesCsv(
    rows,
    columns,
    exportHeaderLabels(columns, columnLabel),
    (issue, column) => tableCellText(issue, column, ctx),
  );
  const file = new File(Paths.cache, csvExportFileName(scope, dateOnly));
  file.write(csv);
  await Sharing.shareAsync(file.uri, { mimeType: "text/csv" });
}

function ToolbarButton({
  icon,
  label,
  onPress,
  busy = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  busy?: boolean;
}) {
  const { colorScheme } = useColorScheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      className="flex-row items-center gap-1.5 py-1 active:opacity-60"
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons
        name={icon}
        size={14}
        color={THEME[colorScheme].mutedForeground}
      />
      <Text className="text-xs font-medium text-muted-foreground" numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Group segment header in the pinned pane — chevron, label, count. Matches
 * web's `IssueTableGroupRow` (a muted full-width band with the label pinned to
 * the left) and matches `GROUP_HEADER_HEIGHT` so the two synced lists keep the
 * same row sequence.
 */
function PinnedGroupHeader({
  group,
  label,
  width,
  onToggle,
}: {
  group: Extract<IssueTableDisplayRow, { kind: "group" }>;
  label: string;
  width: number;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <Pressable
      onPress={onToggle}
      style={{ width, height: GROUP_HEADER_HEIGHT }}
      className="flex-row items-center gap-1.5 pl-3 pr-2 bg-secondary/60 active:bg-secondary"
      accessibilityLabel={
        group.collapsed
          ? t("a11y.tableExpandGroup")
          : t("a11y.tableCollapseGroup")
      }
    >
      <Ionicons
        name={group.collapsed ? "chevron-forward" : "chevron-down"}
        size={12}
        color={theme.mutedForeground}
      />
      <Text
        className="text-[11px] font-semibold text-foreground shrink"
        numberOfLines={1}
      >
        {label}
      </Text>
      <Text className="text-[11px] text-muted-foreground tabular-nums">
        {group.count}
      </Text>
    </Pressable>
  );
}

/**
 * The same band in the scrollable pane. It carries NO label: the two panes are
 * independent lists, so repeating the header here would print it twice side by
 * side. Web keeps the label stuck to the left edge of a full-width cell, and
 * the pinned pane IS that left edge — the band just supplies the stripe that
 * spans the columns under it.
 */
function DataGroupHeader({
  group,
  width,
  onToggle,
}: {
  group: Extract<IssueTableDisplayRow, { kind: "group" }>;
  width: number;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onToggle}
      style={{ width, height: GROUP_HEADER_HEIGHT }}
      className="bg-secondary/60 active:bg-secondary"
      accessibilityLabel={
        group.collapsed
          ? t("a11y.tableExpandGroup")
          : t("a11y.tableCollapseGroup")
      }
    />
  );
}

/** Pinned (left) row: collapse chevron + selection checkbox + title, fixed
 *  height for sync. `depth` indents the title (web: `paddingLeft: depth*18`). */
function PinnedRow({
  row,
  height,
  selectionMode,
  selected,
  onPressCheckbox,
  onPressRow,
  onLongPress,
  onToggleCollapse,
  onRename,
  onCreateSubIssue,
}: {
  row: IssueTableRow;
  height: number;
  selectionMode: boolean;
  selected: boolean;
  onPressCheckbox: () => void;
  onPressRow: () => void;
  onLongPress: () => void;
  onToggleCollapse: () => void;
  onRename: () => void;
  onCreateSubIssue: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const checkColor = THEME[colorScheme].primary;
  const issue = row.issue;
  const lastTap = useRef(0);

  // Single tap opens the issue (unchanged); a double tap renames it, the
  // phone's equivalent of web's double-click on InlineTitle. Selection mode
  // owns taps outright, so renaming is suppressed while selecting.
  const handleTitlePress = () => {
    if (selectionMode) {
      onPressRow();
      return;
    }
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      onRename();
      return;
    }
    lastTap.current = now;
    onPressRow();
  };

  return (
    <View
      style={{ height, paddingLeft: 12 + row.depth * INDENT_PER_LEVEL }}
      className={`flex-row items-center gap-1.5 pr-2 border-b border-border/60 ${
        selected && selectionMode ? "bg-primary/5" : ""
      }`}
    >
      {row.hasChildren ? (
        <Pressable
          onPress={onToggleCollapse}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={
            row.collapsed ? t("a11y.tableExpandRow") : t("a11y.tableCollapseRow")
          }
        >
          <Ionicons
            name={row.collapsed ? "chevron-forward" : "chevron-down"}
            size={13}
            color={THEME[colorScheme].mutedForeground}
          />
        </Pressable>
      ) : (
        <View style={{ width: 13 }} />
      )}
      <Pressable
        onPress={onPressCheckbox}
        hitSlop={6}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={
          t("a11y.tableRowSelect") +
          (issue.identifier ? ` ${issue.identifier}` : "")
        }
      >
        <Ionicons
          name={selected ? "checkmark-circle" : "ellipse-outline"}
          size={18}
          color={selected ? checkColor : THEME[colorScheme].mutedForeground}
        />
      </Pressable>
      <Pressable
        onPress={handleTitlePress}
        onLongPress={onLongPress}
        className="flex-1"
        accessibilityRole="button"
        accessibilityLabel={t("a11y.tableOpenRow")}
        accessibilityHint={t("a11y.tableRenameHint")}
      >
        <Text className="text-[13px] text-foreground" numberOfLines={1}>
          {issue.title}
        </Text>
      </Pressable>
      {/* New sub-issue — web reveals this on title hover (`InlineTitle`'s "+"
        * button); hover does not exist on a phone, so it is a permanent
        * target. Hidden while selecting: the row's taps already mean
        * "toggle selection" then, and a create action in the middle of a
        * range-select is a mis-tap waiting to happen.
        *
        * The hit area is NOT enlarged: the pinned cell is 176px wide and this
        * sits immediately after the `flex-1` title, so an 8px `hitSlop` would
        * claim the right end of the title — taps meant to open the issue (or
        * the second tap of double-tap-to-rename) would create a sub-issue. */}
      {selectionMode ? null : (
        <Pressable
          onPress={onCreateSubIssue}
          accessibilityRole="button"
          accessibilityLabel={t("a11y.tableCreateSubIssue", {
            title: issue.title,
          })}
        >
          <Ionicons
            name="add"
            size={16}
            color={THEME[colorScheme].mutedForeground}
          />
        </Pressable>
      )}
    </View>
  );
}

/** One scrollable data row: fixed-width cells aligned with the header.
 *  Editable cells are pressable (web mounts an editor on the same cells);
 *  the rest stay inert so a tap on them does nothing rather than opening an
 *  editor that cannot write.
 *
 *  Memoised because a column-resize drag re-renders the table once per frame;
 *  without this every visible row would re-render for a width change that
 *  usually touches one column. The comparator is element-wise on `widths`
 *  rather than reference equality — a drag rebuilds that array every frame,
 *  so a shallow `Object.is` would still re-render every row. */
const DataRow = memo(
  function DataRow({
  issue,
  columns,
  widths,
  height,
  properties,
  projects,
  getName,
  selected,
  columnLabel,
  onPressCell,
}: {
  issue: Issue;
  columns: TableColumnKey[];
  widths: number[];
  height: number;
  properties: IssueProperty[];
  projects: { id: string; title: string; icon?: string | null }[];
  getName: (
    type: "member" | "agent" | "squad" | null | undefined,
    id: string | null | undefined,
  ) => string;
  selected: boolean;
  columnLabel: (column: TableColumnKey) => string;
  onPressCell: (issueId: string, column: TableColumnKey) => void;
}) {
  const { t } = useTranslation();
  const statusLabel = useStatusLabel();
  const statusEntry = useIssueStatuses().entryOf(issue.status);
  return (
    <View
      style={{ height }}
      className={`flex-row border-b border-border/60 ${selected ? "bg-primary/5" : ""}`}
    >
      {columns.map((column, index) => {
        const editable = isEditableTableColumn(column);
        return (
          <Pressable
            key={column}
            onPress={editable ? () => onPressCell(issue.id, column) : undefined}
            disabled={!editable}
            style={{ width: widths[index], height }}
            className={`justify-center px-2 ${
              editable ? "active:bg-secondary/60" : ""
            }`}
            accessibilityRole={editable ? "button" : undefined}
            accessibilityLabel={
              editable
                ? t("a11y.tableEditCell", { column: columnLabel(column) })
                : undefined
            }
          >
            <DataCell
              issue={issue}
              column={column}
              properties={properties}
              projects={projects}
              getName={getName}
              t={t}
              statusLabel={statusLabel}
              statusEntry={statusEntry}
            />
          </Pressable>
        );
      })}
    </View>
  );
  },
  (prev, next) =>
    prev.issue === next.issue &&
    prev.columns === next.columns &&
    prev.height === next.height &&
    prev.properties === next.properties &&
    prev.projects === next.projects &&
    prev.getName === next.getName &&
    prev.selected === next.selected &&
    prev.columnLabel === next.columnLabel &&
    prev.onPressCell === next.onPressCell &&
    sameWidths(prev.widths, next.widths),
);

/** Element-wise width comparison — a resize drag rebuilds the array each
 *  frame, so rows must be judged by the numbers, not the array identity. */
function sameWidths(a: readonly number[], b: readonly number[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function DataCell({
  issue,
  column,
  properties,
  projects,
  getName,
  t,
  statusLabel,
  statusEntry,
}: {
  issue: Issue;
  column: TableColumnKey;
  properties: IssueProperty[];
  projects: { id: string; title: string; icon?: string | null }[];
  getName: (
    type: "member" | "agent" | "squad" | null | undefined,
    id: string | null | undefined,
  ) => string;
  t: Translate;
  statusLabel: (statusKey: string) => string;
  statusEntry: IssueStatusEntry | undefined;
}) {
  switch (column) {
    case "identifier":
      return (
        <Text className="text-xs text-muted-foreground" numberOfLines={1}>
          {issue.identifier}
        </Text>
      );
    case "status":
      return (
        <View className="flex-row items-center gap-1">
          <StatusIcon
            status={issue.status}
            category={statusEntry?.category}
            color={statusEntry?.is_system ? undefined : (statusEntry?.color ?? undefined)}
            size={13}
          />
          <Text className="text-xs text-foreground" numberOfLines={1}>
            {statusLabel(issue.status)}
          </Text>
        </View>
      );
    case "priority":
      return (
        <View className="flex-row items-center gap-1">
          <PriorityIcon priority={issue.priority} size={13} />
          <Text className="text-xs text-foreground" numberOfLines={1}>
            {t(`enum.priority.${issue.priority}`)}
          </Text>
        </View>
      );
    case "assignee":
      return issue.assignee_type && issue.assignee_id ? (
        <View className="flex-row items-center gap-1.5">
          <ActorAvatar size={18} type={issue.assignee_type} id={issue.assignee_id} />
          <Text
            className="flex-shrink text-xs text-muted-foreground"
            numberOfLines={1}
          >
            {getName(issue.assignee_type, issue.assignee_id)}
          </Text>
        </View>
      ) : (
        <Text className="text-xs text-muted-foreground/60">—</Text>
      );
    case "creator":
      return (
        <Text className="text-xs text-muted-foreground" numberOfLines={1}>
          {getName(issue.creator_type, issue.creator_id)}
        </Text>
      );
    case "labels": {
      const labels = issue.labels ?? [];
      if (labels.length === 0) {
        return <Text className="text-xs text-muted-foreground/60">—</Text>;
      }
      return (
        <View className="flex-row items-center gap-1.5">
          {labels.slice(0, 2).map((label, i) => (
            <View key={label.id} className="flex-row items-center gap-1">
              <View
                className="size-2 rounded-full"
                style={{ backgroundColor: label.color }}
              />
              {i === 0 ? (
                <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                  {label.name}
                </Text>
              ) : null}
            </View>
          ))}
          {labels.length > 2 ? (
            <Text className="text-[10px] text-muted-foreground/70">
              +{labels.length - 2}
            </Text>
          ) : null}
        </View>
      );
    }
    case "project": {
      const project = projects.find((p) => p.id === issue.project_id);
      return (
      <View className="flex-row items-center gap-1.5">
          <ProjectIcon icon={project?.icon} size="sm" />
          <Text
            className="flex-shrink text-xs text-muted-foreground"
            numberOfLines={1}
          >
            {project?.title ?? "—"}
          </Text>
        </View>
      );
    }
    case "start_date":
      return <DateCell value={issue.start_date} />;
    case "due_date":
      return <DateCell value={issue.due_date} />;
    case "created_at":
      return <InstantCell value={issue.created_at} />;
    case "updated_at":
      return <InstantCell value={issue.updated_at} />;
    default: {
      const propertyId = propertyIdFromTableColumn(column);
      if (!propertyId) return null;
      const property = properties.find((p) => p.id === propertyId);
      return <PropertyCell issue={issue} property={property} t={t} />;
    }
  }
}

/** Calendar-day cell ("YYYY-MM-DD" → short day, blank when unset). */
function DateCell({ value }: { value: string | null }) {
  const { colorScheme } = useColorScheme();
  const intlLocale = useIntlLocale();
  if (!value) return <Text className="text-xs text-muted-foreground/60">—</Text>;
  const text = formatIssueDate(value, ISSUE_DATE_SHORT, intlLocale) || value;
  return (
    <View className="flex-row items-center gap-1">
      <Ionicons
        name="calendar-outline"
        size={12}
        color={THEME[colorScheme].mutedForeground}
      />
      <Text className="text-xs text-muted-foreground" numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

/** Instant cell ("ISO" → short local day). */
function InstantCell({ value }: { value: string }) {
  const intlLocale = useIntlLocale();
  const day = value.slice(0, 10);
  const text = formatIssueDate(day, ISSUE_DATE_SHORT, intlLocale) || day;
  return (
    <Text className="text-xs text-muted-foreground" numberOfLines={1}>
      {text}
    </Text>
  );
}

/** Custom-property cell — per-type rendering via formatPropertyValue. */
function PropertyCell({
  issue,
  property,
  t,
}: {
  issue: Issue;
  property: IssueProperty | undefined;
  t: Translate;
}) {
  const { colorScheme } = useColorScheme();
  if (!property) return <Text className="text-xs text-muted-foreground/60">—</Text>;
  const raw = (issue.properties ?? {})[property.id];
  const display = formatPropertyValue(property, raw);
  if (display === null) {
    return <Text className="text-xs text-muted-foreground/60">—</Text>;
  }
  switch (display.kind) {
    case "option":
      return (
        <View className="flex-row items-center gap-1.5">
          <View
            className="size-2 rounded-full shrink-0"
            style={{ backgroundColor: display.option.color }}
          />
          <Text className="flex-shrink text-xs text-foreground" numberOfLines={1}>
            {display.option.name}
          </Text>
        </View>
      );
    case "options":
      return (
        <View className="flex-row items-center gap-1.5">
          {display.options.slice(0, 2).map((option, i) => (
            <View key={option.id} className="flex-row items-center gap-1">
              <View
                className="size-2 rounded-full"
                style={{ backgroundColor: option.color }}
              />
              {i === 0 ? (
                <Text className="text-xs text-foreground" numberOfLines={1}>
                  {option.name}
                </Text>
              ) : null}
            </View>
          ))}
          {display.options.length > 2 ? (
            <Text className="text-[10px] text-muted-foreground/70">
              +{display.options.length - 2}
            </Text>
          ) : null}
        </View>
      );
    case "checkbox":
      return (
        <Text className="text-xs text-foreground" numberOfLines={1}>
          {display.value ? "☑" : "☐"}{" "}
          {t(
            display.value
              ? "properties.value.true"
              : "properties.value.false",
          )}
        </Text>
      );
    case "date":
      return (
        <View className="flex-row items-center gap-1">
          <Ionicons
            name="calendar-outline"
            size={12}
            color={THEME[colorScheme].mutedForeground}
          />
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {display.text}
          </Text>
        </View>
      );
    default:
      return (
        <Text className="text-xs text-foreground" numberOfLines={1}>
          {display.text}
        </Text>
      );
  }
}

/**
 * Title rename dialog for the pinned cell (MYS-1149, web InlineTitle's
 * double-click editor). The draft lives here rather than in the row so a
 * re-render caused by an unrelated cache patch cannot reset what the user is
 * typing; commit only fires when the text actually changed, mirroring web's
 * `commit()`.
 */
function RenameIssueDialog({
  issue,
  onClose,
}: {
  issue: Issue | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const updateIssue = useUpdateIssue(issue?.id ?? "");
  const [draft, setDraft] = useState("");

  // Seed the field once per open. `issue` is the snapshot captured on the
  // tap that opened the dialog, so this cannot fire mid-typing — the row it
  // came from re-rendering does not change this object's identity.
  useEffect(() => {
    if (issue) setDraft(issue.title);
  }, [issue]);

  const commit = () => {
    const title = draft.trim();
    const target = issue;
    onClose();
    if (!target || !title || title === target.title) return;
    updateIssue.mutate({ title });
  };

  if (!issue) return null;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable className="flex-1 bg-black/40" onPress={commit}>
        <View className="flex-1 justify-center px-6">
          <Pressable onPress={() => {}} className="bg-popover rounded-2xl p-4 gap-3">
            <Text className="text-base font-semibold text-foreground">
              {t("table.renameTitle")}
            </Text>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              autoFocus
              selectTextOnFocus
              returnKeyType="done"
              onSubmitEditing={commit}
              placeholder={t("table.renamePlaceholder")}
              placeholderTextColor={THEME[colorScheme].mutedForeground}
              className="border border-border rounded-lg px-3 py-2.5 text-sm text-foreground"
              style={{ includeFontPadding: false }}
            />
            <View className="flex-row justify-end gap-2">
              <Button variant="outline" size="sm" onPress={onClose}>
                <Text>{t("common.cancel")}</Text>
              </Button>
              <Button size="sm" onPress={commit} disabled={!draft.trim()}>
                <Text>{t("common.save")}</Text>
              </Button>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

/**
 * Column-visibility menu — checkbox list of system + property columns, plus
 * the two other column-configuration actions this iteration adds.
 *
 * Order is edited with explicit move-left / move-right buttons rather than a
 * drag: the header is a horizontally scrolling pane paired with a second
 * scroller for the rows, so a horizontal drag-to-reorder in the menu would
 * have to fight the sheet's own scroll for the axis, and the payoff (one slot
 * at a time) is the same. Web's dnd-kit `handleDragEnd` lands on the same
 * `reorderTableColumn` mutation.
 *
 * Move buttons are shown only on VISIBLE columns — order is a property of the
 * displayed list, and reordering a hidden column would be a no-op the user
 * could not see.
 */
function ColumnMenu({
  visible,
  onClose,
  columns,
  properties,
  columnLabel,
  onToggleColumn,
  onReorderColumn,
  onResetColumns,
}: {
  visible: boolean;
  onClose: () => void;
  columns: TableColumnKey[];
  properties: IssueProperty[];
  /** Resolves a column key to its display name (property columns included). */
  columnLabel: (column: TableColumnKey) => string;
  onToggleColumn: (column: TableColumnKey) => void;
  onReorderColumn: (column: TableColumnKey, delta: -1 | 1) => void;
  onResetColumns: () => void;
}) {
  const { t } = useTranslation();

  /** Position of a visible column in the display order, or -1. */
  const positionOf = (column: TableColumnKey) => columns.indexOf(column);

  /**
   * The move affordance for one column, or `undefined` when there is nothing
   * to move: a hidden column (position -1 — nothing to place) or the pinned
   * title column. Both cases are decided here, once, so the menu can never
   * render a control the store would refuse.
   */
  const movableOrder = (
    column: TableColumnKey,
    label: string,
  ): MenuRowOrder | undefined => {
    if (column === "title") return undefined;
    const position = positionOf(column);
    if (position < 0) return undefined;
    return {
      position,
      count: columns.length,
      onMove: (delta) => onReorderColumn(column, delta),
      label,
    };
  };

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
              {/* Current display order, so a move is visible without closing
                  the sheet — the move rows themselves only say what they will
                  do, not what the list looks like now. */}
              <Text
                className="px-4 pt-3 text-[11px] text-muted-foreground"
                numberOfLines={1}
              >
                {columns.map((c) => columnLabel(c)).join(" › ")}
              </Text>
              <Text className="px-4 pt-3 pb-1 text-xs uppercase tracking-wider text-muted-foreground font-medium">
                {t("table.columnsSystem")}
              </Text>
              {TABLE_SYSTEM_COLUMNS.map((def) => (
                <MenuRow
                  key={def.key}
                  label={t(def.labelKey)}
                  active={columns.includes(def.key)}
                  disabled={def.key === "title"}
                  onPress={() => onToggleColumn(def.key)}
                  order={movableOrder(def.key, t(def.labelKey))}
                />
              ))}
              {properties.length > 0 ? (
                <>
                  <Text className="px-4 pt-3 pb-1 text-xs uppercase tracking-wider text-muted-foreground font-medium">
                    {t("table.columnsProperties")}
                  </Text>
                  {properties.map((property) => {
                    const key: TableColumnKey = `property:${property.id}`;
                    return (
                      <MenuRow
                        key={key}
                        label={property.name}
                        active={columns.includes(key)}
                        onPress={() => onToggleColumn(key)}
                        order={movableOrder(key, property.name)}
                      />
                    );
                  })}
                </>
              ) : null}
            </ScrollView>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

/**
 * Move-left / move-right affordance for one menu row. Absent for a hidden
 * column (nothing to place) and for the pinned title column.
 *
 * Each chevron is its OWN full-width menu row rather than a small pressable
 * parked beside the visibility row. Two reasons: a full-width row is the
 * shape this sheet's touches are known to reach (the visibility rows and the
 * grouping rows are all built that way), and a 44px icon-sized target at the
 * sheet's left edge is a poor thumb target on a phone anyway. The chevron
 * sits at the left, where the row's own icon column is.
 */
interface MenuRowOrder {
  position: number;
  count: number;
  onMove: (delta: -1 | 1) => void;
  label: string;
}

function MenuRowMove({
  position,
  count,
  onMove,
  label,
}: MenuRowOrder) {
  const { t } = useTranslation();
  // Same rule the store enforces, so no offered control can silently no-op.
  const { left: canMoveLeft, right: canMoveRight } = columnMoveAvailability(
    position,
    count,
  );
  return (
    <>
      <MoveRow
        direction="left"
        disabled={!canMoveLeft}
        label={t("a11y.tableMoveColumnUp", { column: label })}
        onPress={() => onMove(-1)}
      />
      <MoveRow
        direction="right"
        disabled={!canMoveRight}
        label={t("a11y.tableMoveColumnDown", { column: label })}
        onPress={() => onMove(1)}
      />
    </>
  );
}

/** One full-width "move this column one slot" row. Same shape as the
 *  visibility row beside it (a wrapping View + a Pressable), because that is
 *  the structure this sheet's touch delivery is proven against. */
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
    <View>
      <Pressable
        onPress={disabled ? undefined : onPress}
        disabled={disabled}
        className={`flex-row items-center gap-2 py-2.5 pl-5 ${
          disabled ? "opacity-50" : "active:bg-secondary/60"
        }`}
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
    </View>
  );
}

function MenuRow({
  label,
  active,
  disabled = false,
  indicator = "check",
  order,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  indicator?: "check" | "radio";
  /** Present when the row's column can be repositioned (visibility menu). */
  order?: MenuRowOrder;
  onPress: () => void;
}) {
  const { colorScheme } = useColorScheme();
  return (
    <View>
      {order ? <MenuRowMove {...order} /> : null}
      <Pressable
        onPress={disabled ? undefined : onPress}
        disabled={disabled}
        className={`flex-row items-center justify-between py-2 px-4 ${
          disabled ? "opacity-50" : "active:bg-secondary/60"
        }`}
      >
        <Text
          className={`text-sm ${
            disabled ? "text-muted-foreground" : "text-foreground"
          }`}
          numberOfLines={1}
        >
          {label}
        </Text>
        {disabled ? (
          <Ionicons
            name="lock-closed-outline"
            size={14}
            color={THEME[colorScheme].mutedForeground}
          />
        ) : (
          <Ionicons
            name={
              indicator === "radio"
                ? active
                  ? "radio-button-on"
                  : "radio-button-off"
                : active
                  ? "checkbox"
                  : "square-outline"
            }
            size={17}
            color={
              active
                ? THEME[colorScheme].primary
                : THEME[colorScheme].mutedForeground
            }
          />
        )}
      </Pressable>
    </View>
  );
}

/**
 * Grouping picker — web's `tableGroupSpec` dimensions (status / assignee /
 * a select-or-checkbox custom property) plus "no grouping". Radio indicators,
 * because exactly one dimension is active; a definition the user cannot group
 * by is never listed, matching web's `groupablePropertyIds` filter.
 */
function GroupMenu({
  visible,
  onClose,
  properties,
  grouping,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  properties: IssueProperty[];
  grouping: IssueTableGrouping;
  onSelect: (grouping: IssueTableGrouping) => void;
}) {
  const { t } = useTranslation();
  const groupable = properties.filter(isGroupableProperty);

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
                {t("table.groupBy")}
              </Text>
              <Pressable onPress={onClose} hitSlop={8}>
                <Ionicons name="close" size={20} color="currentColor" />
              </Pressable>
            </View>
            <ScrollView className="max-h-[55vh]">
              <MenuRow
                label={t("table.groupNone")}
                active={grouping === "none"}
                indicator="radio"
                onPress={() => onSelect("none")}
              />
              <MenuRow
                label={t("table.column.status")}
                active={grouping === "status"}
                indicator="radio"
                onPress={() => onSelect("status")}
              />
              <MenuRow
                label={t("table.column.assignee")}
                active={grouping === "assignee"}
                indicator="radio"
                onPress={() => onSelect("assignee")}
              />
              {groupable.length > 0 ? (
                <>
                  <Text className="px-4 pt-3 pb-1 text-xs uppercase tracking-wider text-muted-foreground font-medium">
                    {t("table.columnsProperties")}
                  </Text>
                  {groupable.map((property) => {
                    const key: IssueTableGrouping = `property:${property.id}`;
                    return (
                      <MenuRow
                        key={key}
                        label={property.name}
                        active={grouping === key}
                        indicator="radio"
                        onPress={() => onSelect(key)}
                      />
                    );
                  })}
                </>
              ) : null}
            </ScrollView>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
