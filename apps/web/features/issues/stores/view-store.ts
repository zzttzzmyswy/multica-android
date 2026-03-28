"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { IssueStatus, IssuePriority } from "@/shared/types";
import { ALL_STATUSES, PRIORITY_ORDER } from "@/features/issues/config";

export type ViewMode = "board" | "list";
export type SortField = "position" | "priority" | "due_date" | "created_at" | "title";
export type SortDirection = "asc" | "desc";

export interface CardProperties {
  priority: boolean;
  description: boolean;
  assignee: boolean;
  dueDate: boolean;
}

export const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: "position", label: "Manual" },
  { value: "priority", label: "Priority" },
  { value: "due_date", label: "Due date" },
  { value: "created_at", label: "Created date" },
  { value: "title", label: "Title" },
];

export const CARD_PROPERTY_OPTIONS: { key: keyof CardProperties; label: string }[] = [
  { key: "priority", label: "Priority" },
  { key: "description", label: "Description" },
  { key: "assignee", label: "Assignee" },
  { key: "dueDate", label: "Due date" },
];

interface IssueViewState {
  viewMode: ViewMode;
  statusFilters: IssueStatus[];
  priorityFilters: IssuePriority[];
  sortBy: SortField;
  sortDirection: SortDirection;
  cardProperties: CardProperties;
  listCollapsedStatuses: IssueStatus[];
  setViewMode: (mode: ViewMode) => void;
  toggleStatusFilter: (status: IssueStatus) => void;
  togglePriorityFilter: (priority: IssuePriority) => void;
  hideStatus: (status: IssueStatus) => void;
  showStatus: (status: IssueStatus) => void;
  clearFilters: () => void;
  setSortBy: (field: SortField) => void;
  setSortDirection: (dir: SortDirection) => void;
  toggleCardProperty: (key: keyof CardProperties) => void;
  toggleListCollapsed: (status: IssueStatus) => void;
}

export const useIssueViewStore = create<IssueViewState>()(
  persist(
    (set) => ({
      viewMode: "board",
      statusFilters: [],
      priorityFilters: [],
      sortBy: "position",
      sortDirection: "asc",
      cardProperties: {
        priority: true,
        description: true,
        assignee: true,
        dueDate: true,
      },
      listCollapsedStatuses: [],

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
      showStatus: (status) =>
        set((state) => {
          if (state.statusFilters.length === 0) return state;
          const next = [...state.statusFilters, status];
          return { statusFilters: next.length >= ALL_STATUSES.length ? [] : next };
        }),
      clearFilters: () => set({ statusFilters: [], priorityFilters: [] }),
      setSortBy: (field) => set({ sortBy: field }),
      setSortDirection: (dir) => set({ sortDirection: dir }),
      toggleCardProperty: (key) =>
        set((state) => ({
          cardProperties: {
            ...state.cardProperties,
            [key]: !state.cardProperties[key],
          },
        })),
      toggleListCollapsed: (status) =>
        set((state) => ({
          listCollapsedStatuses: state.listCollapsedStatuses.includes(status)
            ? state.listCollapsedStatuses.filter((s) => s !== status)
            : [...state.listCollapsedStatuses, status],
        })),
    }),
    {
      name: "multica_issues_view",
      partialize: (state) => ({
        viewMode: state.viewMode,
        statusFilters: state.statusFilters,
        priorityFilters: state.priorityFilters,
        sortBy: state.sortBy,
        sortDirection: state.sortDirection,
        cardProperties: state.cardProperties,
        listCollapsedStatuses: state.listCollapsedStatuses,
      }),
    }
  )
);
