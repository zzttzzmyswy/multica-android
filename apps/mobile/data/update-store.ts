/**
 * Update availability store — an in-memory note that there is a newer APK on
 * GitHub than the one installed. Written by the silent startup probe
 * (`lib/use-latest-release.ts`) and read by the More-popover About row to
 * render a "new version" dot without re-fetching. Deliberately tiny: no
 * persistence, no timestamps — the fetch query owns freshness.
 */
import { create } from "zustand";

interface UpdateState {
  hasUpdate: boolean;
  setHasUpdate: (hasUpdate: boolean) => void;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  hasUpdate: false,
  setHasUpdate: (hasUpdate) => set({ hasUpdate }),
}));