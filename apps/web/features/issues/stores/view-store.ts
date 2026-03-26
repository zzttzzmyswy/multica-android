"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { IssueStatus, IssuePriority } from "@/shared/types";
import { ALL_STATUSES, PRIORITY_ORDER } from "@/features/issues/config";

export type ViewMode = "board" | "list";

interface IssueViewState {
  viewMode: ViewMode;
  statusFilters: IssueStatus[];
  priorityFilters: IssuePriority[];
  setViewMode: (mode: ViewMode) => void;
  toggleStatusFilter: (status: IssueStatus) => void;
  togglePriorityFilter: (priority: IssuePriority) => void;
  hideStatus: (status: IssueStatus) => void;
  clearFilters: () => void;
}

export const useIssueViewStore = create<IssueViewState>()(
  persist(
    (set) => ({
      viewMode: "board",
      statusFilters: [],
      priorityFilters: [],

      setViewMode: (mode) => set({ viewMode: mode }),
      toggleStatusFilter: (status) =>
        set((state) => {
          if (state.statusFilters.length === 0) {
            return { statusFilters: ALL_STATUSES.filter((s) => s !== status) };
          }
          const next = state.statusFilters.includes(status)
            ? state.statusFilters.filter((s) => s !== status)
            : [...state.statusFilters, status];
          return { statusFilters: next.length >= ALL_STATUSES.length ? [] : next };
        }),
      togglePriorityFilter: (priority) =>
        set((state) => {
          if (state.priorityFilters.length === 0) {
            return { priorityFilters: PRIORITY_ORDER.filter((p) => p !== priority) };
          }
          const next = state.priorityFilters.includes(priority)
            ? state.priorityFilters.filter((p) => p !== priority)
            : [...state.priorityFilters, priority];
          return { priorityFilters: next.length >= PRIORITY_ORDER.length ? [] : next };
        }),
      hideStatus: (status) =>
        set((state) => ({
          statusFilters: state.statusFilters.length === 0
            ? ALL_STATUSES.filter((s) => s !== status)
            : state.statusFilters.filter((s) => s !== status),
        })),
      clearFilters: () => set({ statusFilters: [], priorityFilters: [] }),
    }),
    {
      name: "multica_issues_view",
      partialize: (state) => ({
        viewMode: state.viewMode,
        statusFilters: state.statusFilters,
        priorityFilters: state.priorityFilters,
      }),
    }
  )
);
