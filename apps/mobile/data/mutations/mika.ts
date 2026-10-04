/**
 * Mika bootstrap — create/reuse the workspace's Mika and write its opening
 * turn. Mirrors `packages/core/onboarding/use-bootstrap-mika.ts`.
 *
 * Every step is idempotent server-side, so a retry, a double-submit, or two
 * clients racing the same workspace converge on one agent, one session, and
 * one opening turn — the agent and session under their own advisory locks, the
 * opening turn under the session lock. Nothing about Mika's configuration is
 * decided here; the server owns it.
 *
 * The workspace slug is passed explicitly rather than read from the global
 * current-workspace singleton: the singleton is what the tab stack writes on
 * navigation, and web's version of this flow was bitten by exactly that (it
 * reclaimed the slug mid-flow and created Mika in the previously-active
 * workspace). Mobile has the same global, so it takes the same precaution.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ChatSession, MikaBootstrapResponse } from "@multica/core/types";
import type { MikaOnboardingLanguage } from "@multica/core/onboarding";
import { api } from "@/data/api";
import { agentKeys } from "@/data/queries/agents";
import { chatKeys } from "@/data/queries/chat";

export interface BootstrapMikaInput {
  workspaceSlug: string;
  runtimeId: string;
  /** Empty means "whatever the runtime defaults to". */
  model?: string;
  /** Localized title for the opening conversation. */
  title: string;
  language: MikaOnboardingLanguage;
}

export interface BootstrapMikaResult {
  agent: MikaBootstrapResponse;
  chatSession: ChatSession;
}

export async function bootstrapMika(
  input: BootstrapMikaInput,
): Promise<BootstrapMikaResult> {
  const agent = await api.createMikaAgent(
    {
      runtime_id: input.runtimeId,
      language: input.language,
      model: input.model,
      session_title: input.title,
    },
    input.workspaceSlug,
  );

  // The server resolves agent and session together, so a response without one
  // means the call did not complete — retry rather than opening a session
  // client-side (which is how web ended up with two onboarding conversations).
  const chatSession = agent.onboarding_session;
  if (!chatSession) {
    throw new Error("Mika onboarding session was not returned");
  }

  await api.startMikaOnboarding(
    chatSession.id,
    { language: input.language },
    input.workspaceSlug,
  );

  return { agent, chatSession };
}

export function useBootstrapMika(workspaceId: string | null) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: BootstrapMikaInput) => bootstrapMika(input),
    onSuccess: ({ chatSession }) => {
      // The opening is written by the server and already persisted by the time
      // this resolves, so there is nothing in flight for the chat view to
      // await — invalidating the message list is what makes it appear. Both
      // agent lists matter: the runtimes page reads the archived-free one,
      // and a WS `agent:created` may not have landed yet on a cold cache.
      return Promise.all([
        qc.invalidateQueries({ queryKey: agentKeys.list(workspaceId) }),
        qc.invalidateQueries({ queryKey: agentKeys.listAll(workspaceId) }),
        qc.invalidateQueries({ queryKey: chatKeys.sessions(workspaceId) }),
        qc.invalidateQueries({ queryKey: chatKeys.messages(chatSession.id) }),
        qc.invalidateQueries({ queryKey: chatKeys.messagesPage(chatSession.id) }),
      ]);
    },
  });
}
