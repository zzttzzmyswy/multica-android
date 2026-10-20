/**
 * Ephemeral target for the new-issue stage picker.
 *
 * Why this is not in `useNewIssueDraftStore`: web keeps `stage` in plain
 * `useState` (`modals/create-issue.tsx:270-271`) — it is the one manual-create
 * field that is **not** persisted. The draft store persists everything it
 * holds and restores it on the next open, which for a stage would be a silent
 * correctness bug: a stage orders an issue against ITS siblings, so a stage
 * picked while the form was pointed at parent A must never be replayed onto a
 * later issue filed under parent B (or filed rootless). Persisting it would
 * also light the draft dot for a value the user cannot see without a parent.
 *
 * The two slots are enough for the picker round trip:
 *
 *   - `parentId` — the parent the open form is pointed at, written by the
 *     attribute row when it pushes the sheet so the sheet can fetch that
 *     parent's sibling ceiling without the draft store holding the parent.
 *   - `stage` — the value read by the form and written by the sheet.
 *
 * `stage` is additionally tagged with the parent it was chosen under. The form
 * reads it through `stageFor(parentId)`, so a stage left behind by a previous
 * parent (or by a form since reset) reads back as unstaged rather than being
 * silently applied to a different issue.
 *
 * **Lifetime.** Web's `stage` is `useState` inside the create dialog
 * (`create-issue.tsx:270-271`): it dies with the dialog. This store is
 * module-level instead (the picker is a separate route, not a child of the
 * form), so the lifetime has to be restored by hand — `useNewIssueStagePick`
 * below does it, and `new-issue.tsx` calls it. The `stageFor` parent tag is
 * NOT a substitute: it stops a cross-parent leak but not the far more common
 * same-parent case, where reopening "+" under the SAME parent found the
 * previous form's pick still sitting in the chip. That was the defect fixed
 * here (MYS-2255).
 *
 * An explicit "no stage" pick and "nothing picked" are the same value (`null`)
 * on purpose: the create payload sends `stage` only when it is non-null, so
 * the two are indistinguishable at the one place that matters.
 */
import { useEffect } from "react";
import { create } from "zustand";

interface NewIssueStagePickState {
  /** Parent the sheet is currently open for (null when the sheet is closed). */
  parentId: string | null;
  /** `{ parentId, stage }` — the parent is part of the value on purpose. */
  picked: { parentId: string; stage: number | null } | null;
  /** Called by the attribute row right before pushing the picker route. */
  openFor: (parentId: string) => void;
  /** Called by the sheet once the user picks (or clears) a stage. */
  setStage: (parentId: string, stage: number | null) => void;
  /**
   * The stage chosen for `parentId`, or null when nothing was chosen for that
   * parent. A stage recorded under a different parent never leaks through.
   */
  stageFor: (parentId: string | null | undefined) => number | null;
  /** Drop everything — the form clears this when it is spent or re-opened. */
  reset: () => void;
}

export const useNewIssueStagePickStore = create<NewIssueStagePickState>(
  (set, get) => ({
    parentId: null,
    picked: null,
    openFor: (parentId) => set({ parentId }),
    setStage: (parentId, stage) => set({ picked: { parentId, stage } }),
    stageFor: (parentId) => {
      if (!parentId) return null;
      const picked = get().picked;
      return picked && picked.parentId === parentId ? picked.stage : null;
    },
    reset: () => set({ parentId: null, picked: null }),
  }),
);

/**
 * Scope the picked stage to one form's lifetime: clear on unmount.
 *
 * "Unmount" and not "submit" because the form closes down four different ways
 * — submit, cancel, swipe-down on the sheet, and a router dismiss from a
 * nested route — and a per-button reset would have to be re-added every time
 * a fifth appears. The form instance dying is the one event all four share.
 *
 * Deliberately NOT resetting on mount: `openFor` + `setStage` happen in the
 * picker sheet, which is pushed ON TOP of this form. The form does not
 * remount across that push (the sheet is a sibling route and the form is
 * still mounted underneath), which is exactly why the pick survives the round
 * trip at all. A mount-time reset would still be correct here, but it would
 * also wipe a pick whenever the screen is re-created mid-flight — e.g. a
 * Fast Refresh during development, or the router re-keying the stack — for no
 * additional safety. Unmount is the narrower, sufficient hook.
 *
 * This store is not a user-facing surface, so it is not persisted and has no
 * cross-workspace state to reconcile — a workspace switch unmounts the form
 * too, and the reset rides along.
 */
export function useNewIssueStagePick(): void {
  useEffect(() => () => useNewIssueStagePickStore.getState().reset(), []);
}
