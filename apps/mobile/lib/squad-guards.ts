/**
 * Squad management permission guards, extracted from the squad pages into
 * pure functions so the workspace-admin gate, leader-protection and
 * self-protection rules are unit-testable (the workspace has no second
 * real member to exercise them on-device).
 *
 * Mirrors web squad-detail-page.tsx + server/internal/handler/squad.go:
 *   - `squadManageGuards`: workspaces owner/admin manage every squad; a
 *     regular member manages only squads they created (creator scope).
 *     The server enforces `canManageSquad` the same way (MUL-4223), so
 *     edit/add/remove/archive controls appear exactly when the API accepts
 *     the write.
 *   - `squadMemberActionGuards`: canRemove hides a tap that the server would
 *     reject anyway — the leader of an agent squad can't be removed
 *     ("cannot remove the squad leader; change leader first") and removing
 *     yourself from a squad you manage is a no-op accident. Role edits and
 *     leader promotion are not leader-gated (server allows them).
 *
 * The server remains the authoritative gate — these guards only decide
 * whether the UI *shows* the actions.
 */
import type { MemberRole, SquadMemberType } from "@multica/core/types";

export interface SquadManageGuardsInput {
  /** Role of the current user's own workspace membership row. */
  currentRole: MemberRole | null | undefined;
  /** Current user's User UUID. */
  currentUserId: string | null | undefined;
  /** The squad row (null while loading / not found). */
  squad: { creator_id: string | null } | null;
}

export function squadManageGuards({
  currentRole,
  currentUserId,
  squad,
}: SquadManageGuardsInput): boolean {
  if (!squad) return false;
  const isWorkspaceAdmin = currentRole === "owner" || currentRole === "admin";
  if (isWorkspaceAdmin) return true;
  return (
    currentUserId != null &&
    squad.creator_id != null &&
    squad.creator_id === currentUserId
  );
}

export interface SquadMemberActionGuardsInput {
  /** Whether the current user may manage this squad (squadManageGuards). */
  canManage: boolean;
  /** Current user's User UUID. */
  currentUserId: string | null | undefined;
  /** The squad's leader agent id (null if unknown). */
  leaderId: string | null | undefined;
  /** The target member row (null while loading / not found). */
  target: {
    member_type: SquadMemberType;
    member_id: string | null;
  } | null;
}

export interface SquadMemberActionGuards {
  /** Remove is hidden for the leader and for yourself. */
  canRemove: boolean;
  /** A non-leader agent member can be promoted to leader. */
  canSetLeader: boolean;
  /** Role text is editable for any member (web parity — not leader-gated). */
  canEditRole: boolean;
}

export function squadMemberActionGuards({
  canManage,
  currentUserId,
  leaderId,
  target,
}: SquadMemberActionGuardsInput): SquadMemberActionGuards {
  if (!canManage || !target) {
    return { canRemove: false, canSetLeader: false, canEditRole: false };
  }
  const isLeader =
    target.member_type === "agent" &&
    leaderId != null &&
    target.member_id === leaderId;
  const isSelf =
    target.member_type === "member" &&
    currentUserId != null &&
    target.member_id === currentUserId;
  return {
    canRemove: !isLeader && !isSelf,
    canSetLeader: target.member_type === "agent" && !isLeader,
    canEditRole: true,
  };
}