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
 */
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
