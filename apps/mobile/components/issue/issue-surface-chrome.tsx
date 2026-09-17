/**
 * Shared chrome for the three issue-workbench surfaces — the workspace-wide
 * Issues page, My Issues, and the project-detail issue surface (iteration-68).
 *
 * These were previously duplicated in each page (my-issues.tsx and
 * more/issues.tsx carried identical copies); with a third caller arriving
 * they move here. Behavior is unchanged — each component is the same code
 * the two pages shipped, exported once:
 *
 *   - `IssueSelectionRow`  — IssueRow wired to the batch-selection store
 *   - `IssueSurfaceScopeToolbar` — scope pills + view toggle + filter trigger
 *   - `FilterTriggerButton` — outline filter icon with active dot
 *   - `ActiveFilterChips` — one chip per selected filter value
 *   - `IssueSectionHeader` — SectionList header for status / assignee lanes
 *   - `SurfaceEmptyState`  — centered muted message
 */
import { useCallback, useMemo } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Issue, IssuePriority, IssueStatus } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { StatusIcon } from "@/components/ui/status-icon";
import { IssueRow } from "@/components/issue/issue-row";
import { ViewModeToggle } from "@/components/issue/view-mode-toggle";
import { useIssueBatchSelectionStore } from "@/data/stores/issue-batch-selection-store";
import { projectListOptions } from "@/data/queries/projects";
import { labelListOptions } from "@/data/queries/labels";
import { propertyActiveOptions } from "@/data/queries/properties";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useActorLookup } from "@/data/use-actor-name";
import { useStatusLabel } from "@/lib/status-options";
import {
  type IssueFilterState,
} from "@/lib/filter-issues";
import {
  baselineFromViewQuery,
  clearDimensionToBaseline,
  issueFilterDelta,
  type IssueViewBaseline,
} from "@/data/stores/issue-view-codec";
import type {
  FilterDimension,
  IssueFilterSlice,
  IssueViewMode,
} from "@/data/stores/issue-filter-slice";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n/react";
import { translate } from "@/lib/i18n";

/** One SectionList section — shared by all three surfaces (status grouping
 *  sets `status`; assignee grouping sets the actor lane identity). */
export type IssueSection = {
  key: string;
  data: Issue[];
  status?: IssueStatus;
  assigneeType?: "member" | "agent" | "squad";
  assigneeId?: string;
  unassigned?: boolean;
};

/**
 * Row cell wired to the batch-selection store: in selection mode the row
 * toggles membership on tap instead of navigating, and long-press enters
 * selection mode pre-selecting this row. Non-selecting callers don't opt
 * in and keep native tap-to-navigate.
 */
export function IssueSelectionRow({
  issue,
  onOpen,
}: {
  issue: Issue;
  onOpen: () => void;
}) {
  const selectionMode = useIssueBatchSelectionStore((s) => s.selectionMode);
  const selected = useIssueBatchSelectionStore((s) =>
    s.selectedIds.has(issue.id),
  );
  const toggle = useIssueBatchSelectionStore((s) => s.toggle);
  const enterSelection = useIssueBatchSelectionStore((s) => s.enterSelection);
  return (
    <IssueRow
      issue={issue}
      selectionMode={selectionMode}
      selected={selected}
      onPress={() => {
        if (selectionMode) toggle(issue.id);
        else onOpen();
      }}
      onLongPress={() => enterSelection(issue.id)}
    />
  );
}

/**
 * Outline icon button matching the pill height so the toolbar row reads as
 * one visual group. Mirrors web's IssuesHeader / MyIssuesHeader filter
 * trigger, which is also `variant="outline"` + icon-sized.
 */
export function FilterTriggerButton({
  onPress,
  hasActiveFilters,
}: {
  onPress: () => void;
  hasActiveFilters: boolean;
}) {
  const { colorScheme } = useColorScheme();
  const { t } = useTranslation();
  return (
    <View style={{ position: "relative" }} className="ml-2">
      <Button
        variant="outline"
        size="sm"
        onPress={onPress}
        accessibilityLabel={t("a11y.filter")}
        className="w-9 px-0"
      >
        <Ionicons
          name="options-outline"
          size={16}
          color={THEME[colorScheme].mutedForeground}
        />
      </Button>
      {hasActiveFilters ? (
        <View
          pointerEvents="none"
          className="absolute top-1 right-1 size-1.5 rounded-full bg-brand"
        />
      ) : null}
    </View>
  );
}

/**
 * Toolbar row mirroring web's IssuesHeader: left-aligned scope pill group +
 * right-side mode switch and Filter icon (red dot when filters are active).
 * Generic over the scope value type so each surface passes its own `SCOPES`
 * config.
 *
 * The pill group scrolls horizontally instead of shrinking: scope pills are
 * fixed-width, so a narrow phone with three scopes and the five-button mode
 * switch (list / board / table / gantt / swimlane) leaves the row wider than
 * the screen. Shrinking the group only clipped the pills under the mode
 * switch — the buttons overflow their shrunken box. Scrolling keeps every
 * scope reachable and the mode switch fixed.
 */
export function IssueSurfaceScopeToolbar<S extends string>({
  scopes,
  scope,
  onChange,
  onOpenFilter,
  hasActiveFilters,
  view,
  onViewChange,
  t,
}: {
  scopes: { value: S; labelKey: string }[];
  scope: S;
  onChange: (value: S) => void;
  onOpenFilter: () => void;
  hasActiveFilters: boolean;
  view: IssueViewMode;
  onViewChange: (view: IssueViewMode) => void;
  t: (id: string, params?: Record<string, string | number>) => string;
}) {
  return (
    <View className="flex-row items-center justify-between px-4 pt-2 pb-2">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="flex-1 min-w-0"
        contentContainerStyle={{ gap: 4, alignItems: "center" }}
      >
        {scopes.map((s) => {
          const active = scope === s.value;
          return (
            <Button
              key={s.value}
              variant="outline"
              size="sm"
              onPress={() => onChange(s.value)}
              className={active ? "bg-accent" : ""}
              accessibilityState={{ selected: active }}
            >
              <Text
                numberOfLines={1}
                className={active ? "text-accent-foreground" : "text-muted-foreground"}
              >
                {t(s.labelKey)}
              </Text>
            </Button>
          );
        })}
      </ScrollView>
      <View className="flex-row items-center gap-1.5 ml-2 shrink-0">
        <ViewModeToggle view={view} onChange={onViewChange} />
        <FilterTriggerButton
          onPress={onOpenFilter}
          hasActiveFilters={hasActiveFilters}
        />
      </View>
    </View>
  );
}

/**
 * Chips bar — one chip per value the USER added on top of the open saved
 * view (web filter-chips-bar.tsx baseline semantics). Values the view itself
 * fixes never appear: the view name carries them, and removing a chip
 * returns its dimension to the view's values rather than emptying it. With
 * no view open every value is the user's own and removal is a plain clear.
 *
 * Project/label chips resolve names from the workspace catalogs; actor chips
 * reuse `useActorLookup`. The date window is a user layer no view carries,
 * so its chip always clears outright.
 */
export function ActiveFilterChips({
  filterState,
  baseline,
  onResetDimension,
  onClearStatus,
  onClearPriority,
  onClearAssignee,
  onClearCreator,
  onClearProject,
  onClearLabel,
  onClearNoAssignee,
  onClearNoProject,
  onClearProperty,
  onClearDate,
}: {
  filterState: IssueFilterState;
  /** The open saved view's own conditions; null when no view is open. */
  baseline: IssueViewBaseline | null;
  /** Return one dimension to the open view's values. */
  onResetDimension: (dimension: FilterDimension) => void;
  onClearStatus: (s: IssueStatus) => void;
  onClearPriority: (p: IssuePriority) => void;
  onClearAssignee: (v: { type: "member" | "agent" | "squad"; id: string }) => void;
  onClearCreator: (v: { type: "member" | "agent" | "squad"; id: string }) => void;
  onClearProject: (id: string) => void;
  onClearLabel: (id: string) => void;
  onClearNoAssignee: () => void;
  onClearNoProject: () => void;
  onClearProperty: (id: string) => void;
  onClearDate: () => void;
}) {
  const { getName } = useActorLookup();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const statusLabel = useStatusLabel(wsId);
  const { data: projects = [] } = useQuery(projectListOptions(wsId));
  const { data: labels = [] } = useQuery(labelListOptions(wsId));
  const { data: properties = [] } = useQuery(propertyActiveOptions(wsId));
  const projectName = (id: string) =>
    projects.find((p) => p.id === id)?.title ?? id.slice(0, 8);
  const labelName = (id: string) =>
    labels.find((l) => l.id === id)?.name ?? id.slice(0, 8);
  // Property chips mirror web filter-chips-bar.tsx: one chip per DEFINITION
  // carrying the definition name and its selected options (checkbox renders
  // the true/false pseudo-option labels). Clear removes that definition only.
  const propertyChip = (propertyId: string, selected: string[]) => {
    const definition = properties.find((p) => p.id === propertyId);
    if (!definition) return null;
    const optionName = (optionId: string) => {
      if (definition.type === "checkbox") {
        return optionId === "true"
          ? translate("filter.propertyTrue")
          : translate("filter.propertyFalse");
      }
      return (
        definition.config.options?.find((o) => o.id === optionId)?.name ??
        optionId
      );
    };
    return `${definition.name}: ${selected.map(optionName).join(", ")}`;
  };
  const dateShort = (dateOnly: string) => {
    const [, m, d] = dateOnly.split("-");
    return `${Number(m)}/${Number(d)}`;
  };

  const delta = issueFilterDelta(filterState, baseline);
  /** Inside a view a chip's removal falls back to the view's values; outside
   *  one it is the per-value toggle the chip's label promises. */
  const remove = (dimension: FilterDimension, clearValue: () => void) =>
    baseline ? () => onResetDimension(dimension) : clearValue;

  const chips: { key: string; label: string; onClear: () => void }[] = [];
  for (const s of delta.statuses) {
    chips.push({
      key: `s-${s}`,
      label: statusLabel(s),
      onClear: remove("status", () => onClearStatus(s)),
    });
  }
  for (const p of delta.priorities) {
    chips.push({
      key: `p-${p}`,
      label: translate(`enum.priority.${p}`),
      onClear: remove("priority", () => onClearPriority(p)),
    });
  }
  for (const a of delta.assignees) {
    chips.push({
      key: `a-${a.type}:${a.id}`,
      label: getName(a.type, a.id),
      onClear: remove("assignee", () => onClearAssignee(a)),
    });
  }
  if (delta.includeNoAssignee) {
    chips.push({
      key: "no-assignee",
      label: translate("filter.noAssignee"),
      onClear: remove("assignee", onClearNoAssignee),
    });
  }
  for (const c of delta.creators) {
    chips.push({
      key: `c-${c.type}:${c.id}`,
      label: getName(c.type, c.id),
      onClear: remove("creator", () => onClearCreator(c)),
    });
  }
  for (const id of delta.projects) {
    chips.push({
      key: `pr-${id}`,
      label: projectName(id),
      onClear: remove("project", () => onClearProject(id)),
    });
  }
  if (delta.includeNoProject) {
    chips.push({
      key: "no-project",
      label: translate("filter.noProject"),
      onClear: remove("project", onClearNoProject),
    });
  }
  for (const id of delta.labels) {
    chips.push({
      key: `l-${id}`,
      label: labelName(id),
      onClear: remove("label", () => onClearLabel(id)),
    });
  }
  for (const [propertyId, selected] of Object.entries(delta.property)) {
    const label = propertyChip(propertyId, selected);
    if (!label) continue;
    chips.push({
      key: `prop-${propertyId}`,
      label,
      onClear: remove(`property:${propertyId}`, () =>
        onClearProperty(propertyId),
      ),
    });
  }
  const { dateFilter } = filterState;
  if (dateFilter) {
    chips.push({
      key: "date",
      label: `${translate(
        dateFilter.field === "created_at"
          ? "filter.dateCreated"
          : "filter.dateUpdated",
      )}: ${
        dateFilter.from === dateFilter.to
          ? dateShort(dateFilter.from)
          : `${dateShort(dateFilter.from)} - ${dateShort(dateFilter.to)}`
      }`,
      onClear: onClearDate,
    });
  }

  // A view whose conditions are all still intact contributes no chips — the
  // bar must collapse rather than leave an empty row behind.
  if (chips.length === 0) return null;

  return (
    <View className="flex-row flex-wrap gap-1.5 px-4 pb-2">
      {chips.map((chip) => (
        <Chip key={chip.key} label={chip.label} onClear={chip.onClear} />
      ))}
    </View>
  );
}

/**
 * Chips wiring shared by the three issue surfaces: the open view's baseline
 * (null when no view is open) plus the one-dimension reset that falls back
 * to it. All three surfaces own a zustand store of the same filter-slice
 * shape, so the store is passed in and the reset lives here once.
 *
 * `viewQuery` is the ACTIVE saved view's query blob — an opaque server
 * round-trip of the nine filter dims.
 */
export function useFilterChipBaseline(
  viewQuery: Record<string, unknown> | null,
  store: { getState: () => IssueFilterSlice },
): {
  baseline: IssueViewBaseline | null;
  resetDimension: (dimension: FilterDimension) => void;
} {
  const baseline = useMemo(
    () => (viewQuery ? baselineFromViewQuery(viewQuery) : null),
    [viewQuery],
  );
  const resetDimension = useCallback(
    (dimension: FilterDimension) => {
      if (!baseline) return;
      const state = store.getState();
      state.resetFiltersTo(
        clearDimensionToBaseline(state, dimension, baseline),
      );
    },
    [baseline, store],
  );
  return { baseline, resetDimension };
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  const { colorScheme } = useColorScheme();
  return (
    <Pressable
      onPress={onClear}
      className="flex-row items-center gap-1 pl-2.5 pr-2 py-1 rounded-full border border-border bg-secondary/40 active:bg-secondary"
    >
      <Text className="text-xs text-foreground">{label}</Text>
      <Ionicons
        name="close"
        size={12}
        color={THEME[colorScheme].mutedForeground}
      />
    </Pressable>
  );
}

/**
 * Section header for both grouping modes. Assignee lanes render the actor
 * avatar + name through the same actor lookup the filter picker uses; the
 * unassigned lane renders "Unassigned" (web filter includeNoAssignee label).
 */
export function IssueSectionHeader({ section }: { section: IssueSection }) {
  const { getName } = useActorLookup();
  const statusLabel = useStatusLabel();
  if (section.status) {
    return (
      <View className="flex-row items-center gap-2 px-4 py-2 bg-background">
        <StatusIcon status={section.status} size={14} />
        <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          {statusLabel(section.status)}
        </Text>
        <Text className="text-xs text-muted-foreground/60">
          {section.data.length}
        </Text>
      </View>
    );
  }
  return (
    <View className="flex-row items-center gap-2 px-4 py-2 bg-background">
      {section.unassigned ? (
        <>
          <View className="w-[18px]" />
          <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
            {translate("filter.noAssignee")}
          </Text>
        </>
      ) : (
        <>
          <ActorAvatar
            type={section.assigneeType}
            id={section.assigneeId}
            size={18}
          />
          <Text
            numberOfLines={1}
            className="flex-1 text-xs font-medium text-muted-foreground"
          >
            {getName(section.assigneeType, section.assigneeId)}
          </Text>
        </>
      )}
      <Text className="text-xs text-muted-foreground/60">
        {section.data.length}
      </Text>
    </View>
  );
}

export function SurfaceEmptyState({ message }: { message: string }) {
  return (
    <View className="flex-1 items-center justify-center px-6">
      <Text className="text-sm text-muted-foreground text-center">
        {message}
      </Text>
    </View>
  );
}