/**
 * "This agent is not in the list" — a permission answer or a missing one?
 *
 * The agent detail route resolves its row out of the workspace agent list
 * (`agentListAllOptions`). That list is filtered server-side by
 * `memberAllowedToViewAgent` (server/internal/handler/agent.go:921-931), which
 * drops every private agent whose `allowed_principals` do not include the
 * caller. So "not in the list" has two entirely different causes that the list
 * cannot tell apart, and the page used to answer both with one sentence:
 * 「该智能体不存在或已被删除」.
 *
 * For a private agent the user merely lacks access to, that sentence is a false
 * statement of fact — the agent exists, is running, and its owner can see it.
 * Web renders 「你没有访问该智能体的权限」 for the same URL and the same state
 * (packages/views/agents/components/agent-detail-page.tsx:199-236), off a probe
 * of `GET /api/agents/{id}`: 403 → no-access, anything else → not-found. The
 * server's handler comment names that probe as the contract
 * (handler/agent.go:964-968).
 *
 * Named `agent-detail-access`, not `agent-access`: the latter is already taken
 * by the effective-access-scope helper (`lib/agent-detail-access.ts`, MUL-3963), which
 * answers a different question (which scope an agent's permission fields
 * resolve to) for the list and the access picker. This file is about whether the
 * DETAIL page may render at all.
 *
 * Why the probe is GATED rather than unconditional: the common path — the agent
 * IS in the list, which is how the row is reached from the agents screen — must
 * make zero extra requests. `shouldProbeAgentAccess` is that gate, and it is a
 * pure function so the three conditions can each be falsified in the Node vitest
 * lane (see `agent-detail-access.test.ts`), where there is no RN renderer to
 * exercise the hook's `enabled` through.
 *
 * Kept free of `react-native`, `@tanstack/*` and `@/data/api` so it loads in
 * that lane. The 403 test duck-types `status` for the same reason
 * `isPermissionError` does in `lib/write-failure.ts` — an `instanceof ApiError`
 * check here would drag the whole native fetch chain into every test that
 * imports this file.
 */

/** Status the server answers when the caller may not see a private agent
 *  (`handler/agent.go:971` → `canAccessPrivateAgent` false). Named so the
 *  number appears once — a typo'd 401/404 in the comparison would silently
 *  collapse the two faces again, which is the defect this file exists for. */
export const AGENT_ACCESS_DENIED_STATUS = 403;

/**
 * Whether an agent-detail probe failure means "you may not see this agent".
 *
 * Exactly 403 and nothing else. A 404 is a genuinely missing agent; status 0 is
 * the api client's "the request never reached a server" (offline, DNS, TLS,
 * timeout — see `ApiClient.fetch`) and must NOT be reported as a permission
 * problem: an unreachable server is not a refusal, and telling the user they
 * lack access would send them to ask for a grant they already have.
 */
export function isAgentAccessDenied(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { status?: unknown }).status === AGENT_ACCESS_DENIED_STATUS
  );
}

/**
 * Whether the detail route should probe `GET /api/agents/{id}` at all.
 *
 * All three conditions are load-bearing:
 *
 *   - `listSettled` — while the list read is still in flight, its rows are
 *     incomplete by definition, so an absent agent is not yet evidence of
 *     anything. Probing here would fire a second request on EVERY detail open.
 *   - `agentFound` — the common path. The row is normally IN the list (that is
 *     how the user reached this screen); when it is, the page has everything it
 *     needs and an extra request is pure cost. This is also what keeps a pull-
 *     to-refresh or a background refetch from re-probing.
 *   - `agentId` — no id means no probe target (a route mounting before params
 *     resolve).
 */
export function shouldProbeAgentAccess({
  listSettled,
  agentFound,
  agentId,
}: {
  listSettled: boolean;
  agentFound: boolean;
  agentId: string | undefined | null;
}): boolean {
  return listSettled && !agentFound && !!agentId;
}
