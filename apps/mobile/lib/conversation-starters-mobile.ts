/**
 * Mobile-side bindings for the conversation-starters surface (MUL-6629).
 *
 * The RULES themselves live in `@multica/core/agents/conversation-starters.ts`
 * and are imported, never re-implemented: the settings preview, the chat empty
 * state and the wire builders must all agree on which rows count, and a second
 * copy here is precisely how they would drift. What is genuinely mobile-local
 * is the shape of the inputs — this app has no per-surface i18n namespace, so
 * the three fallback suggestions come from the flat mobile bundle, and the
 * "may this viewer edit" question is answered from the workspace role and agent
 * ownership the app already holds rather than web's permission-hook result.
 *
 * Kept in `lib/` so the Node vitest lane covers it (vitest.config.ts includes
 * `lib/**` and `data/**` only).
 */
import type { AgentConversationStarter } from "@multica/core/types";

/**
 * The `?focus=` value that lands the agent edit form on its starters block.
 *
 * One constant rather than a literal on each side: the chat empty state writes
 * it into the route params and the edit page reads it back, so two hand-typed
 * copies would fail as a silently dead link — the page opens, just at the top,
 * and nothing errors.
 */
export const FOCUS_CONVERSATION_STARTERS = "conversation_starters";

/**
 * The three generic suggestions a new chat shows for an agent whose author
 * configured none. The ONLY definition of them: the chat empty state and the
 * agent editor's preview both read this, so an author sees exactly what a real
 * new chat will show rather than a hand-maintained copy of it.
 *
 * `t` is a parameter rather than an import so the vitest lane can call this
 * with a stub translator.
 */
export function fallbackConversationStarters(
  t: (key: string) => string,
): AgentConversationStarter[] {
  return [
    {
      label: t("chat.starters.capabilities.label"),
      prompt: t("chat.starters.capabilities.prompt"),
    },
    {
      label: t("chat.starters.firstTask.label"),
      prompt: t("chat.starters.firstTask.prompt"),
    },
    {
      label: t("chat.starters.recommend.label"),
      prompt: t("chat.starters.recommend.prompt"),
    },
  ];
}

/**
 * Whether this viewer may edit the given agent, per web's `canEditAgent`
 * (`packages/core/permissions/rules.ts`): a workspace owner/admin, or the
 * agent's own owner.
 *
 * Mirrored rather than imported because mobile holds the role and the user id
 * in its own stores. The backend remains the authoritative gate — this only
 * decides whether an affordance is offered, and it fails closed for an
 * unresolved viewer (`currentUserId === null`), matching web's
 * `not_authenticated` denial.
 */
export function canEditAgentOnMobile({
  agent,
  currentUserId,
  currentRole,
}: {
  agent: { owner_id: string | null } | null;
  /** The signed-in user's id, or null/undefined before auth resolves. Both
   *  count as "no viewer" — an unresolved session must not read as an owner. */
  currentUserId: string | null | undefined;
  currentRole: string | null | undefined;
}): boolean {
  if (agent === null || !currentUserId) return false;
  if (currentRole === "owner" || currentRole === "admin") return true;
  return agent.owner_id !== null && agent.owner_id === currentUserId;
}
