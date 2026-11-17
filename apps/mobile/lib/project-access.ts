/**
 * Private projects (MUL-8472) — the permission and visibility rules, mirrored
 * from the deployed web + server (tag `v0.9.0-myswy.2`).
 *
 * ## Why this is a module rather than inline conditions
 *
 * "Who may see this project" and "who may change who sees it" are two
 * different questions with two different answers, and web gets both wrong if
 * they are written as one boolean. Sources, in order of authority:
 *
 *   - `server/internal/handler/project_member.go:canManageProjectAccess` — the
 *     server's own rule; every write below is enforced there and answers 403.
 *   - `server/internal/handler/project_member.go:prepareProjectAccessUpdate` —
 *     the lead rule, which DEGENERATES on a private project.
 *   - `packages/core/projects/access.ts` — web's mirror of the same two.
 *
 * Mobile must not re-derive these from feel: a divergence shows the user a
 * control whose only possible outcome is a 403, or hides one that would have
 * worked (`apps/mobile/CLAUDE.md` § Behavioral parity → Permissions / access).
 *
 * ## The two rules, and the trap between them
 *
 * `canManageProjectAccess` — workspace owner/admin, or the MEMBER lead of a
 * PRIVATE project. Leading a workspace-visible project grants nothing, because
 * anyone may set that lead, so it would otherwise become a back door to access
 * management.
 *
 * `canChangeProjectLead` — on a workspace-visible project the lead is an
 * ordinary field anyone may change (pre-existing, correct behaviour; do not
 * narrow it). On a private project the lead manages access, so changing it IS
 * an access change and takes an access manager.
 *
 * Writing those as one predicate gives "a plain member of a private project can
 * hand the lead to themselves"; the server refuses it.
 *
 * ## `visibility` absent is NOT private
 *
 * `ProjectSchema` defaults the field to `"workspace"` so an older server's
 * response still parses. Reading a missing field as private would paint a lock
 * on every project the moment a response shape changed — so the "is it private"
 * question is answered by the literal alone, and nothing else.
 */
import type { Project, ProjectVisibility } from "@multica/core/types";

/** The fields the access rules read. Kept narrow so a partial project (list
 *  row, draft) can be tested without inventing a whole `Project`. */
export type ProjectAccessSubject = Pick<
  Project,
  "lead_type" | "lead_id"
> & {
  visibility?: ProjectVisibility;
};

/** `private` only when the server said so; everything else is `workspace`.
 *
 * An unknown future enum member folds to `workspace`: a client that cannot
 * enforce an unknown visibility must not claim the stricter one. */
export function resolveProjectVisibility(
  project: { visibility?: ProjectVisibility },
): ProjectVisibility {
  return project.visibility === "private" ? "private" : "workspace";
}

export function projectVisibilityIsPrivate(project: {
  visibility?: ProjectVisibility;
}): boolean {
  return resolveProjectVisibility(project) === "private";
}

/**
 * Workspace owner/admin, or the member lead of a private project.
 *
 * A `null` role is "not an admin" — NOT "unknown, allow": the lead branch still
 * decides from the project row, so a lead keeps the affordance while the roster
 * is loading, and a plain member gains nothing.
 */
export function canManageProjectAccess(
  project: ProjectAccessSubject,
  userId: string | null | undefined,
  role: string | null | undefined,
): boolean {
  if (!userId) return false;
  if (role === "owner" || role === "admin") return true;
  return (
    projectVisibilityIsPrivate(project) &&
    project.lead_type === "member" &&
    project.lead_id === userId
  );
}

/**
 * The lead of a private project manages its access, so only access managers may
 * change it there; on a workspace-visible project it stays an ordinary field.
 */
export function canChangeProjectLead(
  project: ProjectAccessSubject,
  userId: string | null | undefined,
  role: string | null | undefined,
): boolean {
  return (
    !projectVisibilityIsPrivate(project) ||
    canManageProjectAccess(project, userId, role)
  );
}

/**
 * Whether the remove control may be offered for `targetId`.
 *
 * Two ids are FIXED and must never be removable:
 *
 *   - the project lead — the server answers `409 change the project lead before
 *     removing the current lead`;
 *   - yourself — removing your own row from a private project locks you out of
 *     it immediately, with no UI path back in.
 *
 * Web's `canRemove` encodes the first (`id !== leadId`, and `fixed` in the draft
 * picker); the self case is unreachable there because web only ever adds the
 * caller implicitly. Mobile lists the caller explicitly (they are a member), so
 * the guard has to be stated.
 */
export function canRemoveProjectMember({
  targetId,
  currentUserId,
  leadId,
  canManage,
}: {
  targetId: string;
  currentUserId?: string | null;
  leadId?: string | null;
  canManage: boolean;
}): boolean {
  if (!canManage) return false;
  if (leadId && targetId === leadId) return false;
  if (currentUserId && targetId === currentUserId) return false;
  return true;
}

/**
 * The member ids the access form starts from.
 *
 * Two sources, and they are not interchangeable:
 *
 *   - the project IS already private → the server's member rows are the truth;
 *     a local draft would show a list that no longer matches who can see it.
 *   - the project is still workspace-visible → there is no server-side member
 *     list to read (the rows only exist once it is private), so the form seeds
 *     itself with the caller and the member lead. This is what the generated
 *     `member_ids` sends, and the server appends the same two on its side, so
 *     the two agree instead of the client silently excluding its own author.
 *
 * Mirrors `project-access.tsx:147` and `prepareProjectAccessUpdate`.
 */
export function projectAccessSelection({
  currentVisibility,
  currentMemberIds,
  currentUserId,
  leadId,
  draftIds,
}: {
  currentVisibility: ProjectVisibility;
  currentMemberIds: string[];
  currentUserId?: string | null;
  leadId?: string | null;
  /** Local edits made while the project is still public; `null` = untouched. */
  draftIds: string[] | null;
}): string[] {
  if (currentVisibility === "private") return currentMemberIds;
  if (draftIds) return draftIds;
  return Array.from(
    new Set([
      ...currentMemberIds,
      ...(currentUserId ? [currentUserId] : []),
      ...(leadId ? [leadId] : []),
    ]),
  );
}

/**
 * Whether saving this visibility change needs a second confirmation.
 *
 * ONLY the widening direction does. Making a project private is reversible and
 * removes access; publishing it hands every issue, comment and attachment to
 * the whole workspace, and having been visible cannot be taken back. That
 * asymmetry is why the confirmation is not simply "on any change".
 */
export function visibilityRequiresPublishConfirm(
  from: ProjectVisibility,
  to: ProjectVisibility,
): boolean {
  return from === "private" && to === "workspace";
}
