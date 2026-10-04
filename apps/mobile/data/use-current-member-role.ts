/**
 * The signed-in user's role in the current workspace.
 *
 * Four surfaces derive this the same way (`more/members.tsx`,
 * `more/settings/issue-statuses.tsx`, `lib/agent-list-access.ts`'s callers, and
 * now comment moderation). The derivation is one `find`, but the rules around
 * it are not obvious from the line, so they are written down once here:
 *
 *   - **An unresolved member list reads as "not a manager".** The list is
 *     fetched per workspace; until it lands there is no role, and `canManageRole`
 *     is false for null. That fails closed, which is the only safe direction for
 *     a permission check — the server re-checks every write anyway
 *     (server/internal/handler/comment.go:507-512).
 *   - **Role is workspace-scoped.** It comes from this workspace's member row,
 *     not from a global user record, so a workspace switch must re-derive it.
 *     Querying through `memberListOptions(wsId)` gets that for free.
 *
 * Web computes the same value in `issue-detail.tsx:1093-1094` for comment
 * moderation specifically; this hook is the mobile equivalent, shared rather
 * than re-derived per surface.
 */
import { useQuery } from "@tanstack/react-query";
import type { MemberRole } from "@multica/core/types";
import { memberListOptions } from "@/data/queries/members";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";

export function useCurrentMemberRole(): {
  role: MemberRole | null;
  /** True once the member list has resolved — callers that need to distinguish
   *  "not a manager" from "don't know yet" read this. A permission check
   *  itself should never need it: both states are non-managers. */
  isResolved: boolean;
} {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const userId = useAuthStore((s) => s.user?.id);
  const { data: members, isSuccess } = useQuery(memberListOptions(wsId));

  return {
    role: (members ?? []).find((m) => m.user_id === userId)?.role ?? null,
    isResolved: isSuccess,
  };
}
