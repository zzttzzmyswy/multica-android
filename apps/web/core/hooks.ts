"use client";

import { useWorkspaceStore } from "@/features/workspace";

/**
 * Returns the current workspace ID.
 *
 * Bridge hook: reads from Zustand workspace store now.
 * Phase 3 will switch to core/workspace/store.ts — signature stays the same.
 */
export function useWorkspaceId(): string {
  const workspaceId = useWorkspaceStore((s) => s.workspace?.id);
  if (!workspaceId) {
    throw new Error("useWorkspaceId: no workspace selected");
  }
  return workspaceId;
}
