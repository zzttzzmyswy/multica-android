/**
 * Draft state for the New Project modal (`app/(app)/[workspace]/project/new.tsx`).
 *
 * Mirrors `new-issue-draft-store.ts` — same rationale: the formSheet picker
 * routes (`new-project-picker/status.tsx`, `new-project-picker/priority.tsx`)
 * live in a separate Stack screen and have no React parent-child relationship
 * with the new-project modal. They need a way to read the current draft value
 * and write the new selection back without prop-drilling through the router.
 * A small Zustand store is the minimum-viable cross-screen channel — and the
 * same pattern as new-issue.
 *
 * Lifecycle: `reset()` runs from `project/new.tsx` when the user dismisses
 * the modal (either submit succeeds or they cancel) so the next open starts
 * clean. Title / description / icon stay local useState because they're
 * controlled inputs that never leave the new-project screen; only the
 * attribute-chip values cross routes.
 *
 * Workspace lifecycle: workspace-scoped — reset is wired in
 * `app/(app)/[workspace]/_layout.tsx` via
 * `useNewProjectDraftResetOnWorkspaceChange()`, the only caller.
 */
import { useEffect, useRef } from "react";
import { create } from "zustand";
import type { ProjectPriority, ProjectStatus } from "@multica/core/types";

/**
 * Lead as a PAIR, never a bare id: the server distinguishes a member lead from
 * an agent lead by `lead_type`, so writing `lead_id` alone leaves it unable to
 * resolve the actor. Web's create dialog keeps the same pair
 * (`create-project.tsx` `leadType` + `leadId`, written by one `updateLead`), and
 * "no lead" is BOTH fields null — not an omitted id.
 */
export interface ProjectLeadValue {
  /** Mirrors `Project["lead_type"]`'s non-null members. */
  type: "member" | "agent";
  id: string;
}

interface NewProjectDraftState {
  status: ProjectStatus;
  priority: ProjectPriority;
  /** null = no lead chosen yet (web's `no_lead`). */
  lead: ProjectLeadValue | null;
  /** Calendar day "YYYY-MM-DD", or null when unset — web's start date pill. */
  startDate: string | null;
  /** Calendar day "YYYY-MM-DD", or null when unset. */
  dueDate: string | null;
  setStatus: (next: ProjectStatus) => void;
  setPriority: (next: ProjectPriority) => void;
  setLead: (next: ProjectLeadValue | null) => void;
  setStartDate: (next: string | null) => void;
  setDueDate: (next: string | null) => void;
  reset: () => void;
}

const INITIAL: Pick<
  NewProjectDraftState,
  "status" | "priority" | "lead" | "startDate" | "dueDate"
> = {
  status: "planned",
  priority: "none",
  lead: null,
  startDate: null,
  dueDate: null,
};

export const useNewProjectDraftStore = create<NewProjectDraftState>((set) => ({
  ...INITIAL,
  setStatus: (next) => set({ status: next }),
  setPriority: (next) => set({ priority: next }),
  setLead: (next) => set({ lead: next }),
  setStartDate: (next) => set({ startDate: next }),
  setDueDate: (next) => set({ dueDate: next }),
  reset: () => set({ ...INITIAL }),
}));

/**
 * Clears the new-project draft store whenever the active workspace id
 * changes. The previous draft is invalid in a different workspace (we may
 * later add fields like `lead` whose id only resolves in the seeded
 * workspace). The `useRef` gate ensures the first mount is a no-op — we
 * only fire `reset()` when the id actually changes, not on the initial
 * render where `prev === current`.
 */
export function useNewProjectDraftResetOnWorkspaceChange(wsId: string | null) {
  const prevRef = useRef(wsId);
  useEffect(() => {
    if (prevRef.current !== wsId) {
      useNewProjectDraftStore.getState().reset();
      prevRef.current = wsId;
    }
  }, [wsId]);
}
