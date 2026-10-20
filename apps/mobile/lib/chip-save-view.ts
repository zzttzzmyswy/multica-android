/**
 * The "save view" shortcut on the filter chip bar.
 *
 * Web puts two controls at the trailing edge of its chip bar: Clear, then a
 * Save/Edit button (`packages/views/issues/components/filter-chips-bar.tsx`
 * `:537-546`). Mobile shipped only Clear, so once a user had stacked six
 * filters the only way to keep them was to scroll back up to the "+" on the
 * saved-views bar — the control that exists for exactly this moment, sitting
 * out of sight of the moment.
 *
 * Two decisions live here rather than in the three host screens:
 *
 *  1. **The label is a three-way function of the open view.** Web reads
 *     `activeView ? (isViewOwner ? chip_edit : chip_save_as) : chip_save`
 *     (`issues-header.tsx:1088-1095`). "Edit" for a view you own, "Save as" for
 *     someone else's shared view (a re-save must not overwrite what they
 *     published), plain "Save" with no view open. Collapsing these into one
 *     word would tell a non-owner their tap edits a view it would actually
 *     clone.
 *
 *  2. **Tapping it must act on the OPEN view, not create a new one.** With a
 *     view open and owned, the dialog has to arrive in edit mode seeded with
 *     that view; otherwise the shortcut files a near-duplicate every time.
 *
 * The dialog itself is `components/issue/save-view-dialog.tsx` and the write
 * paths are `issue-view-bar.tsx`'s; this module only answers "what does the
 * button say and what should it open".
 */
import type { IssueView } from "@multica/core/api/schemas";

/** The three shapes the trailing control can take. */
export type ChipSaveAction = "save" | "edit" | "save-as";

/**
 * Which of the three the button is.
 *
 * `canManage` is `canManageIssueView`'s answer — the same rule the server
 * re-checks, so a non-owner never sees "Edit" over a view they cannot write.
 */
export function chipSaveAction({
  activeView,
  canManage,
}: {
  activeView: IssueView | null;
  canManage: boolean;
}): ChipSaveAction {
  if (!activeView) return "save";
  return canManage ? "edit" : "save-as";
}

/**
 * Whether the save dialog opens in edit mode (pre-filled with the open view),
 * or as a fresh create.
 *
 * Only an open, manageable view is editable. Anything else — no view, or a
 * shared view owned by someone else — opens the create form, which is what
 * "Save as" promises.
 */
export function chipSaveOpensEdit({
  activeView,
  canManage,
}: {
  activeView: IssueView | null;
  canManage: boolean;
}): boolean {
  return chipSaveAction({ activeView, canManage }) === "edit";
}

/**
 * Whether the shortcut is offered at all.
 *
 * Web omits `onSave` on surfaces without saved-view support
 * (`filter-chips-bar.tsx:511-513`, and its `actor-issues-panel.tsx:103` caller
 * passes nothing). Mobile's three issue surfaces all have views, so this is
 * really "is the view list readable" — offering Save over a list that has not
 * arrived would file a duplicate of a view the user cannot see.
 */
export function showsChipSave({ viewsSettled }: { viewsSettled: boolean }): boolean {
  return viewsSettled;
}
