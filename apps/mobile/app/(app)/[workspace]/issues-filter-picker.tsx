/**
 * Multi-select picker sheet for one ISSUE FILTER dimension. Opened from the
 * `issues-filter` panel rows:
 *
 *   - `?scope=my|all`   → which view-store the selection persists into
 *   - `?dim=assignee`   → members/agents/squads filter (no-unassigned row;
 *                         the panel owns includeNoAssignee)
 *   - `?dim=creator`    → same actor list, for creator
 *   - `?dim=project`    → projects + "No project" row
 *   - `?dim=label`      → labels (no inline create)
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
} from "@/components/issue/pickers/filter-picker-bodies";
import { useIssuesViewStore } from "@/data/stores/issues-view-store";
import { useMyIssuesViewStore } from "@/data/stores/my-issues-view-store";
import type {
  ActorFilterValue,
  IssueFilterSlice,
} from "@/data/stores/issue-filter-slice";
import { useTranslation } from "@/lib/i18n/react";

type Scope = "my" | "all";
export type FilterDim = "assignee" | "creator" | "project" | "label";

export default function IssuesFilterPickerRoute() {
  const { scope: scopeParam, dim } = useLocalSearchParams<{
    scope?: string;
    dim?: string;
  }>();
  const resolvedScope: Scope = scopeParam === "all" ? "all" : "my";
  const resolvedDim: FilterDim =
    dim === "creator" || dim === "project" || dim === "label"
      ? dim
      : "assignee";
  const { t } = useTranslation();
  const navigation = useNavigation();

  const titleKey =
    resolvedDim === "assignee"
      ? "filter.assignee"
      : resolvedDim === "creator"
        ? "filter.creator"
        : resolvedDim === "project"
          ? "filter.project"
          : "filter.label";

  // Inline header (the filter panel sheet has `headerShown: false`, and this
  // pushed picker inherits the same SHEET_OPTIONS registration).
  useLayoutEffect(() => {
    navigation.setOptions({ title: t(titleKey) });
  }, [navigation, titleKey, t]);

  const close = () => navigation.goBack();

  if (resolvedDim === "assignee" || resolvedDim === "creator") {
    return (
      <PickerChrome title={t(titleKey)} onDone={close} t={t}>
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
      <PickerChrome title={t(titleKey)} onDone={close} t={t}>
        <ProjectPickerBody scope={resolvedScope} />
      </PickerChrome>
    );
  }

  return (
    <PickerChrome title={t(titleKey)} onDone={close} t={t}>
      <LabelPickerBody scope={resolvedScope} />
    </PickerChrome>
  );
}

/**
 * Actor multi-select body wired straight to the view store, split by scope
 * so the selector hooks are unconditional (both branches subscribe the
 * concrete store). Selected set and toggle come from the same store the
 * panel edits — no callbacks.
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
  const allState = useIssuesViewStore();
  const myState = useMyIssuesViewStore();
  const s =
    scope === "all"
      ? (allState as IssueFilterSlice)
      : (myState as IssueFilterSlice);
  const selected = dim === "assignee" ? s.assigneeFilters : s.creatorFilters;
  const toggle = (value: ActorFilterValue) => {
    if (dim === "assignee") {
      if (scope === "all")
        useIssuesViewStore.getState().toggleAssigneeFilter(value);
      else useMyIssuesViewStore.getState().toggleAssigneeFilter(value);
    } else {
      if (scope === "all")
        useIssuesViewStore.getState().toggleCreatorFilter(value);
      else useMyIssuesViewStore.getState().toggleCreatorFilter(value);
    }
  };
  return (
    <FilterActorPickerBody
      selected={selected}
      onToggle={toggle}
      searchPlaceholder={searchPlaceholder}
    />
  );
}

/** Project multi-select body — subscribes both stores unconditionally. */
function ProjectPickerBody({ scope }: { scope: Scope }) {
  const allState = useIssuesViewStore();
  const myState = useMyIssuesViewStore();
  const s =
    scope === "all"
      ? (allState as IssueFilterSlice)
      : (myState as IssueFilterSlice);
  return (
    <FilterProjectPickerBody
      selected={s.projectFilters}
      includeNoProject={s.includeNoProject}
      onToggle={(id) => {
        if (scope === "all")
          useIssuesViewStore.getState().toggleProjectFilter(id);
        else useMyIssuesViewStore.getState().toggleProjectFilter(id);
      }}
      onToggleNoProject={() => {
        if (scope === "all") useIssuesViewStore.getState().toggleNoProject();
        else useMyIssuesViewStore.getState().toggleNoProject();
      }}
    />
  );
}

/** Label multi-select body — subscribes both stores unconditionally. */
function LabelPickerBody({ scope }: { scope: Scope }) {
  const allState = useIssuesViewStore();
  const myState = useMyIssuesViewStore();
  const s =
    scope === "all"
      ? (allState as IssueFilterSlice)
      : (myState as IssueFilterSlice);
  return (
    <FilterLabelPickerBody
      selected={s.labelFilters}
      onToggle={(id) => {
        if (scope === "all")
          useIssuesViewStore.getState().toggleLabelFilter(id);
        else useMyIssuesViewStore.getState().toggleLabelFilter(id);
      }}
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