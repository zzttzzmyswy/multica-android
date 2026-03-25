import { create } from "zustand";
import type { Issue } from "@multica/types";

interface IssueState {
  issues: Issue[];
  activeIssueId: string | null;
  setIssues: (issues: Issue[]) => void;
  addIssue: (issue: Issue) => void;
  updateIssue: (id: string, updates: Partial<Issue>) => void;
  removeIssue: (id: string) => void;
  setActiveIssue: (id: string | null) => void;
}

export const useIssueStore = create<IssueState>((set) => ({
  issues: [],
  activeIssueId: null,
  setIssues: (issues) => set({ issues }),
  addIssue: (issue) =>
    set((s) => ({
      issues: s.issues.some((i) => i.id === issue.id)
        ? s.issues
        : [...s.issues, issue],
    })),
  updateIssue: (id, updates) =>
    set((s) => ({
      issues: s.issues.map((i) => (i.id === id ? { ...i, ...updates } : i)),
    })),
  removeIssue: (id) =>
    set((s) => ({ issues: s.issues.filter((i) => i.id !== id) })),
  setActiveIssue: (id) => set({ activeIssueId: id }),
}));
