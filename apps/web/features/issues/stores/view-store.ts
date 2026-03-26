"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { IssueStatus, IssuePriority } from "@multica/types";

export type ViewMode = "board" | "list";

interface IssueViewState {
  viewMode: ViewMode;
  statusFilters: IssueStatus[];
  priorityFilters: IssuePriority[];
  setViewMode: (mode: ViewMode) => void;
  toggleStatusFilter: (status: IssueStatus) => void;
  togglePriorityFilter: (priority: IssuePriority) => void;
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
        set((state) => ({
          statusFilters: state.statusFilters.includes(status)
            ? state.statusFilters.filter((s) => s !== status)
            : [...state.statusFilters, status],
        })),
      togglePriorityFilter: (priority) =>
        set((state) => ({
          priorityFilters: state.priorityFilters.includes(priority)
            ? state.priorityFilters.filter((p) => p !== priority)
            : [...state.priorityFilters, priority],
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
