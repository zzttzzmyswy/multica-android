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
import { useQuery } from "@tanstack/react-query";
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
import { propertyActiveOptions } from "@/data/queries/properties";
import { useWorkspaceStore } from "@/data/workspace-store";
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
  const { scope: scopeParam, dim } = useLocalSearchParams<{
    scope?: string;
    dim?: string;
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
  const { data: properties = [] } = useQuery(propertyActiveOptions(wsId));
  const propertyDef = propertyId
    ? properties.find((p) => p.id === propertyId)
    : undefined;

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
        />
      </PickerChrome>
    );
  }

  if (resolvedDim === "project") {
    return (
      <PickerChrome title={t(titleKey!)} onDone={close} t={t}>
        <ProjectPickerBody scope={resolvedScope} />
      </PickerChrome>
    );
  }

  if (resolvedDim === "label") {
    return (
      <PickerChrome title={t(titleKey!)} onDone={close} t={t}>
        <LabelPickerBody scope={resolvedScope} />
      </PickerChrome>
    );
  }

  // property:<id> — the definition must still exist in the active catalog
  // (it can be archived while a stale filter lingers); skip the body when
  // gone so the sheet doesn't render against a ghost.
  return (
    <PickerChrome title={propertyDef?.name ?? propertyId ?? ""} onDone={close} t={t}>
      {propertyDef ? (
        <PropertyPickerBody
          property={propertyDef}
          scope={resolvedScope}
        />
      ) : (
        <View className="px-3 py-8 items-center">
          <Text className="text-sm text-muted-foreground">
            {t("picker.noMatches")}
          </Text>
        </View>
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
}: {
  dim: "assignee" | "creator";
  scope: Scope;
  searchPlaceholder: string;
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
    />
  );
}

/** Project multi-select body — subscribes the scope's store only. */
function ProjectPickerBody({ scope }: { scope: Scope }) {
  const s = issueFilterStoreForScope(scope)();
  return (
    <FilterProjectPickerBody
      selected={s.projectFilters}
      includeNoProject={s.includeNoProject}
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
function LabelPickerBody({ scope }: { scope: Scope }) {
  const s = issueFilterStoreForScope(scope)();
  return (
    <FilterLabelPickerBody
      selected={s.labelFilters}
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
        <Text className="text-base font-semibold text-foreground">{title}</Text>
        <Pressable onPress={onDone} hitSlop={8} className="px-2 py-1 active:opacity-60">
          <Text className="text-sm text-primary font-medium">{t("common.done")}</Text>
        </Pressable>
      </View>
      <View className="flex-1">{children}</View>
    </View>
  );
}