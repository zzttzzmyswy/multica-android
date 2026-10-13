/**
 * Screen-scoped state for "open a task from comment X" — read by the confirm
 * route, written by the comment long-press action sheet.
 *
 * Same shape and the same reason as `reply-target-store.ts`: the trigger (a
 * native action sheet inside `useCommentLongPress`) and the consumer (the
 * confirm route's body) live in different component trees, and threading a
 * callback through TimelineList → CommentCard → the hook would be three layers
 * of prop drilling for three values.
 *
 * ## Why the issue identifier rides along
 *
 * All three values come from the timeline entry and its surrounding screen, and
 * the confirm route can only recover some of them:
 *
 *  - `commentId` — route param, but also the preview query key.
 *  - `issueId` — the confirm route DOES receive this as a route param (it is in
 *    the path), and it is what the settle invalidation refreshes.
 *  - `issueIdentifier` — NOT recoverable from a comment id. It is what the
 *    confirm surface names as the parent ("created under MYS-2137"), and the
 *    member needs it to be sure the comment they long-pressed belongs to the
 *    issue they think it does.
 *
 * ## Lifecycle
 *
 * Cleared when the confirm route unmounts, exactly as the reply target is
 * cleared when the issue screen unmounts. A stale target would otherwise let a
 * second visit to the route render a previous comment's context.
 */
import { create } from "zustand";

export interface SourceContextTarget {
  commentId: string;
  /** The issue the comment lives on — the parent the child is created under,
   *  server-side, and the id the settle invalidation refreshes. */
  issueId: string;
  /** Display identifier of that issue ("MYS-2137"), for the parent note. */
  issueIdentifier?: string;
}

interface State {
  target: SourceContextTarget | null;
  setTarget: (target: SourceContextTarget) => void;
  clear: () => void;
}

export const useSourceContextTargetStore = create<State>((set) => ({
  target: null,
  setTarget: (target) => set({ target }),
  clear: () => set({ target: null }),
}));
