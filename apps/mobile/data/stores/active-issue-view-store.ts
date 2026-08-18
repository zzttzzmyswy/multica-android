/**
 * Which saved view is open on each surface container, keyed by
 * `${wsId}:${scope_type}[:${scope_id}]`. Client/view state (zustand per the
 * state rules) — mirrors web's
 * `packages/core/issue-views/active-view-store.ts` so the container keys
 * agree across clients. NOT persisted: the active view is a session choice,
 * and resurrecting a deleted view from storage would strand users.
 */
import { create } from "zustand";
import type { IssueViewScope } from "@/data/queries/issue-views";

export function issueViewContainerKey(
  wsId: string,
  scope: IssueViewScope,
): string {
  return scope.scope_id
    ? `${wsId}:${scope.scope_type}:${scope.scope_id}`
    : `${wsId}:${scope.scope_type}`;
}

interface ActiveIssueViewState {
  active: Record<string, string>;
  setActive: (containerKey: string, viewId: string | null) => void;
}

export const useActiveIssueViewStore = create<ActiveIssueViewState>((set) => ({
  active: {},
  setActive: (containerKey, viewId) =>
    set((state) => {
      const active = { ...state.active };
      if (viewId) active[containerKey] = viewId;
      else delete active[containerKey];
      return { active };
    }),
}));