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
import type {
  MemberRole,
  SquadMemberStatusValue,
  SquadMemberType,
} from "@multica/core/types";

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
  targetArchived,
  targetStatus,
}: SquadMemberActionGuardsInput & {
  /**
   * The target agent has been archived in the workspace.
   *
   * Web hides "make leader" for an archived member
   * (`squad-detail-page.tsx:1254` — `canManage && m.member_type === "agent" &&
   * !isLeader(m) && !isArchived(m)`) and keeps REMOVE available
   * (`:1272` — `canManage && !isLeader(m)`, no archived clause). That
   * asymmetry is the point: promoting an archived agent to leader would leave
   * the squad headed by something that cannot run, while removing it is the
   * fix — and hiding remove would strand the archived row in the roster.
   *
   * Omitted means "not archived", so a caller that has not read the agent
   * directory keeps today's behaviour instead of silently losing the action.
   */
  targetArchived?: boolean;
  /**
   * The SERVER's own judgement for this member (`SquadMemberStatus.status`).
   *
   * This exists because the two sources disagree in exactly the case that
   * matters. `agentListOptions` excludes archived agents by design (a retired
   * agent must not be selectable), so a squad whose member has been archived
   * has NO row for it in that directory — a guard fed only by the directory
   * reads `targetArchived: false` and offers "make leader" on an archived
   * agent. That is the defect on-device verification caught in iteration 261
   * after the first fix landed.
   *
   * The squad status endpoint reports `archived` as a first-class value
   * (`packages/core/types/squad.ts:90-98` — "`archived` wins over every
   * runtime/task signal"), and the roster already renders 「已归档」 from it.
   * Folding it in here means the guard and the pill cannot disagree.
   */
  targetStatus?: SquadMemberStatusValue | null;
}): SquadMemberActionGuards {
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
  // Either source saying "archived" is enough, and a `null` status (never read)
  // contributes nothing — the roster shows 「已归档」 off this same value, so a
  // guard that ignored it would offer an action the pill contradicts.
  const archived = targetArchived === true || targetStatus === "archived";
  return {
    canRemove: !isLeader && !isSelf,
    canSetLeader: target.member_type === "agent" && !isLeader && !archived,
    canEditRole: true,
  };
}

/**
 * The candidates the add-member picker may offer: not archived, not already in
 * the squad.
 *
 * Web derives both halves independently and this is that derivation
 * (`squad-detail-page.tsx:189-190`):
 *
 *   availableAgents = agents.filter(a => !a.archived_at && !members.some(…))
 *   availableMembers = wsMembers.filter(m => !members.some(…))
 *
 * Mobile got the "already a member" half (an `excluded` set) but applied the
 * archived filter inside the picker component against the agent list only.
 * Pulling the whole rule here makes it (a) testable without a renderer and
 * (b) impossible to forget on a second call site — a new caller that passes
 * raw directories gets the same filtering web does.
 *
 * Members are NOT archived-filtered: a workspace member has no `archived_at`
 * in either client. That asymmetry is web's, not an omission.
 */
export function availableSquadCandidates<
  A extends { id: string; archived_at?: string | null },
  M extends { user_id: string },
>({
  agents,
  members,
  current,
}: {
  agents: readonly A[];
  members: readonly M[];
  /** Rows already in the squad — `${member_type}:${member_id}` keys. */
  current: ReadonlySet<string>;
}): { agents: A[]; members: M[] } {
  return {
    agents: agents.filter(
      (a) => !a.archived_at && !current.has(`agent:${a.id}`),
    ),
    members: members.filter((m) => !current.has(`member:${m.user_id}`)),
  };
}

/**
 * The `role` field of an add-member write: trimmed, and omitted entirely when
 * blank.
 *
 * Web's add dialog sends `role` as a plain string and lets an empty one
 * through (`squad-detail-page.tsx:531` → `onSubmit({ type, id, role })`), which
 * writes `""` — indistinguishable on read from a role nobody set, and it makes
 * a "role filled in?" check impossible for every later client. The request
 * type already treats the field as optional (`AddSquadMemberRequest.role?`), so
 * omitting it is the shape the API was designed for.
 */
export function squadMemberRoleField(
  role: string | null | undefined,
): { role?: string } {
  const trimmed = (role ?? "").trim();
  return trimmed.length > 0 ? { role: trimmed } : {};
}