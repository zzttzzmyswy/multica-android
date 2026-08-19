/**
 * Active saved-issue-view per surface container (iteration-65). A container
 * is the (wsId, scope_type, scope_id) pair — the workspace Issues page uses
 * one container, My Issues another, so each keeps its own open view without
 * cross-talk. Mirrors web's `active-view-store` (an id per container key,
 * `issueViewContainerKey`), but in-memory only: mobile's view state is
 * session-scoped (no persist middleware), and a stale id surviving a restart
 * would read as "view deleted" against an empty list.
 */
import { create } from "zustand";
import type { IssueViewScope } from "@/data/queries/issue-views";

export function issueViewContainerKey(
  wsId: string | null,
  scope: IssueViewScope,
): string {
  return `${wsId ?? ""}:${scope.scope_type}:${scope.scope_id ?? "null"}`;
}

interface ActiveIssueViewState {
  /** container key → open saved-view id (null = default tab). */
  active: Record<string, string | null>;
  setActive: (containerKey: string, viewId: string | null) => void;
}

export const useActiveIssueViewStore = create<ActiveIssueViewState>((set) => ({
  active: {},
  setActive: (containerKey, viewId) =>
    set((state) => {
      if (state.active[containerKey] === viewId) return state;
      return { active: { ...state.active, [containerKey]: viewId } };
    }),
}));

/** Convenience: open saved-view id for one container (avoid a selector if a
 *  plain read is enough). */
export function activeIssueViewId(containerKey: string): string | null {
  return useActiveIssueViewStore.getState().active[containerKey] ?? null;
}