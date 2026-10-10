/**
 * Issue filter sheet — status / priority / assignee / creator / project /
 * label filters + sort + grouping. Presented as a formSheet by the parent
 * Stack. Shared by My Issues, the workspace-wide Issues page and the
 * project-detail issue surface; which view-store to read/write is selected
 * by the `scope` URL param.
 *
 * Routes that open this sheet:
 *   - /[workspace]/issues-filter?scope=my      →  useMyIssuesViewStore
 *   - /[workspace]/issues-filter?scope=all     →  useIssuesViewStore
 *   - /[workspace]/issues-filter?scope=project →  useProjectIssuesViewStore
 *
 * Self-contained: reads/writes the store directly, no callback passing.
 *
 * Multi-value dimensions (assignee / creator / project / label) open the
 * `issues-filter-picker` sub-sheet (same scope), which toggles the store
 * and stays open across taps — positive-selection set semantics matching
 * web's view-store FilterSnapshot. The chips bar on the list pages shows
 * what is active; this panel is the editing surface.
 *
 * Sort / grouping mirror web's SORT_OPTIONS + GROUPING_OPTIONS
 * (packages/core/issues/stores/view-store.ts:145-159).
 */
import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { IssuePriority } from "@multica/core/types";
import { isFilterablePropertyType } from "@multica/core/types";
import { addDaysDateOnly, todayDateOnly } from "@multica/core/issues/date";
import { Text } from "@/components/ui/text";
import { StatusIcon } from "@/components/ui/status-icon";
import { PriorityIcon } from "@/components/ui/priority-icon";
import {
  issueFilterStoreForScope,
  parseFilterScope,
  type IssueFilterScope,
} from "@/data/stores/issue-filter-store-registry";
import { useActivePropertyCatalog } from "@/data/queries/properties";
import { PropertyCatalogStatus } from "@/components/property/property-catalog-status";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  ISSUE_GROUPING_OPTIONS,
  ISSUE_SORT_OPTIONS,
  hasActiveIssueFilters,
  propertyViewKey,
  type CardProperties,
  type IssueDateFilterValue,
  type IssueFilterSlice,
  type IssueGrouping,
  type IssueSortField,
  type IssueViewMode,
} from "@/data/stores/issue-filter-slice";
import {
  isGroupableProperty,
  isSortableProperty,
} from "@/lib/property-catalog";
import { useStatusOptions } from "@/lib/status-options";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/react";
import { buildIssueWindow } from "@/data/stores/issue-filter-slice";
import { useFilterSheetFacetCounts } from "@/data/queries/issue-facets";
import { useRunningIssueIds } from "@/data/queries/agent-task-snapshot";
import {
  countWorkingOnly,
  withWorkingCountDimension,
} from "@/lib/issue-table-group-counts";
import {
  NO_VALUE_KEY,
  facetValuesFor,
  propertyFacetable,
} from "@/lib/issue-facet-counts";

// Mirrors PRIORITY_ORDER in packages/core/issues/config/priority.ts.
const PRIORITY_ORDER: IssuePriority[] = [
  "urgent",
  "high",
  "medium",
  "low",
  "none",
];

/** Date presets mirroring web `DateSubContent.applyPreset`
 *  (issues-header.tsx:781-787): field-prefixed range ending today. */
const DATE_PRESETS: { days: 1 | 3 | 7; labelKey: string }[] = [
  { days: 1, labelKey: "filter.dateToday" },
  { days: 3, labelKey: "filter.dateLast3Days" },
  { days: 7, labelKey: "filter.dateLast7Days" },
];

type Scope = IssueFilterScope;
type FilterDim =
  | "assignee"
  | "creator"
  | "project"
  | "label"
  | `property:${string}`;

/** Web's chips use `M/D` for date chip values (filter-chips-bar.tsx). */
function shortDate(dateOnly: string): string {
  const [, m, d] = dateOnly.split("-");
  return `${Number(m)}/${Number(d)}`;
}

/**
 * The card-property switches this screen offers, in web's
 * `CARD_PROPERTY_OPTIONS` order (`view-store.ts:161-170`) filtered to the five
 * keys a mobile board card actually draws. Labels follow web's
 * `display.card_*` strings — see the locale file.
 *
 * Keep this list in sync with `components/issue/board-card.tsx`: a key here
 * with nothing to gate is a dead switch, and a field there that is missing
 * here is a setting the user cannot reach.
 */
const CARD_PROPERTY_TOGGLES: {
  key: keyof CardProperties;
  labelKey: string;
}[] = [
  { key: "priority", labelKey: "filter.display.cardPriority" },
  { key: "labels", labelKey: "filter.display.cardLabels" },
  { key: "assignee", labelKey: "filter.display.cardAssignee" },
  { key: "startDate", labelKey: "filter.display.cardStartDate" },
  { key: "dueDate", labelKey: "filter.display.cardDueDate" },
];

export default function IssuesFilterRoute() {
  const {
    scope,
    workspace: workspaceSlug,
    project: projectIdParam,
  } = useLocalSearchParams<{
    scope?: string;
    workspace?: string;
    /** The project surface's id. The facet counts need it to evaluate against
     *  the same project the list is showing; `project-issue-surface.tsx`'s
     *  openFilter sends it. */
    project?: string;
  }>();
  const resolvedScope: Scope = parseFilterScope(scope);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const tint = THEME[colorScheme].primary;

  // Subscribe the matching store (one unconditional hook — the scope param
  // is fixed for a route instance). All three state shapes extend
  // `IssueFilterSlice`, so `s.statusFilters` etc. stay narrow; `view` is the
  // per-store workbench mode, read here so property grouping can stay a
  // board-only option like web's (issues-header.tsx:1838).
  const s: IssueFilterSlice & { view: IssueViewMode } =
    issueFilterStoreForScope(resolvedScope)();

  const statusFilters = s.statusFilters;
  const priorityFilters = s.priorityFilters;
  const assigneeFilters = s.assigneeFilters;
  const includeNoAssignee = s.includeNoAssignee;
  const creatorFilters = s.creatorFilters;
  const projectFilters = s.projectFilters;
  const includeNoProject = s.includeNoProject;
  const labelFilters = s.labelFilters;
  const propertyFilters = s.propertyFilters;
  const dateFilter = s.dateFilter;
  const workingOnly = s.workingOnly;
  // The running-issue projection the facet badges narrow by. Read here (not in
  // the counts hook) because the sheet's counts hook is a plain function of its
  // args — the set has to arrive as an argument, exactly as it does on the
  // list surfaces. `undefined` while the snapshot loads; the count window
  // fails closed on it rather than falling back to unfiltered numbers.
  const runningIssueIds = useRunningIssueIds();
  const sortBy = s.sortBy;
  const sortDirection = s.sortDirection;
  const grouping = s.grouping;
  const showSubIssues = s.showSubIssues;
  const tableHierarchy = s.tableHierarchy;
  const cardProperties = s.cardProperties;
  const cardPropertyIds = s.cardPropertyIds;

  // The date section's field radio is UI-local until a preset/custom commits
  // (web DateSubContent keeps the same split).
  const [dateField, setDateField] = useState<
    IssueDateFilterValue["field"]
  >(dateFilter?.field ?? "created_at");

  const hasActive = hasActiveIssueFilters(s);

  // Action dispatcher — pick the matching store's imperative API.
  const act = () => issueFilterStoreForScope(resolvedScope).getState();

  // Custom-property definitions that can drive a filter — same
  // filterable-property set web uses (issues-header.tsx:1175-1181).
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  const statusOptions = useStatusOptions(wsId);
  // Four-state read (MYS-1892). The `= []` default this replaced folded
  // "loading" and "request failed" into "the workspace has none", which is
  // how the panel came to claim a workspace had no custom properties while
  // one request was timing out. The sections below render `catalog.state`
  // instead of branching on a length.
  const catalog = useActivePropertyCatalog(wsId);
  const properties = catalog.definitions;
  // The filterable set comes from core's `isFilterablePropertyType`, which is
  // the same predicate web's filter menu uses. Mobile used to keep its own
  // hardcoded list here (select / multi_select / checkbox / actor /
  // multi_actor), which silently dropped the four SCALAR types — text,
  // number, date and url were not filterable on the phone at all, while web
  // offered all eight. Reading the shared predicate is what keeps the two
  // from drifting again.
  const filterableProperties = properties.filter((p) =>
    isFilterablePropertyType(p.type),
  );
  // Disjunctive server facet counts — one "N issues" badge per filter option,
  // matching web (issues-header.tsx:1266 status / :1309 priority / :387
  // assignee / :1402 creator / :1429 project / :626 label). Undefined until a
  // response lands, and undefined forever on a project surface that was
  // opened without a project id: counting against the whole workspace would
  // badge options with numbers from other projects. See
  // `lib/issue-facet-counts.ts` for the mapping and the "exact or nothing"
  // rule this follows.
  const facetTab = (s as { scope?: string }).scope;
  const facetCounts = useFilterSheetFacetCounts({
    wsId,
    sheetScope: resolvedScope,
    tab: facetTab,
    // A badge is a promise about the list this sheet filters, so it carries the
    // working dimension the same way the list's group headers do (MYS-2017):
    // with 「智能体正在处理」 on, the rows are the running set and an unfiltered
    // badge contradicts them. `countWorkingOnly` clamps the project surface,
    // whose rows ignore the toggle (see its doc comment).
    window: withWorkingCountDimension(
      buildIssueWindow(s),
      countWorkingOnly(resolvedScope, workingOnly),
      runningIssueIds,
    ),
    includeSubIssues: showSubIssues,
    projectId: projectIdParam,
    // One property facet per filterable definition. The server resolves each
    // id against the workspace catalog and rejects an unknown or archived one,
    // so only definitions the catalog actually returned are asked for — and
    // only the three types it can facet (select / multi_select / checkbox,
    // issue_table_facets.go:236-247). Actor properties filter by reference and
    // have no facet; the picker shows them without a count rather than a
    // request that would 400 the whole batch.
    propertyIds: filterableProperties
      .filter((p) => propertyFacetable(p.type))
      .map((p) => p.id),
  });
  // A dimension's `key → count`, or undefined when there is nothing exact to
  // show. The count for "unassigned" / "no project" arrives under the
  // server's `__none__` key.
  const countFor = (
    facet: Parameters<typeof facetValuesFor>[1],
    key: string,
  ): number | undefined => facetValuesFor(facetCounts, facet)?.get(key);

  // A settled catalog holding no definition THIS section can filter by is the
  // section's own empty — "no filterable properties" stays true and still
  // belongs to this section, so it must not fall through to a blank body.
  const filterSectionState =
    catalog.state === "ready" && filterableProperties.length === 0
      ? "empty"
      : catalog.state;

  // Custom-property sort / grouping options, appended to the static ones the
  // same way web's Display popover does (issues-header.tsx:1957-1961 for
  // sort, :1849-1852 for grouping). Grouping by a property is a board
  // affordance: mobile's list renders status/assignee sections only, so the
  // option is offered only while the board is the active mode — and the list
  // falls back to status if the mode is switched afterwards.
  const sortOptions: { value: IssueSortField; label: string }[] = [
    ...ISSUE_SORT_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) })),
    ...properties
      .filter(isSortableProperty)
      .map((p) => ({ value: propertyViewKey(p.id), label: p.name })),
  ];
  const groupingOptions: { value: IssueGrouping; label: string }[] = [
    ...ISSUE_GROUPING_OPTIONS.map((o) => ({
      value: o.value,
      label: t(o.labelKey),
    })),
    ...(s.view === "board"
      ? properties
          .filter(isGroupableProperty)
          .map((p) => ({ value: propertyViewKey(p.id), label: p.name }))
      : []),
  ];

  const openDim = (dim: FilterDim) => {
    if (!workspaceSlug) return;
    router.push({
      pathname: "/[workspace]/issues-filter-picker",
      // `project` rides along so the sub-picker's counts resolve against the
      // same project this panel just counted; dropping it here would leave the
      // option rows badge-less while the dimension row above them had a
      // number.
      params: {
        workspace: workspaceSlug,
        scope: resolvedScope,
        dim,
        ...(projectIdParam ? { project: projectIdParam } : {}),
      },
    });
  };

  const openDateRange = () => {
    if (!workspaceSlug) return;
    router.push({
      pathname: "/[workspace]/issues-filter-date",
      params: { workspace: workspaceSlug, scope: resolvedScope },
    });
  };

  const applyDatePreset = (days: 1 | 3 | 7) => {
    act().setDateFilter({
      field: dateField,
      from: addDaysDateOnly(1 - days),
      to: todayDateOnly(),
    });
  };

  return (
    <View className="flex-1">
      <View className="flex-row items-center justify-between px-4 pt-4 pb-3">
        <Text className="text-title-sm font-semibold text-foreground">{t("filter.title")}</Text>
        {hasActive ? (
          <Pressable
            onPress={() => act().clearFilters()}
            hitSlop={8}
            className="px-2 py-1 active:opacity-60"
          >
            <Text className="text-body text-primary font-medium">{t("filter.reset")}</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* ——— Agents working ———
            Web's quick filter is a header chip
            (`workspace-agent-working-chip.tsx`); mobile's toolbar has no
            room for a second chip beside the scope pills, the five-button
            mode switch and the filter trigger, so the sheet carries it as
            the first row. It is a display predicate like any other — it
            lights the trigger dot (`hasActiveIssueFilters`) and is cleared
            by Reset. */}
        <SectionLabel>{t("filter.quick")}</SectionLabel>
        <BoolRow
          label={t("filter.workingOnly")}
          checked={workingOnly}
          onToggle={() => act().toggleWorkingOnly()}
          t={t}
        />

        {/* ——— Status ——— */}
        <SectionLabel>{t("filter.status")}</SectionLabel>
        {statusOptions.groups.map((group) => (
          <View key={group.category}>
            {statusOptions.hasCustom && group.options.length > 1 ? (
              <View className="px-4 pt-1.5 pb-1">
                <Text className="text-micro font-medium uppercase tracking-wider text-muted-foreground/70">
                  {t(`enum.status.${group.category}`)}
                </Text>
              </View>
            ) : null}
            {group.options.map((option) => {
              const checked = statusFilters.includes(option.key);
              const count = countFor({ kind: "status" }, option.key);
              return (
                <Pressable
                  key={option.key}
                  onPress={() => act().toggleStatusFilter(option.key)}
                  className={cn(
                    "flex-row items-center gap-3 px-4 py-2.5 active:bg-secondary",
                    checked && "bg-secondary/60",
                  )}
                >
                  <StatusIcon
                    status={option.key}
                    category={option.category}
                    color={option.color ?? undefined}
                    size={16}
                  />
                  <Text className="flex-1 text-body text-foreground">
                    {option.label}
                  </Text>
                  <OptionCount count={count} t={t} />
                  <CheckMark checked={checked} />
                </Pressable>
              );
            })}
          </View>
        ))}

        {/* ——— Priority ——— */}
        <SectionLabel>{t("filter.priority")}</SectionLabel>
        {PRIORITY_ORDER.map((priority) => {
          const checked = priorityFilters.includes(priority);
          const count = countFor({ kind: "priority" }, priority);
          return (
            <Pressable
              key={priority}
              onPress={() => act().togglePriorityFilter(priority)}
              className={cn(
                "flex-row items-center gap-3 px-4 py-2.5 active:bg-secondary",
                checked && "bg-secondary/60",
              )}
            >
              <PriorityIcon priority={priority} />
              <Text className="flex-1 text-body text-foreground">
                {t(`enum.priority.${priority}`)}
              </Text>
              <OptionCount count={count} t={t} />
              <CheckMark checked={checked} />
            </Pressable>
          );
        })}

        {/* ——— Assignee ——— */}
        <SectionLabel>{t("filter.assignee")}</SectionLabel>
        <FilterDimensionRow
          label={t("filter.assignee")}
          summary={actorSummary(assigneeFilters)}
          count={assigneeFilters.length}
          tint={tint}
          onPress={() => openDim("assignee")}
          t={t}
        />
        <BoolRow
          label={t("filter.noAssignee")}
          count={countFor({ kind: "assignee" }, NO_VALUE_KEY)}
          checked={includeNoAssignee}
          onToggle={() => act().toggleNoAssignee()}
          t={t}
        />

        {/* ——— Creator ——— */}
        <SectionLabel>{t("filter.creator")}</SectionLabel>
        <FilterDimensionRow
          label={t("filter.creator")}
          summary={actorSummary(creatorFilters)}
          count={creatorFilters.length}
          tint={tint}
          onPress={() => openDim("creator")}
          t={t}
        />

        {/* ——— Project ——— */}
        <SectionLabel>{t("filter.project")}</SectionLabel>
        <FilterDimensionRow
          label={t("filter.project")}
          summary={
            projectFilters.length > 0
              ? `${projectFilters.length}`
              : includeNoProject
                ? t("filter.noProject")
                : ""
          }
          count={projectFilters.length}
          tint={tint}
          onPress={() => openDim("project")}
          t={t}
        />
        <BoolRow
          label={t("filter.noProject")}
          count={countFor({ kind: "project" }, NO_VALUE_KEY)}
          checked={includeNoProject}
          onToggle={() => act().toggleNoProject()}
          t={t}
        />

        {/* ——— Label ——— */}
        <SectionLabel>{t("filter.label")}</SectionLabel>
        <FilterDimensionRow
          label={t("filter.label")}
          summary={
            labelFilters.length > 0 ? `${labelFilters.length}` : ""
          }
          count={labelFilters.length}
          tint={tint}
          onPress={() => openDim("label")}
          t={t}
        />

        {/* ——— Custom properties ———
            Three states, not one (MYS-1892): a catalog that has not arrived
            renders a spinner, a failed one names the failure and offers a
            retry, and only a settled catalog with no filterable definitions
            claims there is nothing to filter by. */}
        <SectionLabel>{t("filter.property")}</SectionLabel>
        {filterSectionState === "ready" ? (
          filterableProperties.map((property) => {
            const selected = propertyFilters[property.id] ?? [];
            return (
              <FilterDimensionRow
                key={property.id}
                label={property.name}
                summary={selected.length > 0 ? `${selected.length}` : ""}
                count={selected.length}
                tint={tint}
                onPress={() => openDim(`property:${property.id}`)}
                t={t}
              />
            );
          })
        ) : (
          <PropertyCatalogStatus
            state={filterSectionState}
            onRetry={catalog.retry}
            emptyMessage={t("filter.propertyEmpty")}
          />
        )}

        {/* ——— Date ——— */}
        <SectionLabel>{t("filter.date")}</SectionLabel>
        {(["created_at", "updated_at"] as const).map((option) => {
          const selected = dateField === option;
          return (
            <Pressable
              key={option}
              onPress={() => {
                setDateField(option);
                // Web keeps a committed window and just swaps its field.
                if (dateFilter) act().setDateFilter({ ...dateFilter, field: option });
              }}
              className={cn(
                "flex-row items-center gap-3 px-4 py-2.5 active:bg-secondary",
                selected && "bg-secondary/60",
              )}
            >
              <Ionicons
                name={selected ? "radio-button-on" : "radio-button-off"}
                size={18}
                color={selected ? tint : THEME[colorScheme].mutedForeground}
              />
              <Text className="flex-1 text-body text-foreground">
                {t(option === "created_at" ? "filter.dateCreated" : "filter.dateUpdated")}
              </Text>
            </Pressable>
          );
        })}
        {DATE_PRESETS.map((preset) => (
          <Pressable
            key={preset.days}
            onPress={() => applyDatePreset(preset.days)}
            className={cn(
              "flex-row items-center gap-3 px-4 py-2.5 active:bg-secondary",
              dateFilter &&
                dateFilter.field === dateField &&
                dateFilter.to === todayDateOnly() &&
                dateFilter.from === addDaysDateOnly(1 - preset.days) &&
                "bg-secondary/60",
            )}
          >
            <Ionicons
              name="calendar-outline"
              size={18}
              color={THEME[colorScheme].mutedForeground}
            />
            <Text className="flex-1 text-body text-foreground">
              {t(preset.labelKey)}
            </Text>
            {dateFilter &&
            dateFilter.field === dateField &&
            dateFilter.to === todayDateOnly() &&
            dateFilter.from === addDaysDateOnly(1 - preset.days) ? (
              <CheckMark checked />
            ) : null}
          </Pressable>
        ))}
        <Pressable
          onPress={openDateRange}
          className="flex-row items-center gap-3 px-4 py-2.5 active:bg-secondary"
        >
          <Ionicons
            name="calendar-outline"
            size={18}
            color={THEME[colorScheme].mutedForeground}
          />
          <Text className="flex-1 text-body text-foreground">
            {t("filter.dateCustomRange")}
          </Text>
          {dateFilter ? (
            <Text className="text-body text-muted-foreground">
              {shortDate(dateFilter.from)}
              {dateFilter.from === dateFilter.to
                ? ""
                : ` - ${shortDate(dateFilter.to)}`}
            </Text>
          ) : (
            <Text className="text-caption text-muted-foreground/70">
              {t("filter.choose")}
            </Text>
          )}
          <Ionicons
            name="chevron-forward"
            size={16}
            color={THEME[colorScheme].mutedForeground}
          />
        </Pressable>
        {dateFilter ? (
          <Pressable
            onPress={() => act().setDateFilter(null)}
            className="flex-row items-center gap-3 px-4 py-2.5 active:bg-secondary"
          >
            <Ionicons
              name="close-circle-outline"
              size={18}
              color={THEME[colorScheme].mutedForeground}
            />
            <Text className="flex-1 text-body text-destructive">
              {t("filter.dateClear")}
            </Text>
          </Pressable>
        ) : null}

        {/* ——— Sort ——— */}
        <SectionLabel>{t("filter.sort.title")}</SectionLabel>
        {sortOptions.map((opt) => {
          const selected = sortBy === opt.value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => act().setSortBy(opt.value)}
              className={cn(
                "flex-row items-center gap-3 px-4 py-2.5 active:bg-secondary",
                selected && "bg-secondary/60",
              )}
            >
              <Ionicons
                name={selected ? "radio-button-on" : "radio-button-off"}
                size={18}
                color={selected ? tint : THEME[colorScheme].mutedForeground}
              />
              <Text numberOfLines={1} className="flex-1 text-body text-foreground">
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
        <View className="flex-row items-center gap-3 px-4 py-2">
          <Ionicons
            name="swap-vertical"
            size={18}
            color={THEME[colorScheme].mutedForeground}
          />
          <Pressable
            onPress={() => act().setSortDirection("asc")}
            className="flex-1"
          >
            <Text
              className={cn(
                "text-body",
                sortDirection === "asc"
                  ? "text-foreground font-medium"
                  : "text-muted-foreground",
              )}
            >
              {t("filter.sort.asc")}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => act().setSortDirection("desc")}
            className="flex-1"
          >
            <Text
              className={cn(
                "text-body",
                sortDirection === "desc"
                  ? "text-foreground font-medium"
                  : "text-muted-foreground",
              )}
            >
              {t("filter.sort.desc")}
            </Text>
          </Pressable>
        </View>

        {/* ——— Grouping ——— */}
        <SectionLabel>{t("filter.group.title")}</SectionLabel>
        {groupingOptions.map((opt) => {
          const selected = grouping === opt.value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => act().setGrouping(opt.value)}
              className={cn(
                "flex-row items-center gap-3 px-4 py-2.5 active:bg-secondary",
                selected && "bg-secondary/60",
              )}
            >
              <Ionicons
                name={selected ? "radio-button-on" : "radio-button-off"}
                size={18}
                color={selected ? tint : THEME[colorScheme].mutedForeground}
              />
              <Text numberOfLines={1} className="flex-1 text-body text-foreground">
                {opt.label}
              </Text>
            </Pressable>
          );
        })}

        {/* ——— Display ——— */}
        <SectionLabel>{t("filter.display.title")}</SectionLabel>
        <BoolRow
          label={t("filter.display.showSubIssues")}
          checked={showSubIssues}
          onToggle={() => act().toggleShowSubIssues()}
          t={t}
        />
        {/* Table hierarchy — web `table.hierarchy` +
            `table.hierarchy_description` (issues-header.tsx:1910-1923),
            which web renders INSIDE the table's own header. Mobile keeps it
            here in the shared Display section instead: the filter sheet is
            where every other display preference already lives, and the table
            header is a cramped strip on a phone. The switch is offered
            whenever the table is the active mode, matching web's own
            `viewMode === "table" &&` gate — flipping it from another view
            would change nothing visible until the user switched. */}
        {s.view === "table" ? (
          <BoolRow
            label={t("filter.display.tableHierarchy")}
            description={t("filter.display.tableHierarchyDesc")}
            checked={tableHierarchy}
            onToggle={() => act().toggleTableHierarchy()}
            t={t}
          />
        ) : null}
        {/* Card fields — web's `display.card_properties_section`
            (issues-header.tsx:1996-2010) over `CARD_PROPERTY_OPTIONS`
            (packages/core/issues/stores/view-store.ts:161-170).

            Only the FIVE keys mobile's board card has content for are offered
            here: priority, labels, assignee, startDate, dueDate
            (components/issue/board-card.tsx). The remaining three —
            description, project, childProgress — are carried in state and
            round-tripped through the view codec (so a web-saved view stays
            lossless) but gate nothing, because a mobile card draws no
            description, no project and no sub-issue progress. Offering
            switches for them would be switches that visibly do nothing. */}
        <SectionLabel>{t("filter.display.cardFieldsTitle")}</SectionLabel>
        {CARD_PROPERTY_TOGGLES.map(({ key, labelKey }) => (
          <BoolRow
            key={key}
            label={t(labelKey)}
            checked={cardProperties[key]}
            onToggle={() => act().toggleCardProperty(key)}
            t={t}
          />
        ))}

        {/* Custom card properties — web renders these as a second chip row
            immediately after the eight built-in chips, inside the same
            `card_properties_section` block (issues-header.tsx:2013-2027).
            Mobile keeps them under their own heading instead: the built-in
            switches are already a full section here, and an unlabelled
            continuation would read as more built-ins rather than as the
            workspace's own definitions.

            The list is the ACTIVE catalog — the same `properties` the filter
            and sort sections above use — because that is what web's Display
            popover maps (`workspaceProperties`, issues-header.tsx:1593, whose
            `propertyListOptions` call omits includeArchived). An archived
            definition is therefore not offered here, and its stale id stays in
            `cardPropertyIds` untouched (see `sanitizeCardPropertyIds`), so
            un-archiving it brings the chip straight back.

            The reported site (MYS-1892): 「该工作区还没有自定义属性」 used to be
            the `properties.length === 0` branch, so a catalog still loading
            or one whose request had timed out rendered the same sentence as a
            genuinely empty workspace. It now paints per state, and a failed
            read offers the retry that was missing. */}
        <SectionLabel>{t("filter.display.customPropertiesTitle")}</SectionLabel>
        {catalog.state === "ready" ? (
          properties.map((property) => (
            <BoolRow
              key={property.id}
              label={property.name}
              checked={cardPropertyIds.includes(property.id)}
              onToggle={() => act().toggleCardPropertyId(property.id)}
              t={t}
            />
          ))
        ) : (
          <PropertyCatalogStatus
            state={catalog.state}
            onRetry={catalog.retry}
            emptyMessage={t("filter.display.customPropertiesEmpty")}
          />
        )}
      </ScrollView>
    </View>
  );
}

function actorSummary(filters: { type: string; id: string }[]): string {
  return filters.length > 0 ? `${filters.length}` : "";
}

/** Row that opens the multi-select dimension sub-sheet. */
/**
 * The "N issues" badge web puts on the right of a filter option
 * (`packages/views/issues/components/issues-header.tsx:1272`, `$.filters.issue_count`).
 *
 * Renders NOTHING for `undefined` — which is the whole point of the
 * "exact or nothing" rule: an unresolved or failed facet means the number is
 * unknown, and printing "0 issues" there would state something the server
 * never said. A genuine 0 also renders nothing, matching web's `count > 0`
 * gate (a zero-count option is dead weight in a picker).
 */
function OptionCount({
  count,
  t,
}: {
  count: number | undefined;
  t: (id: string, params?: Record<string, string | number>) => string;
}) {
  if (count === undefined || count <= 0) return null;
  return (
    <Text className="text-caption text-muted-foreground">
      {t(count === 1 ? "filter.issueCount_one" : "filter.issueCount_other", {
        count,
      })}
    </Text>
  );
}

function FilterDimensionRow({
  label,
  summary,
  count,
  tint,
  onPress,
  t,
}: {
  label: string;
  summary: string;
  count: number;
  tint: string;
  onPress: () => void;
  t: (id: string, params?: Record<string, string | number>) => string;
}) {
  const { colorScheme } = useColorScheme();
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-3 px-4 py-3 active:bg-secondary"
    >
      <Ionicons
        name={count > 0 ? "funnel" : "funnel-outline"}
        size={18}
        color={count > 0 ? tint : THEME[colorScheme].mutedForeground}
      />
      <Text className="flex-1 text-body text-foreground">{label}</Text>
      {summary ? (
        <Text className="text-body text-muted-foreground">{summary}</Text>
      ) : null}
      <Text className="text-caption text-muted-foreground/70">{t("filter.choose")}</Text>
      <Ionicons
        name="chevron-forward"
        size={16}
        color={THEME[colorScheme].mutedForeground}
      />
    </Pressable>
  );
}

/** On/off row (includeNoAssignee / includeNoProject / showSubIssues /
 *  tableHierarchy). `description` renders web's two-line form — the label plus
 *  a smaller explanatory line under it — for switches whose effect is not
 *  obvious from the label alone. */
function BoolRow({
  label,
  description,
  count,
  checked,
  onToggle,
  t,
}: {
  label: string;
  description?: string;
  /** Exact server count for this toggle's own dimension, when there is one.
   *  Web badges the `No assignee` / `No project` rows the same way it badges
   *  the options above them (issues-header.tsx:377). */
  count?: number;
  checked: boolean;
  onToggle: () => void;
  t: (id: string, params?: Record<string, string | number>) => string;
}) {
  const { colorScheme } = useColorScheme();
  const tint = THEME[colorScheme].primary;
  return (
    <Pressable
      onPress={onToggle}
      className="flex-row items-center gap-3 px-4 py-2.5 active:bg-secondary"
    >
      <View className="w-[18px]" />
      <View className="flex-1 min-w-0">
        <Text className="text-body text-foreground">{label}</Text>
        {description ? (
          <Text className="mt-0.5 text-caption text-muted-foreground">
            {description}
          </Text>
        ) : null}
      </View>
      <OptionCount count={count} t={t} />
      <Ionicons
        name={checked ? "checkbox" : "square-outline"}
        size={20}
        color={checked ? tint : THEME[colorScheme].mutedForeground}
      />
    </Pressable>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <View className="px-4 pt-3 pb-1.5">
      <Text className="text-caption uppercase tracking-wider text-muted-foreground font-medium">
        {children}
      </Text>
    </View>
  );
}

function CheckMark({ checked }: { checked: boolean }) {
  if (!checked) return null;
  return <Text className="text-body text-primary font-semibold">✓</Text>;
}