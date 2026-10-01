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
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { IssuePriority } from "@multica/core/types";
import { addDaysDateOnly, todayDateOnly } from "@multica/core/issues/date";
import { Text } from "@/components/ui/text";
import { StatusIcon } from "@/components/ui/status-icon";
import { PriorityIcon } from "@/components/ui/priority-icon";
import {
  issueFilterStoreForScope,
  parseFilterScope,
  type IssueFilterScope,
} from "@/data/stores/issue-filter-store-registry";
import { propertyActiveOptions } from "@/data/queries/properties";
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
  const { scope, workspace: workspaceSlug } = useLocalSearchParams<{
    scope?: string;
    workspace?: string;
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
  const { data: properties = [] } = useQuery(propertyActiveOptions(wsId));
  const filterableProperties = properties.filter(
    (p) => p.type === "select" || p.type === "multi_select" || p.type === "checkbox",
  );

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
      params: { workspace: workspaceSlug, scope: resolvedScope, dim },
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
        <Text className="text-base font-semibold text-foreground">{t("filter.title")}</Text>
        {hasActive ? (
          <Pressable
            onPress={() => act().clearFilters()}
            hitSlop={8}
            className="px-2 py-1 active:opacity-60"
          >
            <Text className="text-sm text-primary font-medium">{t("filter.reset")}</Text>
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
                <Text className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
                  {t(`enum.status.${group.category}`)}
                </Text>
              </View>
            ) : null}
            {group.options.map((option) => {
              const checked = statusFilters.includes(option.key);
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
                  <Text className="flex-1 text-sm text-foreground">
                    {option.label}
                  </Text>
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
              <Text className="flex-1 text-sm text-foreground">
                {t(`enum.priority.${priority}`)}
              </Text>
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

        {/* ——— Custom properties ——— */}
        <SectionLabel>{t("filter.property")}</SectionLabel>
        {filterableProperties.length === 0 ? (
          <View className="px-4 py-3">
            <Text className="text-sm text-muted-foreground">
              {t("filter.propertyEmpty")}
            </Text>
          </View>
        ) : (
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
              <Text className="flex-1 text-sm text-foreground">
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
            <Text className="flex-1 text-sm text-foreground">
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
          <Text className="flex-1 text-sm text-foreground">
            {t("filter.dateCustomRange")}
          </Text>
          {dateFilter ? (
            <Text className="text-sm text-muted-foreground">
              {shortDate(dateFilter.from)}
              {dateFilter.from === dateFilter.to
                ? ""
                : ` - ${shortDate(dateFilter.to)}`}
            </Text>
          ) : (
            <Text className="text-xs text-muted-foreground/70">
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
            <Text className="flex-1 text-sm text-destructive">
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
              <Text numberOfLines={1} className="flex-1 text-sm text-foreground">
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
                "text-sm",
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
                "text-sm",
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
              <Text numberOfLines={1} className="flex-1 text-sm text-foreground">
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
            un-archiving it brings the chip straight back. */}
        <SectionLabel>{t("filter.display.customPropertiesTitle")}</SectionLabel>
        {properties.length === 0 ? (
          <View className="px-4 py-2.5">
            <Text className="text-xs text-muted-foreground/70">
              {t("filter.display.customPropertiesEmpty")}
            </Text>
          </View>
        ) : (
          properties.map((property) => (
            <BoolRow
              key={property.id}
              label={property.name}
              checked={cardPropertyIds.includes(property.id)}
              onToggle={() => act().toggleCardPropertyId(property.id)}
              t={t}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function actorSummary(filters: { type: string; id: string }[]): string {
  return filters.length > 0 ? `${filters.length}` : "";
}

/** Row that opens the multi-select dimension sub-sheet. */
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
      <Text className="flex-1 text-sm text-foreground">{label}</Text>
      {summary ? (
        <Text className="text-sm text-muted-foreground">{summary}</Text>
      ) : null}
      <Text className="text-xs text-muted-foreground/70">{t("filter.choose")}</Text>
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
  checked,
  onToggle,
  t,
}: {
  label: string;
  description?: string;
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
        <Text className="text-sm text-foreground">{label}</Text>
        {description ? (
          <Text className="mt-0.5 text-xs text-muted-foreground">
            {description}
          </Text>
        ) : null}
      </View>
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
      <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
        {children}
      </Text>
    </View>
  );
}

function CheckMark({ checked }: { checked: boolean }) {
  if (!checked) return null;
  return <Text className="text-sm text-primary font-semibold">✓</Text>;
}