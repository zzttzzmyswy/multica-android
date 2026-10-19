/**
 * Autopilots browse page (push screen reached from the More popover).
 * Mirrors web `packages/views/autopilots/components/autopilots-page.tsx`:
 * one row per autopilot — name, status (active/paused/archived pill),
 * trigger kind(s), and next-run time when scheduled. Tapping a row pushes the
 * detail page.
 *
 * Scope / filter / sort (iteration 174): web spreads these across a toolbar
 * with a scope button group, four nested filter submenus and a display
 * popover holding the sort and the column switches. A phone has no hover tree,
 * so the same state is driven by a scope chip row, a filter chip that opens
 * one grouped multi-select sheet, and a sort chip — the shape the skills list
 * already uses. The predicates themselves live in `lib/filter-autopilots.ts`.
 * Column visibility is NOT ported: this list has no columns to hide.
 *
 * Divergence from web (intentional, mobile form factor): web renders
 * assignee / created-by / mode columns; mobile collapses those into the
 * detail page so the list reads as a phone card list — which is exactly why
 * the filter sheet, not the row, is where those dimensions are read.
 *
 * Row actions + batch selection (iteration 229, web parity with
 * `autopilot-list-actions.tsx`): each row carries a kebab (pause / resume /
 * delete) and the header enters a selection mode whose bar pauses, resumes or
 * deletes the whole selection. Before this the only way to change an
 * autopilot's status from the list was to open its detail page.
 *
 * Two more intentional divergences, both from the narrow screen rather than a
 * change of intent:
 *   - Web's column-visibility switch is NOT ported. It is a `@2xl`-breakpoint
 *     desktop-grid affordance — web hides the whole grid below that width — and
 *     a phone has no columns to hide. The one column worth reading on a phone,
 *     "last run", moves into the row's own second line instead.
 *   - Web's menu carries "Open in new tab"; a phone has no tabs and the row tap
 *     already opens the autopilot.
 */
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { create } from "zustand";
import type { Autopilot } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { HeaderSearchGroup } from "@/components/ui/header-search-button";
import { MultiSelectSheet } from "@/components/agent/multi-select-sheet";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { WorkspaceWakeupsTable } from "@/components/autopilot/workspace-wakeups-table";
import { AutopilotRowMenu } from "@/components/autopilot/autopilot-row-menu";
import { AutopilotBatchBar } from "@/components/autopilot/autopilot-batch-bar";
import { DeleteAutopilotsDialog } from "@/components/autopilot/delete-autopilots-dialog";
import { autopilotListOptions } from "@/data/queries/autopilots";
import { useDeleteAutopilot, useUpdateAutopilot } from "@/data/mutations/autopilots";
import { agentListOptions } from "@/data/queries/agents";
import { squadListOptions } from "@/data/queries/squads";
import { memberListOptions } from "@/data/queries/members";
import { useWorkspaceStore } from "@/data/workspace-store";
import { formatDateTime } from "@/lib/autopilot-format";
import { useTimeAgo } from "@/lib/time-ago";
import {
  autopilotStatusPlan,
  canWriteAutopilot,
  lastRunCell,
  runStatusLabel,
  showTriggerDash,
} from "@/lib/autopilot-list-actions";
import { toggleId, toggleSelectAllVisible } from "@/lib/skill-batch";
import {
  AUTOPILOT_TEMPLATES,
  type AutopilotTemplate,
  type AutopilotTemplateId,
} from "@/lib/autopilot-templates";
import {
  AUTOPILOT_MODES,
  AUTOPILOT_SCOPES,
  AUTOPILOT_SORT_DEFAULT_DIRECTION,
  AUTOPILOT_SORT_FIELDS,
  AUTOPILOT_TRIGGER_KINDS,
  EMPTY_AUTOPILOT_FILTERS,
  actorFilterValue,
  autopilotFilterKey,
  autopilotScopeCounts,
  autopilotScopeRows,
  countActiveAutopilotFilterDimensions,
  filterAutopilotRows,
  parseAutopilotFilterKey,
  sortAutopilotRows,
  toggleAutopilotFilter,
  type AutopilotListFilters,
  type AutopilotScope,
  type AutopilotSortDirection,
  type AutopilotSortField,
} from "@/lib/filter-autopilots";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { ActionSheet } from "@/lib/action-sheet";
import { catalogRead, retryCatalogs } from "@/lib/catalog-read";
import { pauseStatusLabelKey } from "@/lib/autopilot-pause";
import { aggregateCatalogState } from "@/lib/catalog-state";
import type { CatalogState } from "@/lib/catalog-state";
import { cn } from "@/lib/utils";

// Server-driven enum: unknown statuses degrade to the neutral pill (the
// backend is the gate; a future value must not collapse the list).
const STATUS_PILL: Record<string, { label: string; className: string }> = {
  active: {
    label: "autopilots.status.active",
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  paused: {
    label: "autopilots.status.paused",
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  archived: {
    label: "autopilots.status.archived",
    className: "bg-muted text-muted-foreground",
  },
};

function statusPill(status: string | undefined) {
  return (status && STATUS_PILL[status]) || {
    label: status ?? "",
    className: "bg-muted text-muted-foreground",
  };
}

/**
 * The pill a ROW renders.
 *
 * A system pause reads differently from a user pause (iteration 258,
 * MYS-2236): the row says 「已暂停——执行智能体需绑定运行时」 instead of the bare
 * status word, because the two states look identical on a phone and only one
 * of them is fixed by the switch on the detail page. Web makes the same split
 * for the paused marker's tooltip (`autopilots-page.tsx:255-256`); a phone has
 * no tooltip, so the distinction has to be in the visible text.
 *
 * The amber colour is shared with the ordinary paused pill — it is still a
 * pause, and colouring it as an error would misstate who caused it.
 */
function rowStatusPill(autopilot: Autopilot) {
  const base = statusPill(autopilot.status);
  const pauseKey = pauseStatusLabelKey(autopilot);
  return pauseKey ? { ...base, label: pauseKey } : base;
}

// Trigger glyph per kind — mirrors web TRIGGER_ICONS. Unknown kinds get the
// generic flash.
const TRIGGER_ICONS: Record<
  string,
  React.ComponentProps<typeof Ionicons>["name"]
> = {
  schedule: "calendar-outline",
  webhook: "link-outline",
  api: "code-slash-outline",
};

function triggerLabel(kind: string, t: (id: string) => string): string | null {
  if (kind === "schedule" || kind === "webhook" || kind === "api") {
    return t(`autopilots.triggerKind.${kind}`);
  }
  return kind;
}

// Empty-state quick-start templates — icon mapping for the six web templates
// (autopilots-page.tsx TEMPLATES). Unknown ids fall back to the generic flash.
const TEMPLATE_ICONS: Record<
  AutopilotTemplateId,
  React.ComponentProps<typeof Ionicons>["name"]
> = {
  daily_news: "newspaper-outline",
  pr_review: "git-pull-request-outline",
  bug_triage: "bug-outline",
  weekly_progress: "bar-chart-outline",
  dependency_audit: "shield-checkmark-outline",
  documentation_check: "document-text-outline",
};

const SORT_LABEL_KEY: Record<AutopilotSortField, string> = {
  name: "autopilots.list.sortField.name",
  lastRun: "autopilots.list.sortField.lastRun",
  nextRun: "autopilots.list.sortField.nextRun",
  created: "autopilots.list.sortField.created",
};

/**
 * Session-scoped scope/sort/filter choice for the autopilots list.
 * Deliberately not persisted, matching the skills and agents lists: a phone
 * has no header row showing the active scope and filters, so a narrowed list
 * that survived a restart would read as missing data.
 */
interface AutopilotMobileViewState {
  scope: AutopilotScope;
  sortField: AutopilotSortField;
  sortDirection: AutopilotSortDirection;
  filters: AutopilotListFilters;
  setScope: (scope: AutopilotScope) => void;
  setSort: (field: AutopilotSortField, direction: AutopilotSortDirection) => void;
  toggleFilter: (key: string) => void;
  clearFilters: () => void;
}

export const useAutopilotMobileViewStore = create<AutopilotMobileViewState>()(
  (set) => ({
    scope: "all",
    sortField: "lastRun",
    sortDirection: AUTOPILOT_SORT_DEFAULT_DIRECTION.lastRun,
    filters: EMPTY_AUTOPILOT_FILTERS,
    setScope: (scope) => set({ scope }),
    setSort: (sortField, sortDirection) => set({ sortField, sortDirection }),
    toggleFilter: (key) =>
      set((state) => {
        const parsed = parseAutopilotFilterKey(key);
        if (!parsed) return {};
        return {
          filters: toggleAutopilotFilter(
            state.filters,
            parsed.dimension,
            parsed.value,
          ),
        };
      }),
    clearFilters: () => set({ filters: EMPTY_AUTOPILOT_FILTERS }),
  }),
);

export default function AutopilotsPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;

  const { data, isLoading, error, refetch, isRefetching } = useQuery(
    autopilotListOptions(wsId),
  );
  const agentsRead = catalogRead(useQuery(agentListOptions(wsId)));
  const squadsRead = catalogRead(useQuery(squadListOptions(wsId)));
  const membersRead = catalogRead(useQuery(memberListOptions(wsId)));
  const agents = agentsRead.items;
  const squads = squadsRead.items;
  const members = membersRead.items;

  const [filterOpen, setFilterOpen] = useState(false);
  // Web's 自动化 page is a Tabs holding 自动化 and 任务唤醒. Mobile had no tab
  // structure at all; this is that choice, as a segmented control above the
  // list — the shape the projects and skills lists already use.
  const [tab, setTab] = useState<"autopilots" | "wakeups">("autopilots");
  // Owned here rather than in the table so the header action can open it; the
  // table mounts the picker + form when it is set.
  const [wakeupCreateOpen, setWakeupCreateOpen] = useState(false);
  const scope = useAutopilotMobileViewStore((s) => s.scope);
  const sortField = useAutopilotMobileViewStore((s) => s.sortField);
  const sortDirection = useAutopilotMobileViewStore((s) => s.sortDirection);
  const filters = useAutopilotMobileViewStore((s) => s.filters);
  const setScope = useAutopilotMobileViewStore((s) => s.setScope);
  const setSort = useAutopilotMobileViewStore((s) => s.setSort);
  const toggleFilter = useAutopilotMobileViewStore((s) => s.toggleFilter);
  const clearFilters = useAutopilotMobileViewStore((s) => s.clearFilters);

  const autopilots = useMemo(() => data ?? [], [data]);

  // Scope counts come from the FULL set — they are stage inventories, not
  // result counts, so filters never move them.
  const scopeCounts = useMemo(
    () => autopilotScopeCounts(autopilots),
    [autopilots],
  );
  const scopeRows = useMemo(
    () => autopilotScopeRows(autopilots, scope),
    [autopilots, scope],
  );
  const rows = useMemo(
    () =>
      sortAutopilotRows(
        filterAutopilotRows(scopeRows, filters),
        sortField,
        sortDirection,
      ),
    [scopeRows, filters, sortField, sortDirection],
  );

  const narrowed = countActiveAutopilotFilterDimensions(filters) > 0;
  const showEmpty = !isLoading && !error && autopilots.length === 0;

  // ── Row actions + batch selection (MYS-2096) ────────────────────────────
  // Web's list carries a per-row kebab and a batch toolbar; mobile had neither,
  // so pausing one autopilot meant opening its detail page. Both write paths
  // live HERE so the kebab, the toolbar and (via the same hooks) the detail
  // page share one optimistic implementation — web's split exactly, where
  // `useSetStatus` is defined once and called by both `AutopilotRowActions` and
  // `AutopilotBatchToolbar`.
  const updateAutopilot = useUpdateAutopilot();
  const deleteAutopilot = useDeleteAutopilot();
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // One dialog for both entry points (web's `DeleteAutopilotsDialog`), holding
  // the rows it was opened for — a single row from a kebab, N from the bar —
  // plus whether it was the batch entry point (see `openDelete`).
  const [pendingDelete, setPendingDelete] = useState<{
    rows: Autopilot[];
    batch: boolean;
  } | null>(null);

  const visibleIds = useMemo(() => rows.map((r) => r.id), [rows]);
  // The selection is intersected with the VISIBLE rows, so a row that left the
  // list (refetch, delete, a filter the user just applied) can never ride along
  // into a batch write. Same rule as the skills list.
  const selectedRows = useMemo(
    () => rows.filter((r) => selectedIds.has(r.id)),
    [rows, selectedIds],
  );
  const allVisibleSelected =
    visibleIds.length > 0 &&
    visibleIds.every((id) => selectedIds.has(id));

  const enterSelection = useCallback((id: string) => {
    setSelectionMode(true);
    setSelectedIds(new Set([id]));
  }, []);

  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggleRow = useCallback((id: string) => {
    setSelectedIds((prev) => toggleId(prev, id));
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds((prev) => toggleSelectAllVisible(visibleIds, prev));
  }, [visibleIds]);

  /** Pause / resume one row from its kebab. Failures surface through
   *  `useUpdateAutopilot`'s own write-failure alert (the optimistic flip is
   *  rolled back too), so no per-call handler here — that would double-report. */
  const setRowStatus = useCallback(
    (row: Autopilot, status: "active" | "paused") => {
      updateAutopilot.mutate({ id: row.id, status });
    },
    [updateAutopilot],
  );

  /** Batch pause / resume. Only the rows that are not already in the target
   *  status are written — web's `useSetStatus` `continue` rule (`:107`) — so
   *  pausing a mixed selection costs one request per active row, not one per
   *  selected row. */
  const setSelectionStatus = useCallback(
    (status: "active" | "paused") => {
      for (const row of autopilotStatusPlan(selectedRows, status)) {
        updateAutopilot.mutate({ id: row.id, status });
      }
      exitSelection();
    },
    [selectedRows, updateAutopilot, exitSelection],
  );

  /** Open the shared confirm for one row (the kebab) or for the whole selection
   *  (the toolbar). `batch` is what decides whether the confirm also clears the
   *  selection: web passes `onDeleted` from the toolbar only
   *  (`autopilot-list-actions.tsx:279` vs `:203`), because a kebab-deleted row
   *  has nothing to do with whatever else happens to be selected. */
  const openDelete = useCallback(
    (rows: Autopilot[], batch: boolean) => {
      setPendingDelete({ rows, batch });
    },
    [],
  );

  /** Runs the dialog's loop. Sequential, as web's is: the confirm dialog stays
   *  up until the batch settles, and the copy promises a specific count. */
  const confirmDelete = useCallback(async () => {
    const pending = pendingDelete;
    for (const row of pending?.rows ?? []) {
      await deleteAutopilot.mutateAsync(row.id).catch(() => {
        // Already reported by the hook's write-failure title; the dialog closes
        // regardless so the user is never stranded behind a failed row.
      });
    }
    // Only a batch delete ends the selection mode — see `openDelete`.
    if (pending?.batch) exitSelection();
  }, [pendingDelete, deleteAutopilot, exitSelection]);

  /** Polymorphic actor label — agents, squads and members share one id space
   *  only through the `type:id` filter value, so resolution is by type. */
  const actorName = useCallback(
    (type: string, id: string): string => {
      if (type === "agent") return agents.find((a) => a.id === id)?.name ?? id;
      if (type === "squad") return squads.find((s) => s.id === id)?.name ?? id;
      return members.find((m) => m.user_id === id)?.name ?? id;
    },
    [agents, squads, members],
  );

  const headerRight = useCallback(() => {
    if (!wsSlug) return null;
    // The header action belongs to the ACTIVE tab, as web's does: 自动化 adds an
    // autopilot, 任务唤醒 adds a wakeup, and the two land on different routes.
    if (tab === "wakeups") {
      return (
        <HeaderSearchGroup>
          <IconButton
            name="add"
            onPress={() => setWakeupCreateOpen(true)}
            accessibilityLabel={t("autopilots.wakeups.create")}
          />
        </HeaderSearchGroup>
      );
    }
    return (
      <HeaderSearchGroup>
        {/* Selection toggle, as web's header checkbox cell provides. It sits
            BEFORE the add button, so the create action keeps its position and
            the strip does not reflow when the mode flips. */}
        <IconButton
          name={selectionMode ? "close" : "checkbox-outline"}
          onPress={() => {
            if (selectionMode) exitSelection();
            else setSelectionMode(true);
          }}
          accessibilityLabel={
            selectionMode
              ? t("autopilots.list.exitSelection")
              : t("autopilots.list.enterSelection")
          }
        />
        <IconButton
          name="add"
          onPress={() => router.push(`/${wsSlug}/more/autopilots/new`)}
          accessibilityLabel={t("autopilots.new.title")}
        />
      </HeaderSearchGroup>
    );
  }, [wsSlug, t, tab, selectionMode, exitSelection]);

  return (
    <>
      <Stack.Screen options={{ headerRight }} />
      <View className="flex-1 bg-background">
      {/* The tab strip sits above BOTH bodies, loading and error states
          included: the wakeups tab has its own read, so an autopilot list that
          failed to load must not hide the tab that still works. */}
      <View className="px-4 pt-2 pb-1">
        <SegmentedControl
          options={[
            { value: "autopilots", label: t("autopilots.wakeups.tab") },
            { value: "wakeups", label: t("autopilots.wakeups.title") },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>
      {tab === "wakeups" ? (
        <WorkspaceWakeupsTable
          createOpen={wakeupCreateOpen}
          onCreateClose={() => setWakeupCreateOpen(false)}
        />
      ) : isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : error ? (
        <View className="px-4 gap-3 pt-4">
          <Text className="text-body text-destructive">
            {t("autopilots.loadError")}
            {error instanceof Error ? error.message : t("common.unknownError")}
          </Text>
          <Button variant="outline" onPress={() => refetch()}>
            <Text>{t("workspace.retry")}</Text>
          </Button>
        </View>
      ) : showEmpty ? (
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-5 py-12 items-center"
        >
          <Ionicons name="flash-off-outline" size={32} color={muted} />
          <Text className="text-body text-muted-foreground text-center mt-2">
            {t("autopilots.empty")}
          </Text>
          <Text className="text-caption text-muted-foreground/70 text-center mt-1 max-w-[320px]">
            {t("autopilots.emptyHint")}
          </Text>
          <View className="flex-row flex-wrap justify-center gap-3 mt-6 w-full max-w-[420px]">
            {AUTOPILOT_TEMPLATES.map((tpl) => (
              <TemplateCard
                key={tpl.id}
                tpl={tpl}
                onPress={() => {
                  if (wsSlug)
                    router.push(
                      `/${wsSlug}/more/autopilots/new?template=${tpl.id}`,
                    );
                }}
              />
            ))}
          </View>
          <Button
            variant="outline"
            className="mt-6 self-center"
            onPress={() => {
              if (wsSlug) router.push(`/${wsSlug}/more/autopilots/new`);
            }}
          >
            <Ionicons name="add" size={16} color={muted} />
            <Text>{t("autopilots.startBlank")}</Text>
          </Button>
        </ScrollView>
      ) : (
        <>
          <View className="border-b border-border px-4 py-2 gap-2">
            {/* Scope — the promoted status dimension, so it is not repeated
                inside the filter sheet. */}
            <View className="flex-row gap-2" accessibilityRole="tablist">
              {AUTOPILOT_SCOPES.map((option) => {
                const active = scope === option;
                return (
                  <Pressable
                    key={option}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    onPress={() => setScope(option)}
                    className={cn(
                      "flex-row items-center gap-1.5 rounded-md border px-2.5 py-1.5 active:opacity-70",
                      active
                        ? "border-brand bg-brand/10"
                        : "border-border bg-secondary/50",
                    )}
                  >
                    <Text
                      className={cn(
                        "text-caption font-medium",
                        active ? "text-brand" : "text-muted-foreground",
                      )}
                    >
                      {option === "all"
                        ? t("autopilots.list.scopeAll")
                        : t(`autopilots.status.${option}`)}
                    </Text>
                    <Text className="text-caption tabular-nums text-muted-foreground">
                      {scopeCounts[option]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View className="flex-row items-center gap-2">
              {narrowed ? (
                <Text
                  className="flex-1 text-caption tabular-nums text-muted-foreground"
                  accessibilityLabel={t("autopilots.list.resultCount", {
                    visible: rows.length,
                    total: scopeRows.length,
                  })}
                >
                  {t("autopilots.list.resultCount", {
                    visible: rows.length,
                    total: scopeRows.length,
                  })}
                </Text>
              ) : (
                <View className="flex-1" />
              )}
              <AutopilotFilterChip
                activeCount={countActiveAutopilotFilterDimensions(filters)}
                onPress={() => setFilterOpen(true)}
              />
              <AutopilotSortChip
                sortField={sortField}
                sortDirection={sortDirection}
                onChange={setSort}
              />
            </View>
          </View>

          <FlatList
            data={rows}
            keyExtractor={(item) => item.id}
            ItemSeparatorComponent={() => <View className="h-px bg-border ml-4" />}
            contentContainerStyle={{
              // Room for the floating batch bar so the last row stays tappable.
              paddingBottom: selectionMode && selectedRows.length > 0 ? 132 : 24,
            }}
            renderItem={({ item }) => (
              <AutopilotRow
                autopilot={item}
                selectionMode={selectionMode}
                selected={selectedIds.has(item.id)}
                onPress={() => {
                  // In selection mode a row tap toggles, exactly as the skills
                  // list does — navigating away mid-selection would lose the
                  // batch the user is assembling.
                  if (selectionMode) toggleRow(item.id);
                  else if (wsSlug)
                    router.push(`/${wsSlug}/more/autopilots/${item.id}`);
                }}
                onLongPress={() => enterSelection(item.id)}
                onPressCheckbox={() => {
                  if (selectionMode) toggleRow(item.id);
                  else enterSelection(item.id);
                }}
                onStatusChange={setRowStatus}
                onDelete={(row) => openDelete([row], false)}
                canWrite={canWriteAutopilot(item)}
              />
            )}
            refreshing={isRefetching}
            onRefresh={refetch}
            ListEmptyComponent={
              <View className="flex-1 items-center justify-center px-6 py-10">
                <Text className="text-body text-muted-foreground text-center">
                  {narrowed
                    ? t("autopilots.list.noMatches")
                    : t("autopilots.empty")}
                </Text>
              </View>
            }
          />
          {selectionMode ? (
            <AutopilotBatchBar
              rows={selectedRows}
              allVisibleSelected={allVisibleSelected}
              onToggleSelectAll={selectAll}
              onExit={exitSelection}
              onStatusChange={setSelectionStatus}
              onDelete={() => openDelete([...selectedRows], true)}
            />
          ) : null}
        </>
      )}
      </View>
      {/* Shared by the kebab and the batch bar, as web's dialog is. */}
      <DeleteAutopilotsDialog
        rows={pendingDelete?.rows ?? []}
        visible={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
      <AutopilotFilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        rows={scopeRows}
        filters={filters}
        actorName={actorName}
        state={aggregateCatalogState([
          agentsRead.state,
          squadsRead.state,
          membersRead.state,
        ])}
        onRetry={() => retryCatalogs(agentsRead, squadsRead, membersRead)}
        onToggle={toggleFilter}
        onClear={clearFilters}
      />
    </>
  );
}

/**
 * Filter chip. Carries only the number of active dimensions, never a label —
 * web does the same below `md`, and "1 filters" is what a phone would read
 * otherwise (the app's `translate` does not resolve plurals).
 */
function AutopilotFilterChip({
  activeCount,
  onPress,
}: {
  activeCount: number;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const active = activeCount > 0;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("autopilots.list.filter")}
      className={
        active
          ? "flex-row items-center gap-1 rounded-md border border-transparent bg-brand px-2 py-1.5 active:opacity-70"
          : "flex-row items-center gap-1 rounded-md border border-border bg-secondary/50 px-2 py-1.5 active:opacity-70"
      }
    >
      <Ionicons
        name="filter"
        size={14}
        color={active ? THEME[colorScheme].primaryForeground : muted}
      />
      {active ? (
        <Text
          className="text-caption font-medium tabular-nums"
          style={{ color: THEME[colorScheme].primaryForeground }}
        >
          {activeCount}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Sort chip — same field+direction pairing the skills list uses, so the two
 *  lists offer their sort the same way. */
function AutopilotSortChip({
  sortField,
  sortDirection,
  onChange,
}: {
  sortField: AutopilotSortField;
  sortDirection: AutopilotSortDirection;
  onChange: (field: AutopilotSortField, direction: AutopilotSortDirection) => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;

  const options: {
    field: AutopilotSortField;
    direction: AutopilotSortDirection;
    label: string;
  }[] = [];
  for (const field of AUTOPILOT_SORT_FIELDS) {
    const defaultDir = AUTOPILOT_SORT_DEFAULT_DIRECTION[field];
    options.push({ field, direction: defaultDir, label: t(SORT_LABEL_KEY[field]) });
    if (sortField === field) {
      options.push({
        field,
        direction: defaultDir === "asc" ? "desc" : "asc",
        label: `${t(SORT_LABEL_KEY[field])} (${
          defaultDir === "asc"
            ? t("autopilots.list.sortDescending")
            : t("autopilots.list.sortAscending")
        })`,
      });
    }
  }

  const openSortPicker = () => {
    const labels = options.map((o) => o.label);
    ActionSheet.showActionSheetWithOptions(
      {
        title: t("autopilots.list.sort"),
        options: [...labels, t("common.cancel")],
        cancelButtonIndex: labels.length,
      },
      (index) => {
        if (index === undefined || index < 0 || index >= options.length) return;
        const option = options[index]!;
        onChange(option.field, option.direction);
      },
    );
  };

  const defaultDir = AUTOPILOT_SORT_DEFAULT_DIRECTION[sortField];
  const activeLabel =
    sortDirection === defaultDir
      ? t(SORT_LABEL_KEY[sortField])
      : `${t(SORT_LABEL_KEY[sortField])} (${
          sortDirection === "asc"
            ? t("autopilots.list.sortAscending")
            : t("autopilots.list.sortDescending")
        })`;

  return (
    <Pressable
      onPress={openSortPicker}
      accessibilityRole="button"
      accessibilityLabel={t("autopilots.list.sort")}
      className="flex-row items-center gap-1 rounded-md border border-border bg-secondary/50 px-2 py-1.5 active:opacity-70"
    >
      <Ionicons name="swap-vertical" size={14} color={muted} />
      <Text className="text-caption text-muted-foreground" numberOfLines={1}>
        {activeLabel}
      </Text>
    </Pressable>
  );
}

/**
 * The four filter dimensions as one grouped multi-select sheet.
 *
 * Web nests them under a Filter dropdown; on a phone they become labelled
 * groups of a single sheet, which is also what makes a cross-dimension search
 * possible. Option lists and their counts come from the scope's UNFILTERED
 * rows, so toggling one dimension never makes the others' options vanish
 * (web's `allRows` contract).
 */
function AutopilotFilterSheet({
  visible,
  onClose,
  rows,
  filters,
  actorName,
  state,
  onRetry,
  onToggle,
  onClear,
}: {
  visible: boolean;
  onClose: () => void;
  rows: Autopilot[];
  filters: AutopilotListFilters;
  actorName: (type: string, id: string) => string;
  /** Load state over the three directories `actorName` resolves through — a
   *  failed read showed an id stub (or 「无匹配结果。」) rather than the actor. */
  state?: CatalogState;
  onRetry?: () => void;
  onToggle: (key: string) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();

  const groups = useMemo(() => {
    const assigneeOptions = new Map<string, { type: string; id: string; count: number }>();
    const creatorOptions = new Map<string, { type: string; id: string; count: number }>();
    const modeCounts = new Map<string, number>();
    const triggerKindCounts = new Map<string, number>();

    for (const row of rows) {
      const aKey = actorFilterValue(row.assignee_type, row.assignee_id);
      const assignee = assigneeOptions.get(aKey);
      if (assignee) assignee.count += 1;
      else
        assigneeOptions.set(aKey, {
          type: row.assignee_type,
          id: row.assignee_id,
          count: 1,
        });

      const cKey = actorFilterValue(row.created_by_type, row.created_by_id);
      const creator = creatorOptions.get(cKey);
      if (creator) creator.count += 1;
      else
        creatorOptions.set(cKey, {
          type: row.created_by_type,
          id: row.created_by_id,
          count: 1,
        });

      modeCounts.set(
        row.execution_mode,
        (modeCounts.get(row.execution_mode) ?? 0) + 1,
      );
      for (const kind of row.trigger_kinds ?? []) {
        triggerKindCounts.set(kind, (triggerKindCounts.get(kind) ?? 0) + 1);
      }
    }

    const withCount = (label: string, count: number) => `${label} · ${count}`;

    return [
      {
        label: t("autopilots.list.filterGroupAssignee"),
        rows: [...assigneeOptions.entries()].map(([key, { type, id, count }]) => ({
          key: autopilotFilterKey("assignees", key),
          title: withCount(actorName(type, id), count),
        })),
      },
      {
        label: t("autopilots.list.filterGroupTrigger"),
        // Kinds nobody uses are omitted rather than shown at 0 — web filters
        // its trigger submenu the same way.
        rows: AUTOPILOT_TRIGGER_KINDS.filter((kind) =>
          triggerKindCounts.has(kind),
        ).map((kind) => ({
          key: autopilotFilterKey("triggerKinds", kind),
          title: withCount(
            t(`autopilots.triggerKind.${kind}`),
            triggerKindCounts.get(kind) ?? 0,
          ),
        })),
      },
      {
        label: t("autopilots.list.filterGroupMode"),
        // Modes are always offered, as on web (both are structural, not
        // data-driven).
        rows: AUTOPILOT_MODES.map((mode) => ({
          key: autopilotFilterKey("modes", mode),
          title: withCount(
            mode === "create_issue"
              ? t("autopilots.executionMode.createIssue")
              : t("autopilots.executionMode.runOnly"),
            modeCounts.get(mode) ?? 0,
          ),
        })),
      },
      {
        label: t("autopilots.list.filterGroupCreator"),
        rows: [...creatorOptions.entries()].map(([key, { type, id, count }]) => ({
          key: autopilotFilterKey("creators", key),
          title: withCount(actorName(type, id), count),
        })),
      },
    ].filter((group) => group.rows.length > 0);
  }, [rows, t, actorName]);

  const selectedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const value of filters.assignees)
      keys.add(autopilotFilterKey("assignees", value));
    for (const value of filters.modes)
      keys.add(autopilotFilterKey("modes", value));
    for (const value of filters.triggerKinds)
      keys.add(autopilotFilterKey("triggerKinds", value));
    for (const value of filters.creators)
      keys.add(autopilotFilterKey("creators", value));
    return keys;
  }, [filters]);

  const hasActiveFilters = countActiveAutopilotFilterDimensions(filters) > 0;

  return (
    <MultiSelectSheet
      visible={visible}
      title={t("autopilots.list.filterTitle")}
      groups={groups}
      state={state}
      onRetry={onRetry}
      searchPlaceholder={t("autopilots.list.filterSearch")}
      selectedKeys={selectedKeys}
      emptyText={t("autopilots.list.noMatches")}
      noMatchText={t("autopilots.list.filterNoMatch")}
      onToggle={onToggle}
      onClose={onClose}
      footer={
        hasActiveFilters ? (
          <Pressable
            accessibilityRole="button"
            onPress={onClear}
            className="px-4 py-3 active:bg-secondary"
          >
            <Text className="text-body text-brand">
              {t("autopilots.list.filterClear")}
            </Text>
          </Pressable>
        ) : null
      }
    />
  );
}

function AutopilotRow({
  autopilot,
  selectionMode,
  selected,
  onPress,
  onLongPress,
  onPressCheckbox,
  onStatusChange,
  onDelete,
  canWrite,
}: {
  autopilot: Autopilot;
  selectionMode: boolean;
  selected: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onPressCheckbox: () => void;
  onStatusChange: (row: Autopilot, status: "active" | "paused") => void;
  onDelete: (row: Autopilot) => void;
  /** Web hides the kebab outright for a member without write; passed in so the
   *  row does not re-derive it from a different rule than the helper's. */
  canWrite: boolean;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const muted = theme.mutedForeground;
  const timeAgo = useTimeAgo();
  const pill = rowStatusPill(autopilot);
  const kinds = autopilot.trigger_kinds ?? [];
  const lastRun = lastRunCell(autopilot, timeAgo);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      className={
        selected ? "px-4 py-3 bg-secondary/60" : "px-4 py-3 active:bg-secondary"
      }
    >
      <View className="flex-row items-center gap-2">
        {selectionMode ? (
          <Pressable
            onPress={onPressCheckbox}
            hitSlop={8}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={t("autopilots.list.selectOne", {
              name: autopilot.title,
            })}
          >
            <Ionicons
              name={selected ? "checkbox" : "square-outline"}
              size={20}
              color={selected ? theme.primary : muted}
            />
          </Pressable>
        ) : (
          <Ionicons name="flash" size={16} color={muted} />
        )}
        <Text
          className="flex-1 text-body font-medium text-foreground"
          numberOfLines={1}
        >
          {autopilot.title}
        </Text>
        <View
          className={cn(
            "px-2 py-0.5 rounded-full border border-border",
            pill.className,
          )}
        >
          <Text className="text-micro font-medium">
            {pill.label.startsWith("autopilots.") ? t(pill.label) : pill.label}
          </Text>
        </View>
        {/* Web hides the kebab entirely for a member without write. In
            selection mode it gives way to the checkbox — a row carries one
            trailing control, and picking is what the mode is for. */}
        {!selectionMode && canWrite ? (
          <AutopilotRowMenu
            autopilot={autopilot}
            onStatusChange={onStatusChange}
            onDelete={onDelete}
          />
        ) : null}
      </View>
      <View
        className={cn(
          // `flex-wrap` matters now that last-run joined this line: a row with
          // two trigger kinds plus both times is wider than a 411dp screen, and
          // without wrapping the next-run time clips off the edge silently.
          "flex-row flex-wrap items-center gap-x-2 gap-y-0.5 mt-1.5",
          // The checkbox replaces the flash glyph, which is narrower than the
          // 20pt box — the indent follows whichever leads the row.
          selectionMode ? "ml-7" : "ml-6",
        )}
      >
        {/* Trigger slot. Three states, because this line is a single run of
            items with no column headers to tell two dashes apart — see
            `showTriggerDash`. */}
        {kinds.length > 0 ? (
          kinds.map((kind) => {
            const label = triggerLabel(kind, t);
            return (
              <View key={kind} className="flex-row items-center gap-1">
                <Ionicons
                  name={TRIGGER_ICONS[kind] ?? "flash-outline"}
                  size={12}
                  color={muted}
                />
                <Text className="text-caption text-muted-foreground">
                  {label ?? kind}
                </Text>
              </View>
            );
          })
        ) : showTriggerDash(kinds, lastRun) ? (
          <Text className="text-caption text-muted-foreground/60">—</Text>
        ) : null}
        {/* Last run — web's `LastRunCell` (autopilots-page.tsx:343). The data
            was already on every list object (`last_run_at` / `last_run_status`)
            and went unrendered, so this adds no request. Web hides the whole
            cell below `@2xl` and offers a column switch instead; a phone has no
            columns to toggle, so the fact moves into the row's second line,
            where the next-run time already sits.

            Web states the status twice: the dot's colour, and a `title`
            tooltip naming it. A colour is not information a screen reader (or
            a colour-blind reader) can use, so the a11y label carries web's
            tooltip text — the dot itself is decorative.

            `accessible` + `accessibilityRole="text"` is what makes that label
            reach uiautomator with no child strings: a bare `View` with a label
            emits no node of its own, so the label would be silently dropped
            (the row's own accessible Pressable swallows descendant text, which
            is why the dot and the relative time appear nowhere else either). */}
        {lastRun.kind === "absent" ? (
          <View
            accessible
            accessibilityRole="text"
            accessibilityLabel={t("autopilots.list.noLastRun")}
            className="flex-row items-center gap-1"
          >
            <Text className="text-caption text-muted-foreground/60">—</Text>
          </View>
        ) : (
          <View
            accessible
            accessibilityRole="text"
            className="flex-row items-center gap-1"
            accessibilityLabel={t("autopilots.list.runStatusAria", {
              status: runStatusLabel(autopilot.last_run_status, t),
            })}
          >
            <View
              className={cn("size-1.5 rounded-full", lastRun.dotClass)}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
            <Text className="text-caption text-muted-foreground tabular-nums">
              {lastRun.label}
            </Text>
          </View>
        )}
        {autopilot.next_run_at ? (
          <View className="flex-row items-center gap-1">
            <Ionicons name="time-outline" size={12} color={muted} />
            <Text className="text-caption text-muted-foreground tabular-nums">
              {formatDateTime(autopilot.next_run_at)}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/** One empty-state quick-start card — icon + title + 2-line summary, matching
 *  web autopilots-page.tsx TEMPLATES cards. Tapping pre-fills the create
 *  form (title / prompt / schedule) via the `template` route param. */
function TemplateCard({
  tpl,
  onPress,
}: {
  tpl: AutopilotTemplate;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const icon = TEMPLATE_ICONS[tpl.id];

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t(`autopilots.templates.${tpl.id}.title`)}
      className="w-[47%] active:bg-secondary flex-row items-start gap-2.5 rounded-lg border border-border p-3"
    >
      <Ionicons name={icon} size={18} color={muted} className="mt-0.5" />
      <View className="min-w-0 flex-1">
        <Text
          className="text-body font-medium text-foreground"
          numberOfLines={1}
        >
          {t(`autopilots.templates.${tpl.id}.title`)}
        </Text>
        <Text
          className="mt-0.5 text-caption text-muted-foreground leading-snug"
          numberOfLines={2}
        >
          {t(`autopilots.templates.${tpl.id}.summary`)}
        </Text>
      </View>
    </Pressable>
  );
}
