/**
 * The pure decision behind `useWorkspaceAgentAvailability` — "does the current
 * user have an agent they can chat with in this workspace?" — split out of the
 * hook so it is unit-testable in the Node lane (the hook reads two React Query
 * caches and cannot run there).
 *
 * The bug this exists to prevent (MYS-1924, gap 1): the hook resolved from
 * `isFetched`, which React Query defines as
 * `dataUpdateCount + errorUpdateCount > 0` — **a failure counts as fetched**.
 * One timeout therefore left both reads "fetched" with `data: undefined`, the
 * `(agents ?? [])` fold produced zero visible agents, and the chat tab declared
 * 「暂无可用智能体」 over a workspace full of them. On mobile that same value
 * gates the composer, so the request also **disabled the input box** with the
 * reason 「此工作区中没有智能体」 — locking the main feature and advising the user
 * to create an agent they already had. Nothing on that path offered a retry.
 *
 * The fix is the same shape as `resolveCatalogState`: a read that failed is not
 * evidence of absence, so failure gets its own answer and only a *settled* read
 * may say `none`.
 *
 * Resolution order, and why each step sits where it does:
 *
 *   1. A reachable agent wins outright. One is enough to chat, and React Query
 *      keeps the last good `data` when a *background* refetch fails — so both
 *      lists can be in hand while `isError` is true. Downgrading that to
 *      `error` would blank a composer that was working a second ago.
 *   2. `error` → `error`, before `loading`. Deliberate, mirroring
 *      `unsettledCatalogStatus`: a spinner drawn over a request that already
 *      failed hides the failure *and* its retry, so the way out never becomes
 *      reachable.
 *   3. `loading` — nothing has resolved yet. Kept distinct from `none` so the
 *      banner/composer do not flash a fake-empty state on mount.
 *   4. `none` — both reads settled, and there is genuinely no agent to talk to.
 *      Still the only branch allowed to make that claim, and the only one that
 *      may disable the composer.
 */
import type { Agent, Member } from "@multica/core/types";
import { canAssignAgent } from "./can-assign-agent";

export type WorkspaceAgentAvailability =
  | "loading"
  | "error"
  | "none"
  | "available";

export interface WorkspaceAgentAvailabilityInput {
  /** The agent-list read's rows, or `undefined` when it has none yet. */
  agents: readonly Agent[] | undefined;
  /** The member-list read's rows (`canAssignAgent` reads the caller's role to
   *  decide whether a *private* agent is reachable). */
  members: readonly Pick<Member, "user_id" | "role">[] | undefined;
  /** React Query's `isPending` for each read — no data and no error so far. */
  agentsPending: boolean;
  membersPending: boolean;
  /** React Query's `isError` for each read. */
  agentsError: boolean;
  membersError: boolean;
  /** The signed-in user, or `undefined` before auth resolves. */
  userId: string | undefined;
}

export function resolveWorkspaceAgentAvailability({
  agents,
  members,
  agentsPending,
  membersPending,
  agentsError,
  membersError,
  userId,
}: WorkspaceAgentAvailabilityInput): WorkspaceAgentAvailability {
  const memberRole = members?.find((m) => m.user_id === userId)?.role;

  const hasVisibleAgent = (agents ?? []).some(
    (a) => !a.archived_at && canAssignAgent(a, userId, memberRole),
  );
  if (hasVisibleAgent) return "available";

  if (agentsError || membersError) return "error";
  if (agentsPending || membersPending) return "loading";
  return "none";
}
