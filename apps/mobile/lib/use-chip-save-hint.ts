/**
 * Hook behind the filter chip bar's save-view shortcut.
 *
 * The three issue surfaces all render `ActiveFilterChips`, and each one already
 * knows its view scope. What none of them should re-derive is the three-way
 * label rule (Save / Edit / Save as) — that belongs to `lib/chip-save-view.ts`,
 * with the capabilities read here.
 *
 * The actual dialog lives in `issue-view-bar.tsx` (it owns the view list and
 * the write mutations). So the shortcut does not open anything itself: it
 * raises a per-container request token that the bar consumes. That keeps one
 * implementation of the create/update payload instead of three copies in the
 * host screens — see `data/stores/save-view-request-store.ts`.
 */
import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { IssueView } from "@multica/core/api/schemas";
import { memberListOptions } from "@/data/queries/members";
import {
  canManageIssueView,
  issueViewListOptions,
  type IssueViewScope,
} from "@/data/queries/issue-views";
import {
  issueViewContainerKey,
  useActiveIssueViewStore,
} from "@/data/stores/active-issue-view-store";
import { requestSaveView } from "@/data/stores/save-view-request-store";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { chipSaveAction, showsChipSave } from "@/lib/chip-save-view";
import { catalogRead } from "@/lib/catalog-read";
import { useTranslation } from "@/lib/i18n/react";

export interface ChipSaveHint {
  /** Render the shortcut at all. False while the view list is unread. */
  visible: boolean;
  /** "Save" / "Edit" / "Save as" — web's three-way label. */
  label: string;
  /** Raise the request the view bar consumes. */
  onPress: () => void;
}

export function useChipSaveHint(scope: IssueViewScope): ChipSaveHint {
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const user = useAuthStore((s) => s.user);
  const containerKey = useMemo(
    () => issueViewContainerKey(wsId, scope),
    [wsId, scope],
  );
  const activeViewId = useActiveIssueViewStore(
    (s) => s.active[containerKey] ?? null,
  );
  const viewsRead = catalogRead(useQuery(issueViewListOptions(wsId, scope)));
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const currentRole =
    members.find((m) => m.user_id === user?.id)?.role ?? null;

  const activeView: IssueView | null = useMemo(
    () => viewsRead.items.find((v) => v.id === activeViewId) ?? null,
    [viewsRead.items, activeViewId],
  );
  const canManage = activeView
    ? canManageIssueView(activeView, user?.id ?? null, currentRole)
    : false;

  const action = chipSaveAction({ activeView, canManage });
  const label =
    action === "edit"
      ? t("issueViews.chipEdit")
      : action === "save-as"
        ? t("issueViews.chipSaveAs")
        : t("issueViews.saveView");

  const onPress = useCallback(() => {
    requestSaveView(containerKey);
  }, [containerKey]);

  return {
    visible: showsChipSave({ viewsSettled: viewsRead.isResolved }),
    label,
    onPress,
  };
}
