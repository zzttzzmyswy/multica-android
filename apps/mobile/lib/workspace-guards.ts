/**
 * Workspace-level management guards + form validation — pure functions so
 * they're unit-testable without a device (the workspace-settings page
 * exercises them on-device, but the role matrix needs a workspace with more
 * than one member tier to show the non-owner gating).
 *
 * Mirrors web workshop-tab (packages/views/settings/components/
 * workspace-tab.tsx:146-147):
 *   - `canManageWorkspace` (owner/admin) gates editing name/description/logo
 *     and the Leave row;
 *   - `isOwner` gates the owner-only Delete row (web only renders it for
 *     `currentMember?.role === "owner"`).
 * The server remains the authoritative gate — these guards only decide
 * whether the UI *shows* the actions (PATCH is admin-gated, DELETE is
 * owner-gated, leave validates sole-owner server-side).
 */
import type { MemberRole } from "@multica/core/types";
import { canManageRole } from "./member-guards";

export interface WorkspaceManagementGuardsInput {
  /** Role of the current user's own membership row (null before the member
   *  list resolves or if their own membership isn't visible). */
  currentRole: MemberRole | null | undefined;
}

export interface WorkspaceManagementGuards {
  /** owner/admin — can edit workspace details and leave. */
  canManage: boolean;
  /** owner only — can delete the workspace. */
  isOwner: boolean;
}

export function workspaceManagementGuards({
  currentRole,
}: WorkspaceManagementGuardsInput): WorkspaceManagementGuards {
  return {
    canManage: canManageRole(currentRole),
    isOwner: currentRole === "owner",
  };
}

/** Name field validation for the workspace-settings edit form. The server
 *  trims the name and returns 400 "name is required" for an empty one, so
 *  the client intercepts before the round-trip (spec: 空值拦截并提示). */
export function workspaceNameValidationError(name: string): string | null {
  return name.trim().length === 0 ? "required" : null;
}