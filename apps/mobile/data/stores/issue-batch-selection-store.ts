/**
 * Mobile-only zustand store for multi-select of issues (batch actions).
 * Mirrors web's `useIssueSurfaceSelection` shape
 * (packages/views/issues/surface/selection-context.tsx) — the same
 * selectedIds / clear / toggle surface that rows and the BatchActionToolbar
 * consume. Mobile cannot import core's runtime, so this is re-implemented
 * locally. Unlike web's always-available selection, mobile is touch-first:
 * `toggle` from idle enters selection mode, and deselecting the last row
 * auto-exits so no empty multi-select UI lingers.
 */
import { create } from "zustand";

interface IssueBatchSelectionState {
  /** True while the list is in multi-select mode. */
  selectionMode: boolean;
  selectedIds: Set<string>;
  /** Enter selection mode; pass an id to pre-select it (long-press row). */
  enterSelection: (id?: string) => void;
  /** Leave selection mode and empty the selection. */
  exitSelection: () => void;
  /** Toggle one row's membership; auto-enters/exits like a checkbox row. */
  toggle: (id: string) => void;
  /** Replace the whole selection (select-all / restore). */
  setSelected: (ids: string[]) => void;
  /** Empty the selection but stay in selection mode (after a batch op). */
  clear: () => void;
}

export const useIssueBatchSelectionStore =
  create<IssueBatchSelectionState>((set) => ({
    selectionMode: false,
    selectedIds: new Set(),
    enterSelection: (id) =>
      set((state) => ({
        selectionMode: true,
        selectedIds:
          id !== undefined
            ? new Set(state.selectedIds).add(id)
            : state.selectedIds,
      })),
    exitSelection: () =>
      set({ selectionMode: false, selectedIds: new Set() }),
    toggle: (id) =>
      set((state) => {
        if (!state.selectedIds.has(id)) {
          const next = new Set(state.selectedIds).add(id);
          return { selectionMode: true, selectedIds: next };
        }
        const next = new Set(state.selectedIds);
        next.delete(id);
        if (next.size === 0) {
          return { selectionMode: false, selectedIds: new Set() };
        }
        return { selectedIds: next };
      }),
    setSelected: (ids) => set({ selectedIds: new Set(ids) }),
    clear: () => set({ selectedIds: new Set() }),
  }));