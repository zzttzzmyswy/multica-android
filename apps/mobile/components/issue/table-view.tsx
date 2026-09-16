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
 *     (header + rows share one horizontal scroller, so alignment can't
 *     drift).
 *   - CSV export of the visible row set through the same serialization
 *     (`lib/issue-table-export.ts`), shared to the system share sheet.
 *
 * The pinned column's vertical movement is driven by the main list's scroll
 * events (scrollToOffset on a sibling FlatList with the same data + fixed
 * row heights) — the classic dual-list table pattern; both lists feed each
 * other so a gesture starting on either pane scrolls the whole grid.
 */
import {
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
import { formatDateOnly } from "@multica/core/issues/date";
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
  nextTableSort,
  propertyIdFromTableColumn,
  TABLE_SYSTEM_COLUMNS,
  type TableColumnDefinition,
  type TableColumnKey,
  type TableSystemColumn,
} from "@/data/stores/issue-table-columns";
import type {
  IssueSortDirection,
  IssueSortField,
} from "@/data/stores/issue-filter-slice";
import { propertyActiveOptions } from "@/data/queries/properties";
import { projectListOptions } from "@/data/queries/projects";
import { useIssueStatuses } from "@/data/queries/issue-statuses";
import { useStatusLabel } from "@/lib/status-options";
import { formatPropertyValue } from "@/lib/issue-properties";
import {
  buildIssueTableRows,
  MAX_DEPTH,
  type IssueTableRow,
} from "@/lib/issue-table-hierarchy";
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
import { useTranslation } from "@/lib/i18n/react";

/** Fixed row height — the dual-list scroll sync assumes uniform rows. */
const ROW_HEIGHT = 48;
/** Pinned left column width (checkbox + title) at depth 0. */
const PINNED_WIDTH = 176;
/** Width for property (non-system) columns. */
const PROPERTY_COLUMN_WIDTH = 132;
/** Header-row height (pinned cell + column headers share it). */
const HEADER_HEIGHT = 34;
/** Indent per parent hop in the pinned title cell. Web uses 18px on a wide
 *  desktop table; the phone's pinned column has to keep room for the title,
 *  so it indents less and widens itself by the same amount (see
 *  `pinnedWidth` in the component). */
const INDENT_PER_LEVEL = 14;
/** Two taps closer together than this on the pinned title rename the issue
 *  (web's double-click on InlineTitle). */
const DOUBLE_TAP_MS = 280;

/** Per-system-column widths; unknown keys fall back to the property width. */
const COLUMN_WIDTHS: Partial<Record<TableSystemColumn, number>> = {
  identifier: 84,
  status: 104,
  priority: 88,
  assignee: 132,
  labels: 140,
  project: 132,
  start_date: 100,
  due_date: 88,
  created_at: 104,
  updated_at: 104,
  creator: 132,
};

function columnWidth(column: TableColumnKey): number {
  if (column.startsWith("property:")) return PROPERTY_COLUMN_WIDTH;
  return COLUMN_WIDTHS[column as TableSystemColumn] ?? PROPERTY_COLUMN_WIDTH;
}

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
  sortBy: IssueSortField;
  sortDirection: IssueSortDirection;
  /** Header-tap sort: field + explicit direction (surface store setters). */
  onSort: (field: IssueSortField, direction: IssueSortDirection) => void;
  onOpenIssue: (issue: Issue) => void;
  /** Shown when there are no rows (parent surfaces usually pre-empt this). */
  emptyLabel: string;
}

export function IssueTableView({
  issues,
  columns,
  onToggleColumn,
  sortBy,
  sortDirection,
  onSort,
  onOpenIssue,
  emptyLabel,
}: Props) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const statusLabel = useStatusLabel(wsId);
  const { activeStatuses } = useIssueStatuses(wsId);
  const { data: properties = [] } = useQuery(propertyActiveOptions(wsId));
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
  const [exporting, setExporting] = useState(false);
  /** Collapsed parents — local to this table instance (web keeps the same
   *  per-surface expansion state in its table store). Not persisted: a
   *  collapsed subtree is a transient reading aid, not a saved preference. */
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  /** Open inline cell editor, keyed by row + column. */
  const [editorKey, setEditorKey] = useState<{
    issueId: string;
    column: TableColumnKey;
  } | null>(null);
  /** Row being renamed from the pinned title cell. */
  const [renaming, setRenaming] = useState<Issue | null>(null);

  const rows = useMemo(
    () => buildIssueTableRows(issues, collapsedIds),
    [issues, collapsedIds],
  );

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

  // Re-derive from the live rows so the editor always shows the current
  // value (a label toggle keeps the sheet open across writes); a row that
  // leaves the filtered list closes the sheet.
  const editorTarget: CellEditorTarget | null = useMemo(() => {
    if (!editorKey) return null;
    const issue = issues.find((i) => i.id === editorKey.issueId);
    return issue ? { issue, column: editorKey.column } : null;
  }, [editorKey, issues]);

  // --- dual-list vertical sync -------------------------------------------
  const pinRef = useRef<FlatList<IssueTableRow>>(null);
  const mainRef = useRef<FlatList<IssueTableRow>>(null);
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
      {/* Toolbar: column visibility + CSV export */}
      <View className="flex-row items-center justify-between px-4 py-1.5 border-b border-border bg-background">
        <ToolbarButton
          icon="options-outline"
          label={t("table.columns")}
          onPress={() => setColumnMenuOpen(true)}
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
            horizontal
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            style={{ flex: 1 }}
          >
            <View className="flex-row">
              {bodyColumns.map((column) => {
                const def = columnDefinition(column as TableSystemColumn);
                const sortable = !!def?.sortField;
                const field = sortable ? (def.sortField as IssueSortField) : null;
                return (
                  <Pressable
                    key={column}
                    onPress={() => sortable && headerSort(def)}
                    disabled={!sortable}
                    style={{ width: columnWidth(column), height: HEADER_HEIGHT }}
                    className="flex-row items-center gap-1 px-2"
                    accessibilityLabel={
                      sortable ? t("a11y.tableSortColumn") : undefined
                    }
                  >
                    <Text className="text-xs font-semibold text-foreground" numberOfLines={1}>
                      {columnLabel(column)}
                    </Text>
                    {field ? arrowForField(field) : null}
                  </Pressable>
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
              data={rows}
              keyExtractor={(row) => row.issue.id}
              onScroll={syncMain}
              scrollEventThrottle={16}
              initialNumToRender={12}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: bottomPadding }}
              renderItem={({ item }) => (
                <PinnedRow
                  row={item}
                  height={ROW_HEIGHT}
                  selectionMode={selectionMode}
                  selected={selectedIds.has(item.issue.id)}
                  onPressCheckbox={() => {
                    if (selectionMode) toggleSelection(item.issue.id);
                    else enterSelection(item.issue.id);
                  }}
                  onPressRow={() => {
                    if (selectionMode) toggleSelection(item.issue.id);
                    else onOpenIssue(item.issue);
                  }}
                  onLongPress={() => enterSelection(item.issue.id)}
                  onToggleCollapse={() => toggleCollapse(item.issue.id)}
                  onRename={() => setRenaming(item.issue)}
                />
              )}
            />
          </View>
          <ScrollView
            horizontal
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            style={{ flex: 1 }}
          >
            <View
              style={{
                width: bodyColumns.reduce((sum, c) => sum + columnWidth(c), 0),
              }}
            >
              <FlatList
                ref={mainRef}
                data={rows}
                keyExtractor={(row) => row.issue.id}
                onScroll={syncPinned}
                scrollEventThrottle={16}
                initialNumToRender={12}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: bottomPadding }}
                renderItem={({ item }) => (
                  <DataRow
                    issue={item.issue}
                    columns={bodyColumns}
                    height={ROW_HEIGHT}
                    properties={properties}
                    projects={projects}
                    getName={getName}
                    selected={selectedIds.has(item.issue.id)}
                    columnLabel={columnLabel}
                    onPressCell={(column) => {
                      if (selectionMode) toggleSelection(item.issue.id);
                      else if (isEditableTableColumn(column)) {
                        setEditorKey({ issueId: item.issue.id, column });
                      }
                    }}
                  />
                )}
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
        onToggleColumn={onToggleColumn}
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
    </View>
  );
}

/** One scrollable data row: fixed-width cells aligned with the header.
 *  Editable cells are pressable (web mounts an editor on the same cells);
 *  the rest stay inert so a tap on them does nothing rather than opening an
 *  editor that cannot write. */
function DataRow({
  issue,
  columns,
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
  height: number;
  properties: IssueProperty[];
  projects: { id: string; title: string; icon?: string | null }[];
  getName: (
    type: "member" | "agent" | "squad" | null | undefined,
    id: string | null | undefined,
  ) => string;
  selected: boolean;
  columnLabel: (column: TableColumnKey) => string;
  onPressCell: (column: TableColumnKey) => void;
}) {
  const { t } = useTranslation();
  const statusLabel = useStatusLabel();
  const statusEntry = useIssueStatuses().entryOf(issue.status);
  return (
    <View
      style={{ height }}
      className={`flex-row border-b border-border/60 ${selected ? "bg-primary/5" : ""}`}
    >
      {columns.map((column) => {
        const editable = isEditableTableColumn(column);
        return (
          <Pressable
            key={column}
            onPress={editable ? () => onPressCell(column) : undefined}
            disabled={!editable}
            style={{ width: columnWidth(column), height }}
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
  if (!value) return <Text className="text-xs text-muted-foreground/60">—</Text>;
  const text =
    formatDateOnly(value, { month: "short", day: "numeric" }, "en-US") || value;
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
  const day = value.slice(0, 10);
  const text =
    formatDateOnly(day, { month: "short", day: "numeric" }, "en-US") || day;
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

/** Column-visibility menu — checkbox list of system + property columns. */
function ColumnMenu({
  visible,
  onClose,
  columns,
  properties,
  onToggleColumn,
}: {
  visible: boolean;
  onClose: () => void;
  columns: TableColumnKey[];
  properties: IssueProperty[];
  onToggleColumn: (column: TableColumnKey) => void;
}) {
  const { t } = useTranslation();

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
              <Pressable onPress={onClose} hitSlop={8}>
                <Ionicons name="close" size={20} color="currentColor" />
              </Pressable>
            </View>
            <ScrollView className="max-h-[55vh]">
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

function MenuRow({
  label,
  active,
  disabled = false,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { colorScheme } = useColorScheme();
  return (
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
          name={active ? "checkbox" : "square-outline"}
          size={17}
          color={
            active
              ? THEME[colorScheme].primary
              : THEME[colorScheme].mutedForeground
          }
        />
      )}
    </Pressable>
  );
}