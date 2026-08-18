/**
 * Saved-views bar (iteration-65) — mobile surface of web's `view-bar`
 * (`packages/views/issues/components/view-bar.tsx`), scoped to the two
 * phone-appropriate behaviors:
 *
 *   · a horizontal, horizontally-scrollable row of saved views under the
 *     scope/header row. Tapping one applies it (filters + sort + grouping +
 *     list/board) via `onApplyView`; the active view's chip is highlighted
 *     and gains a dot when the live window has drifted from the saved
 *     snapshot (`modifiedActive`, computed by the surface with
 *     `viewMatchesSlice`). Tapping the active, modified chip again exits the
 *     view (`onExitView` → reset to the surface default).
 *   · a trailing "+" opens the SaveViewDialog (create — captures the
 *     CURRENT window via `viewQueryFromSnapshot` / `viewDisplayFromState`,
 *     exactly web's save-view-dialog payload).
 *
 * Long-pressing a chip opens the manage action sheet: Rename / Duplicate /
 * share or unshare (workspace-scoped views only) / Hide (bar preference) /
 * Delete — all gated by the same `canManageIssueView` affordance rule the
 * server re-checks on write (Hide/Show is a personal preference, always
 * available). This mirrors web's manage-views-dialog + view-bar.tsx:202-262
 * in a phone-native shape.
 *
 * Iteration-67 adds the view-bar preference: a per-scope `{hidden, order}`
 * doc persisted via /api/issue-view-preferences (get/put with optimistic
 * patch) — hiding the active view auto-exits it, the "reorder-three" button
 * opens a manage list (hide/reveal + move up/down), and applying a view lets
 * the user pick its sort direction in the save/edit dialog (sent in
 * `display.sortDirection`).
 *
 * Date and scope remain user layers on top of a view (web semantics) — the
 * save dialog only captures the nine filter dims + display defaults.
 */
import { useCallback, useMemo, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { CreateIssueViewRequest, IssueView } from "@multica/core/api/schemas";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { LongPressView } from "@/components/ui/long-press-view";
import { SaveViewDialog } from "@/components/issue/save-view-dialog";
import { ActionSheet } from "@/lib/action-sheet";
import { useTranslation } from "@/lib/i18n/react";
import { useAuthStore } from "@/data/auth-store";
import {
  canManageIssueView,
  issueViewListOptions,
  scopeAllowsViewVisibility,
} from "@/data/queries/issue-views";
import {
  applyViewBarPrefs,
  EMPTY_VIEW_BAR_PREFS,
  issueViewPreferenceOptions,
  sanitizeViewBarPrefs,
  viewBarItemId,
  type ViewBarPrefs,
} from "@/data/queries/issue-view-prefs";
import { useUpdateIssueViewPreference } from "@/data/mutations/issue-view-prefs";
import {
  useCreateIssueView,
  useDeleteIssueView,
  useUpdateIssueView,
} from "@/data/mutations/issue-views";
import { memberListOptions } from "@/data/queries/members";
import {
  type IssueViewSnapshotSource,
  sanitizeViewDisplay,
  viewDisplayFromState,
  viewQueryFromSnapshot,
} from "@/data/stores/issue-view-codec";
import type { IssueViewMode } from "@/data/stores/issue-filter-slice";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

interface IssueViewBarProps {
  wsId: string | null;
  /** The (scope_type, scope_id) container this surface's views live in. */
  scope: { scope_type: "workspace" | "my" | "project"; scope_id?: string | null };
  /** Current scope tab in view-variant vocabulary (workspace: all/members/
   *  agents; my: assigned/created/involved) — captured into new views so
   *  opening them lands on the same axis the user was on. */
  scopeVariant: CreateIssueViewRequest["scope_variant"];
  slice: IssueViewSnapshotSource;
  viewMode: IssueViewMode;
  activeViewId: string | null;
  modifiedActive: boolean;
  onApplyView: (view: IssueView) => void;
  onExitView: () => void;
}

export function IssueViewBar({
  wsId,
  scope,
  scopeVariant,
  slice,
  viewMode,
  activeViewId,
  modifiedActive,
  onApplyView,
  onExitView,
}: IssueViewBarProps) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const user = useAuthStore((s) => s.user);
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const currentRole =
    members.find((m) => m.user_id === user?.id)?.role ?? null;

  const { data: views } = useQuery({ ...issueViewListOptions(wsId, scope) });
  const createView = useCreateIssueView(wsId);
  const updateView = useUpdateIssueView(wsId, scope);
  const deleteView = useDeleteIssueView(wsId, scope);

  // View-bar preference (hidden + order, per scope) — iteration-67. Mirrors
  // web view-bar.tsx:204-206 / preferences.ts applyViewBarPrefs. The doc is
  // upserted optimistically on every toggle/reorder via the mutation below.
  const { data: preference } = useQuery({
    ...issueViewPreferenceOptions(wsId, scope),
  });
  const prefs: ViewBarPrefs = preference?.prefs ?? EMPTY_VIEW_BAR_PREFS;
  const updatePreference = useUpdateIssueViewPreference(wsId, scope);

  const allViewItems = useMemo(
    () => (views ?? []).map((view) => ({ barItemId: viewBarItemId(view.id), view })),
    [views],
  );
  const { visible: visibleItems, hiddenSet } = useMemo(
    () => applyViewBarPrefs(allViewItems, prefs),
    [allViewItems, prefs],
  );

  /** Persist a prefs doc, dropping stale ids (deleted views) — mirrors web
   *  view-bar.tsx:305-317 savePrefs. */
  const savePrefs = (next: ViewBarPrefs) => {
    updatePreference.mutate(
      sanitizeViewBarPrefs(next, (views ?? []).map((v) => viewBarItemId(v.id))),
    );
  };

  /** Hide/reveal a view. Hiding the active view exits it first — mirrors web
   *  view-bar.tsx:345-356 toggleHidden. */
  const toggleHidden = (view: IssueView, hidden: boolean) => {
    const id = viewBarItemId(view.id);
    const nextHidden = new Set(hiddenSet);
    if (hidden) nextHidden.add(id);
    else nextHidden.delete(id);
    if (hidden && activeViewId === view.id) onExitView();
    const nextOrder = allViewItems.map((item) => item.barItemId);
    savePrefs({ hidden: [...nextHidden], order: nextOrder });
  };

  const [dialog, setDialog] = useState<
    | { mode: "create" }
    | { mode: "edit"; view: IssueView }
    | null
  >(null);
  const [manageOpen, setManageOpen] = useState(false);

  const canManage = useCallback(
    (view: IssueView) =>
      canManageIssueView(view, user?.id ?? null, currentRole),
    [user, currentRole],
  );

  const openSaveDialog = () => setDialog({ mode: "create" });

  const submitSave = (
    name: string,
    visibility: "private" | "workspace",
    sortDirection: "asc" | "desc",
  ) => {
    if (dialog?.mode === "edit") {
      const target = dialog.view;
      const currentSort = sanitizeViewDisplay(
        target.display ?? {},
        slice.sortBy,
      ).sortDirection;
      updateView.mutate(
        {
          id: target.id,
          name,
          expected_revision: target.revision,
          ...(currentSort !== sortDirection
            ? { display: { ...target.display, sortDirection } }
            : {}),
        },
        { onSettled: () => setDialog(null) },
      );
      return;
    }
    setDialog(null);
    createView.mutate(
      {
        name,
        scope_type: scope.scope_type,
        scope_id: scope.scope_id ?? null,
        scope_variant: scopeVariant,
        visibility,
        definition_version: 1,
        query: viewQueryFromSnapshot(slice),
        display: viewDisplayFromState({
          view: viewMode,
          grouping: slice.grouping,
          sortBy: slice.sortBy,
          sortDirection,
        }),
      },
      {
        onSuccess: (created) => {
          if (created) onApplyView(created);
        },
      },
    );
  };

  const openManage = (view: IssueView) => {
    Haptics.selectionAsync().catch(() => {});
    const manageable = canManage(view);
    // Any non-my scope can carry workspace-visibility views (web
    // save-view-dialog shows the visibility row for every scope.kind != my)
    // — so share/unshare shows for workspace AND project scopes.
    const workspaceCommentable =
      scopeAllowsViewVisibility(scope.scope_type) && manageable;

    type Action =
      | { kind: "rename" }
      | { kind: "duplicate" }
      | { kind: "share" }
      | { kind: "unshare" }
      | { kind: "hide" }
      | { kind: "delete" }
      | { kind: "cancel" };

    const options: string[] = [];
    const actions: Action[] = [];
    const push = (label: string, action: Action) => {
      options.push(label);
      actions.push(action);
    };

    if (manageable) push(t("issueViews.rename"), { kind: "rename" });
    push(t("issueViews.duplicate"), { kind: "duplicate" });
    if (workspaceCommentable) {
      push(
        view.visibility === "workspace"
          ? t("issueViews.unshare")
          : t("issueViews.share"),
        view.visibility === "workspace"
          ? { kind: "unshare" }
          : { kind: "share" },
      );
    }
    // Iteration-67: hide/reveal is a personal bar preference, not a manager
    // action — always available (web view-bar.tsx:202-262).
    push(
      hiddenSet.has(viewBarItemId(view.id))
        ? t("issueViews.show")
        : t("issueViews.hide"),
      { kind: "hide" },
    );
    if (manageable) push(t("issueViews.delete"), { kind: "delete" });
    push(t("menu.cancel"), { kind: "cancel" });

    const cancelButtonIndex = options.length - 1;
    const destructiveButtonIndex = manageable ? options.length - 2 : undefined;

    ActionSheet.showActionSheetWithOptions(
      { options, cancelButtonIndex, destructiveButtonIndex },
      (i) => {
        const action = actions[i];
        if (!action) return;
        switch (action.kind) {
          case "rename":
            setDialog({ mode: "edit", view });
            break;
          case "duplicate":
            createView.mutate({
              name: `${view.name} ${t("issueViews.duplicate")}`,
              scope_type: view.scope_type as CreateIssueViewRequest["scope_type"],
              scope_id: view.scope_id,
              scope_variant: view.scope_variant as CreateIssueViewRequest["scope_variant"],
              visibility: "private",
              definition_version: view.definition_version || 1,
              query: view.query,
              display: view.display,
            });
            break;
          case "share":
            updateView.mutate({
              id: view.id,
              visibility: "workspace",
              expected_revision: view.revision,
            });
            break;
          case "unshare":
            updateView.mutate({
              id: view.id,
              visibility: "private",
              expected_revision: view.revision,
            });
            break;
          case "hide":
            toggleHidden(view, !hiddenSet.has(viewBarItemId(view.id)));
            break;
          case "delete":
            Alert.alert(
              t("issueViews.deleteConfirmTitle"),
              t("issueViews.deleteConfirmMessage", { name: view.name }),
              [
                { text: t("common.cancel"), style: "cancel" },
                {
                  text: t("issueViews.delete"),
                  style: "destructive",
                  onPress: () => {
                    if (activeViewId === view.id) onExitView();
                    deleteView.mutate(view.id);
                  },
                },
              ],
              { cancelable: true },
            );
            break;
          case "cancel":
            break;
        }
      },
    );
  };

  const fg = THEME[colorScheme].foreground;
  const dim = THEME[colorScheme].mutedForeground;

  return (
    <>
      <View className="flex-row items-center gap-1 px-4 pb-1">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-1.5 items-center pr-2"
        >
          {visibleItems.length === 0 ? (
            <Text
              className="text-xs text-muted-foreground py-1 max-w-72"
              numberOfLines={1}
            >
              {t("issueViews.noViews")}
            </Text>
          ) : (
            visibleItems.map(({ view }) => {
              const active = activeViewId === view.id;
              const shared = view.visibility === "workspace";
              const showDot = active && modifiedActive;
              return (
                <LongPressView
                  key={view.id}
                  onLongPress={() => openManage(view)}
                >
                  <Pressable
                    onPress={() =>
                      active && modifiedActive ? onExitView() : onApplyView(view)
                    }
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    className={[
                      "flex-row items-center gap-1 rounded-full border px-3 py-1",
                      active
                        ? "border-primary bg-primary/10"
                        : "border-border bg-secondary/40",
                    ].join(" ")}
                  >
                    <Text
                      numberOfLines={1}
                      className={[
                        "text-xs font-medium max-w-36",
                        active ? "text-primary" : "text-muted-foreground",
                      ].join(" ")}
                    >
                      {view.name}
                    </Text>
                    {shared ? (
                      <Ionicons name="people" size={11} color={dim} />
                    ) : null}
                    {showDot ? (
                      <View className="size-1.5 rounded-full bg-amber-500" />
                    ) : null}
                  </Pressable>
                </LongPressView>
              );
            })
          )}
        </ScrollView>
        {allViewItems.length > 1 ? (
          <Button
            variant="ghost"
            size="icon"
            onPress={() => setManageOpen(true)}
            accessibilityLabel={t("issueViews.manageViews")}
            className="ml-auto shrink-0"
          >
            <Ionicons name="reorder-three" size={20} color={dim} />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          onPress={openSaveDialog}
          accessibilityLabel={t("issueViews.saveView")}
          className="shrink-0"
        >
          <Ionicons name="add" size={18} color={fg} />
        </Button>
      </View>
      <SaveViewDialog
        visible={dialog !== null}
        initialName={dialog?.mode === "edit" ? dialog.view.name : ""}
        initialVisibility={
          dialog?.mode === "edit"
            ? dialog.view.visibility === "workspace"
              ? "workspace"
              : "private"
            : "private"
        }
        visibilityAllowed={scopeAllowsViewVisibility(scope.scope_type)}
        sortDirectionAllowed
        initialSortDirection={
          dialog?.mode === "edit"
            ? sanitizeViewDisplay(dialog.view.display ?? {}, slice.sortBy)
                .sortDirection
            : slice.sortDirection
        }
        onCancel={() => setDialog(null)}
        onSubmit={submitSave}
      />
      <ViewBarManageModal
        visible={manageOpen}
        items={allViewItems}
        prefs={prefs}
        hiddenSet={hiddenSet}
        onToggleHidden={(view, hidden) => toggleHidden(view, hidden)}
        onMove={(viewId, direction) => {
          const current = applyViewBarPrefs(allViewItems, prefs).ordered.map(
            (i) => i.barItemId,
          );
          const id = viewBarItemId(viewId);
          const index = current.indexOf(id);
          const target = direction === "up" ? index - 1 : index + 1;
          if (index < 0 || target < 0 || target >= current.length) return;
          const next = [...current];
          const [moved] = next.splice(index, 1);
          next.splice(target, 0, moved);
          savePrefs({ hidden: [...hiddenSet], order: next });
        }}
        onClose={() => setManageOpen(false)}
      />
    </>
  );
}

function ViewBarManageModal({
  visible,
  items,
  prefs,
  hiddenSet,
  onToggleHidden,
  onMove,
  onClose,
}: {
  visible: boolean;
  items: { barItemId: string; view: IssueView }[];
  prefs: ViewBarPrefs;
  hiddenSet: Set<string>;
  onToggleHidden: (view: IssueView, hidden: boolean) => void;
  onMove: (viewId: string, direction: "up" | "down") => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const dim = THEME[colorScheme].mutedForeground;
  const ordered = applyViewBarPrefs(items, prefs).ordered;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable className="flex-1 bg-black/40" onPress={onClose}>
        <View className="flex-1 items-center justify-center px-6">
          <Pressable onPress={() => {}} className="w-full max-w-sm">
            <View className="bg-popover rounded-2xl overflow-hidden p-4 gap-3">
              <Text className="text-base font-semibold text-foreground">
                {t("issueViews.manageViews")}
              </Text>
              <Text className="text-xs text-muted-foreground leading-4">
                {t("issueViews.reorderHint")}
              </Text>
              <View className="max-h-80 gap-1">
                {ordered.map(({ view }, index) => {
                  const hidden = hiddenSet.has(viewBarItemId(view.id));
                  return (
                    <View
                      key={view.id}
                      className="flex-row items-center gap-2 rounded-lg bg-secondary/30 px-2 py-2"
                    >
                      <Pressable
                        onPress={() => onToggleHidden(view, !hidden)}
                        hitSlop={6}
                        accessibilityLabel={
                          hidden
                            ? t("issueViews.show")
                            : t("issueViews.hide")
                        }
                      >
                        <Ionicons
                          name={hidden ? "eye-off-outline" : "eye-outline"}
                          size={17}
                          color={hidden ? dim : THEME[colorScheme].foreground}
                        />
                      </Pressable>
                      <Text
                        numberOfLines={1}
                        className={[
                          "flex-1 text-sm font-medium",
                          hidden ? "text-muted-foreground line-through" : "text-foreground",
                        ].join(" ")}
                      >
                        {view.name}
                      </Text>
                      {hidden ? (
                        <Text className="text-[10px] text-muted-foreground">
                          {t("issueViews.hidden")}
                        </Text>
                      ) : null}
                      <Pressable
                        onPress={() => onMove(view.id, "up")}
                        disabled={index === 0}
                        hitSlop={6}
                        className="p-1 disabled:opacity-30"
                        accessibilityLabel={t("issueViews.moveUp")}
                      >
                        <Ionicons name="chevron-up" size={15} color={dim} />
                      </Pressable>
                      <Pressable
                        onPress={() => onMove(view.id, "down")}
                        disabled={index === ordered.length - 1}
                        hitSlop={6}
                        className="p-1 disabled:opacity-30"
                        accessibilityLabel={t("issueViews.moveDown")}
                      >
                        <Ionicons name="chevron-down" size={15} color={dim} />
                      </Pressable>
                    </View>
                  );
                })}
              </View>
              <View className="flex-row justify-end">
                <Button variant="ghost" onPress={onClose}>
                  <Text>{t("common.done")}</Text>
                </Button>
              </View>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}