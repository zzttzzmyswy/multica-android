/**
 * Multi-select picker sheet for one ISSUE FILTER dimension. Opened from the
 * `issues-filter` panel rows:
 *
 *   - `?scope=my|all|project` → which view-store the selection persists into
 *   - `?dim=assignee`   → members/agents/squads filter (no-unassigned row;
 *                         the panel owns includeNoAssignee)
 *   - `?dim=creator`    → same actor list, for creator
 *   - `?dim=project`    → projects + "No project" row
 *   - `?dim=label`      → labels (no inline create)
 *   - `?dim=property:<definitionId>` → one custom-property definition's
 *                         options (select / multi_select / checkbox; the
 *                         checkbox exposes true/false rows)
 *
 * The body toggles the store directly and stays open across taps — filter
 * dimensions are positive-selection SETS (web view-store FilterSnapshot), so
 * the user toggle-accumulates then dismisses via grabber / header Done.
 *
 * Self-contained store access mirrors `issues-filter.tsx` (no callback
 * passing); the parent panel re-renders from the same store while this sheet
 * is presented on top.
 */
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useLayoutEffect } from "react";
import { Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import {
  FilterActorPickerBody,
  FilterLabelPickerBody,
  FilterProjectPickerBody,
  FilterPropertyPickerBody,
} from "@/components/issue/pickers/filter-picker-bodies";
import {
  issueFilterStoreForScope,
  parseFilterScope,
  type IssueFilterScope,
} from "@/data/stores/issue-filter-store-registry";
import { PROPERTY_FILTER_PREFIX } from "@/data/stores/issue-filter-slice";
import { useActivePropertyCatalog } from "@/data/queries/properties";
import { PropertyCatalogStatus } from "@/components/property/property-catalog-status";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useFilterSheetFacetCounts } from "@/data/queries/issue-facets";
import { useRunningIssueIds } from "@/data/queries/agent-task-snapshot";
import {
  countWorkingOnly,
  withWorkingCountDimension,
} from "@/lib/issue-table-group-counts";
import { facetValuesFor } from "@/lib/issue-facet-counts";
import { buildIssueWindow } from "@/data/stores/issue-filter-slice";
import type { IssueProperty } from "@multica/core/types";
import type { ActorFilterValue } from "@/data/stores/issue-filter-slice";
import { useTranslation } from "@/lib/i18n/react";

type Scope = IssueFilterScope;
export type FilterDim =
  | "assignee"
  | "creator"
  | "project"
  | "label"
  | `property:${string}`;

export default function IssuesFilterPickerRoute() {
  const {
    scope: scopeParam,
    dim,
    project: projectIdParam,
  } = useLocalSearchParams<{
    scope?: string;
    dim?: string;
    /** Project surface id, forwarded from `issues-filter.tsx` so the facet
     *  counts can be evaluated against the same project the list shows. */
    project?: string;
  }>();
  const resolvedScope: Scope = parseFilterScope(scopeParam);
  const { t } = useTranslation();
  const navigation = useNavigation();

  // property:<id> dims resolve their definition from the property catalog;
  // the other four are the classic simple dims.
  const propertyId =
    dim?.startsWith(PROPERTY_FILTER_PREFIX) && dim.length > PROPERTY_FILTER_PREFIX.length
      ? dim.slice(PROPERTY_FILTER_PREFIX.length)
      : null;
  const resolvedDim: FilterDim = propertyId
    ? (`property:${propertyId}` as const)
    : dim === "creator" || dim === "project" || dim === "label"
      ? dim
      : "assignee";

  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  // Four-state read (MYS-1892): resolving `propertyDef` out of a `= []`
  // default made an in-flight or failed catalog look like a definition that
  // no longer exists, so this sheet answered 「无匹配结果」 for a property that
  // was simply not loaded yet.
  const catalog = useActivePropertyCatalog(wsId);
  const propertyDef = propertyId
    ? catalog.definitions.find((p) => p.id === propertyId)
    : undefined;

  // The same facet counts the panel badges its dimension rows with — same
  // store, same scope, same window, so a dimension's number and the sum of
  // the options in this sheet describe one row set. Undefined (unresolved,
  // failed, or a project sheet with no id) renders no badges at all; see
  // `lib/issue-facet-counts.ts`.
  const facetStore = issueFilterStoreForScope(resolvedScope)();
  // The option rows must badge the SAME numbers the panel's dimension rows do,
  // so this window carries the working dimension identically (MYS-2017) — same
  // running set, same scope clamp. A picker that resolved its own counts would
  // be the one place the two sheets could disagree.
  const runningIssueIds = useRunningIssueIds();
  const facetCounts = useFilterSheetFacetCounts({
    wsId,
    sheetScope: resolvedScope,
    tab: (facetStore as { scope?: string }).scope,
    window: withWorkingCountDimension(
      buildIssueWindow(facetStore),
      countWorkingOnly(resolvedScope, facetStore.workingOnly),
      runningIssueIds,
    ),
    includeSubIssues: facetStore.showSubIssues,
    projectId: projectIdParam,
  });

  const titleKey =
    resolvedDim === "assignee"
      ? "filter.assignee"
      : resolvedDim === "creator"
        ? "filter.creator"
        : resolvedDim === "project"
          ? "filter.project"
          : resolvedDim === "label"
            ? "filter.label"
            : null;

  // Inline header (the filter panel sheet has `headerShown: false`, and this
  // pushed picker inherits the same SHEET_OPTIONS registration).
  useLayoutEffect(() => {
    navigation.setOptions({
      title: propertyId ? (propertyDef?.name ?? propertyId) : t(titleKey!),
    });
  }, [navigation, titleKey, propertyId, propertyDef, t]);

  const close = () => navigation.goBack();

  if (resolvedDim === "assignee" || resolvedDim === "creator") {
    return (
      <PickerChrome title={t(titleKey!)} onDone={close} t={t}>
        <ActorPickerBody
          dim={resolvedDim}
          scope={resolvedScope}
          searchPlaceholder={t("picker.searchPeople")}
          counts={
            resolvedDim === "assignee"
              ? facetValuesFor(facetCounts, { kind: "assignee" })
              : facetValuesFor(facetCounts, { kind: "creator" })
          }
        />
      </PickerChrome>
    );
  }

  if (resolvedDim === "project") {
    return (
      <PickerChrome title={t(titleKey!)} onDone={close} t={t}>
        <ProjectPickerBody
          scope={resolvedScope}
          counts={facetValuesFor(facetCounts, { kind: "project" })}
        />
      </PickerChrome>
    );
  }

  if (resolvedDim === "label") {
    return (
      <PickerChrome title={t(titleKey!)} onDone={close} t={t}>
        <LabelPickerBody
          scope={resolvedScope}
          counts={facetValuesFor(facetCounts, { kind: "label" })}
        />
      </PickerChrome>
    );
  }

  // property:<id> — the definition must still exist in the active catalog
  // (it can be archived while a stale filter lingers); skip the body when
  // gone so the sheet doesn't render against a ghost.
  //
  // "Gone" is only knowable once the catalog SETTLED (MYS-1892): while it is
  // loading or failed, the honest answer is that we don't know yet — an
  // unanswered 「无匹配结果」 for a property that exists reads as data loss.
  return (
    <PickerChrome title={propertyDef?.name ?? propertyId ?? ""} onDone={close} t={t}>
      {propertyDef ? (
        <PropertyPickerBody
          property={propertyDef}
          scope={resolvedScope}
        />
      ) : catalog.isResolved ? (
        // Settled, and the definition is not in it: archived or deleted since
        // the filter was saved, and the surface controller strips it before
        // querying. Saying "no matches" here is a fact, not a guess.
        <View className="px-3 py-8 items-center">
          <Text className="text-body text-muted-foreground">
            {t("picker.noMatches")}
          </Text>
        </View>
      ) : (
        <PropertyCatalogStatus
          state={catalog.state}
          onRetry={catalog.retry}
          layout="centered"
        />
      )}
    </PickerChrome>
  );
}

/**
 * Actor multi-select body wired straight to the view store — one
 * unconditional subscription to the store the scope param resolves. Selected
 * set and toggle come from that same store the panel edits — no callbacks.
 */
function ActorPickerBody({
  dim,
  scope,
  searchPlaceholder,
  counts,
}: {
  dim: "assignee" | "creator";
  scope: Scope;
  searchPlaceholder: string;
  counts?: ReadonlyMap<string, number>;
}) {
  const s = issueFilterStoreForScope(scope)();
  const selected = dim === "assignee" ? s.assigneeFilters : s.creatorFilters;
  const toggle = (value: ActorFilterValue) => {
    if (dim === "assignee")
      issueFilterStoreForScope(scope).getState().toggleAssigneeFilter(value);
    else issueFilterStoreForScope(scope).getState().toggleCreatorFilter(value);
  };
  return (
    <FilterActorPickerBody
      selected={selected}
      onToggle={toggle}
      searchPlaceholder={searchPlaceholder}
      counts={counts}
    />
  );
}

/** Project multi-select body — subscribes the scope's store only. */
function ProjectPickerBody({
  scope,
  counts,
}: {
  scope: Scope;
  counts?: ReadonlyMap<string, number>;
}) {
  const s = issueFilterStoreForScope(scope)();
  return (
    <FilterProjectPickerBody
      selected={s.projectFilters}
      includeNoProject={s.includeNoProject}
      counts={counts}
      onToggle={(id) =>
        issueFilterStoreForScope(scope).getState().toggleProjectFilter(id)
      }
      onToggleNoProject={() =>
        issueFilterStoreForScope(scope).getState().toggleNoProject()
      }
    />
  );
}

/** Label multi-select body — subscribes the scope's store only. */
function LabelPickerBody({
  scope,
  counts,
}: {
  scope: Scope;
  counts?: ReadonlyMap<string, number>;
}) {
  const s = issueFilterStoreForScope(scope)();
  return (
    <FilterLabelPickerBody
      selected={s.labelFilters}
      counts={counts}
      onToggle={(id) =>
        issueFilterStoreForScope(scope).getState().toggleLabelFilter(id)
      }
    />
  );
}

/** Custom-property multi-select body — one definition's options, writing
 *  `togglePropertyFilter(definitionId, optionId)` to the scoped store. */
function PropertyPickerBody({
  property,
  scope,
}: {
  property: IssueProperty;
  scope: Scope;
}) {
  const s = issueFilterStoreForScope(scope)();
  return (
    <FilterPropertyPickerBody
      property={property}
      selected={s.propertyFilters[property.id] ?? []}
      onToggle={(optionId) =>
        issueFilterStoreForScope(scope)
          .getState()
          .togglePropertyFilter(property.id, optionId)
      }
    />
  );
}

/** Header row drawn by the sheet body: title left, Done right. The parent
 *  panel uses the same pattern (issues-filter.tsx). */
function PickerChrome({
  title,
  onDone,
  t,
  children,
}: {
  title: string;
  onDone: () => void;
  t: (id: string, params?: Record<string, string | number>) => string;
  children: React.ReactNode;
}) {
  return (
    <View className="flex-1">
      <View className="flex-row items-center justify-between px-4 pt-4 pb-2">
        <Text className="text-title-sm font-semibold text-foreground">{title}</Text>
        <Pressable onPress={onDone} hitSlop={8} className="px-2 py-1 active:opacity-60">
          <Text className="text-body text-primary font-medium">{t("common.done")}</Text>
        </Pressable>
      </View>
      <View className="flex-1">{children}</View>
    </View>
  );
}