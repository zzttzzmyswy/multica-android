/**
 * Mobile-only zustand store for the My Issues view (scope + filters + sort
 * + grouping). The filter/sort/grouping slice mirrors the field shape of
 * web's `packages/core/issues/stores/view-store.ts` (itself extended by
 * `my-issues-view-store.ts`) so the same filter input produces the same
 * visible issue set on both clients (the "same N rule" in apps/mobile/
 * CLAUDE.md). Mobile cannot import core's runtime, so this is re-implemented
 * locally via the shared `issue-filter-slice.ts`.
 *
 * Empty filter array = "show all" (matches web's predicate semantics in
 * packages/views/issues/utils/filter.ts).
 *
 * No persist middleware in v1 — matches the existing mobile pattern
 * (auth-store / workspace-store use SecureStore manually for the few values
 * that need restart survival; everything else is in-memory). v2 can add
 * AsyncStorage persistence if cross-restart filter survival is desired.
 */
import { create } from "zustand";
import type { MyIssuesScope } from "@/data/queries/issue-keys";
import {
  createIssueFilterActions,
  defaultIssueFilterSlice,
  hasActiveIssueFilters,
  type IssueFilterSlice,
} from "./issue-filter-slice";

export interface MyIssuesViewState extends IssueFilterSlice {
  scope: MyIssuesScope;
  setScope: (scope: MyIssuesScope) => void;
}

export const useMyIssuesViewStore = create<MyIssuesViewState>((set) => ({
  scope: "assigned",
  ...defaultIssueFilterSlice(),
  setScope: (scope) => set({ scope }),
  ...createIssueFilterActions<MyIssuesViewState>(set),
}));

/** Convenience selector: whether any filter dimension is active. */
export function useMyIssuesViewHasActiveFilters(): boolean {
  return hasActiveIssueFilters(useMyIssuesViewStore.getState());
}
