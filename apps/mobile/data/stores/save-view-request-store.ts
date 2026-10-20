/**
 * Cross-component trigger for the save-view dialog (iteration 263).
 *
 * The dialog, the create/update mutations and the edit-vs-create decision all
 * live in `components/issue/issue-view-bar.tsx`, because that bar is the thing
 * that owns the view list. But the moment a user most wants to save their
 * filters is the moment the CHIP BAR is fullest — and the chip bar is a
 * sibling rendered by the host, one row below, with no handle on the bar's
 * local dialog state.
 *
 * Options were (a) lift the dialog into all three host screens — three copies
 * of the same create/update payload logic, which is the drift this repo's
 * `lib/` layer exists to prevent — or (b) let the chip bar raise an intent the
 * bar consumes. This is (b): a per-container request counter.
 *
 * A counter rather than a boolean on purpose. A boolean would have to be reset
 * by the consumer, and "consume then clear" races with re-renders: two taps in
 * quick succession collapse into one open, and a clear that lands after the
 * next raise silently swallows it. A monotonically increasing token makes each
 * request distinct, so the consumer's "did this change since I last looked"
 * check is a plain inequality with nothing to reset.
 */
import { create } from "zustand";

interface SaveViewRequestState {
  /** container key → number of save requests raised so far. */
  tokens: Record<string, number>;
  /** Raise a save-view request for one container. */
  request: (containerKey: string) => void;
}

export const useSaveViewRequestStore = create<SaveViewRequestState>((set) => ({
  tokens: {},
  request: (containerKey) =>
    set((state) => ({
      tokens: {
        ...state.tokens,
        [containerKey]: (state.tokens[containerKey] ?? 0) + 1,
      },
    })),
}));

/** Fire a save-view request. Safe to call outside React (event handlers). */
export function requestSaveView(containerKey: string): void {
  useSaveViewRequestStore.getState().request(containerKey);
}

/** Current token for one container — 0 means "never asked". */
export function saveViewRequestToken(containerKey: string): number {
  return useSaveViewRequestStore.getState().tokens[containerKey] ?? 0;
}
