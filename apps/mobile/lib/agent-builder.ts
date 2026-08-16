/**
 * Pure helpers for the AI-builder agent-create flow (more/agents/new/ai →
 * more/agents/builder/[sessionId]). Free of React/RN so the encode-context
 * assembly, draft merge and create-request build are unit-testable.
 *
 * The wire protocol lives in core (packages/core/agents/builder-protocol.ts)
 * and is reused verbatim — this module only (a) assembles the mobile encode
 * context and (b) degrades what mobile v1 does not discover (the runtime's
 * live model catalog) to the core "null = discovery not available" contract,
 * mirroring how the manual form accepts a typed model value.
 */
import {
  buildCreateAgentRequest,
  decodeBuilderInput,
  encodeBuilderInput,
  mergeBuilderDraft,
  parseBuilderDraft,
  stripBuilderDraft,
  type AgentDraft,
  type BuilderDraftPayload,
} from "@multica/core/agents";
import type {
  AgentBuilderSessionSummary,
  CreateAgentRequest,
  RuntimeDevice,
  RuntimeModel,
} from "@multica/core/types";

export { decodeBuilderInput, stripBuilderDraft, parseBuilderDraft };
export type { BuilderDraftPayload };

/** Everything the encoder needs to re-state the decision context each turn. */
export interface BuilderEncodeContext {
  draft: AgentDraft;
  /** Workspace skills the builder may pick ids from. */
  skills: { id: string; name: string; description: string }[];
  /** Workspace members the builder may grant allowlist access to. */
  members: { user_id: string; name: string }[];
  /** The runtime this conversation executes on, or null before one is known. */
  runtime: Pick<RuntimeDevice, "id" | "name" | "provider"> | null;
  /** Live runtime model catalog. Mobile v1 does not run discovery, so the
   *  builder is told the catalog is unavailable (null) and may only preserve
   *  the user's current model value, never invent one. */
  models?: RuntimeModel[] | null;
}

export function encodeBuilderTurn(
  text: string,
  context: BuilderEncodeContext,
): string {
  return encodeBuilderInput(
    text,
    context.draft,
    context.skills,
    context.members,
    context.runtime,
    context.models ?? null,
  );
}

/** Message content as the human reads it: the user side is a JSON envelope,
 *  the assistant side ends in a stripped `<agent_draft>` block. */
export function builderDisplayContent(
  role: string,
  content: string,
): string {
  return role === "user"
    ? decodeBuilderInput(content)
    : stripBuilderDraft(content);
}

/** Merges an assistant `<agent_draft>` payload into the live form draft. The
 *  model catalog is unknown on mobile ("null" below), so the builder can only
 *  carry a model id the user already chose — never introduce an arbitrary one. */
export function mergeDraftFromAssistant(
  current: AgentDraft,
  payload: BuilderDraftPayload,
  catalog: { skills: Set<string>; members: Set<string> },
): AgentDraft {
  return mergeBuilderDraft(
    current,
    payload,
    catalog.skills,
    catalog.members,
    null,
  );
}

/** Assembles the POST /api/agents body from the builder flow. `template` is
 *  fixed to "agent_builder" so creation-source analytics classify the run the
 *  same way web does. */
export function buildBuilderCreateRequest(options: {
  draft: AgentDraft;
  runtimeId: string;
}): CreateAgentRequest {
  return buildCreateAgentRequest({
    draft: options.draft,
    runtimeId: options.runtimeId,
    template: "agent_builder",
  });
}

export interface DraftPayloadRef {
  messageId: string;
  payload: BuilderDraftPayload;
}

/** Newest assistant message that carries a parseable `<agent_draft>` block.
 *  Scans newest-first so a live re-render picks the latest reply; null when
 *  nothing has arrived yet (or every block failed to parse). */
export function latestDraftPayload(
  messages: { id: string; role: string; content: string }[],
): DraftPayloadRef | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const payload = parseBuilderDraft(message.content);
    if (payload) return { messageId: message.id, payload };
  }
  return null;
}

type BuilderDraftRow = Pick<
  AgentBuilderSessionSummary,
  "draft" | "last_message_content" | "last_message_role"
>;

/** What the user calls this unfinished conversation — the stored name is the
 *  only human title the server keeps (session.title is a fixed string on every
 *  row). Mirrors web unfinished-drafts.tsx `draftTitle`. */
export function builderDraftTitle(session: BuilderDraftRow): string {
  return session.draft?.name?.trim() ?? "";
}

/** Two-line recogniser for the drafts list. The stored message is still in the
 *  builder wire format, so both sides decode through the same helpers the
 *  conversation itself uses (web unfinished-drafts.tsx `draftPreview`). */
export function builderDraftPreview(session: BuilderDraftRow): string {
  const content = session.last_message_content;
  if (!content) return "";
  return builderDisplayContent(session.last_message_role, content);
}