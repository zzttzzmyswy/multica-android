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
 * share or unshare (workspace-scoped views only) / Delete — all gated by
 * the same `canManageIssueView` affordance rule the server re-checks on
 * write. This mirrors web's manage-views-dialog in a phone-native shape.
 *
 * Date and scope remain user layers on top of a view (web semantics) — the
 * save dialog only captures the nine filter dims + display defaults.
 */
import { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
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
} from "@/data/queries/issue-views";
import {
  useCreateIssueView,
  useDeleteIssueView,
  useUpdateIssueView,
} from "@/data/mutations/issue-views";
import { memberListOptions } from "@/data/queries/members";
import {
  type IssueViewSnapshotSource,
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

  const [dialog, setDialog] = useState<
    | { mode: "create" }
    | { mode: "edit"; view: IssueView }
    | null
  >(null);

  const canManage = useCallback(
    (view: IssueView) =>
      canManageIssueView(view, user?.id ?? null, currentRole),
    [user, currentRole],
  );

  const openSaveDialog = () => setDialog({ mode: "create" });

  const submitSave = (name: string, visibility: "private" | "workspace") => {
    if (dialog?.mode === "edit") {
      const target = dialog.view;
      updateView.mutate(
        { id: target.id, name, expected_revision: target.revision },
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
          sortDirection: slice.sortDirection,
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
    const workspaceCommentable =
      scope.scope_type === "workspace" && manageable;

    type Action =
      | { kind: "rename" }
      | { kind: "duplicate" }
      | { kind: "share" }
      | { kind: "unshare" }
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
          {views && views.length === 0 ? (
            <Text
              className="text-xs text-muted-foreground py-1 max-w-72"
              numberOfLines={1}
            >
              {t("issueViews.noViews")}
            </Text>
          ) : (
            (views ?? []).map((view) => {
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
        <Button
          variant="ghost"
          size="icon"
          onPress={openSaveDialog}
          accessibilityLabel={t("issueViews.saveView")}
          className="ml-auto shrink-0"
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
        visibilityAllowed={scope.scope_type === "workspace"}
        onCancel={() => setDialog(null)}
        onSubmit={submitSave}
      />
    </>
  );
}