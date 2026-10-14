/**
 * The two halves of a system agent's prompt, and the copy that names them.
 *
 * A product-defined agent (Mika — `system_key: "mika"`, `service.MikaSystemKey`
 * server-side) does not carry one prompt. The server splits it:
 *
 *   - `system_instructions` — the product half, rendered from the backend
 *     binary (`server/internal/service/builtin_agents/mika/INSTRUCTIONS.md`,
 *     ~3.5 KB) and NEVER stored on the agent row
 *     (`server/internal/handler/agent.go:52-63`). Read-only on every client;
 *     it updates when Multica is deployed.
 *   - `instructions` — this workspace's own notes. The only editable half, and
 *     the only one a release never overwrites.
 *
 * The wire field is already on every agent response the phone receives — the
 * list endpoint fills it per row through `agentToResponse`
 * (`server/internal/handler/agent.go:187`, `:926`) — but nothing on mobile read
 * it, so the edit form labelled the workspace-notes half 「指令」 and said
 * nothing about the other half existing. A workspace admin reviewing Mika on a
 * phone could not see what the agent was actually told to do, and could
 * reasonably conclude that clearing the field changes its behaviour when it
 * only clears the notes that layer on top of the product prompt.
 *
 * Web renders both halves in one tab
 * (`packages/views/agents/components/tabs/instructions-tab.tsx:29-107`): a
 * read-only "Maintained by Multica" card that expands, plus an editable field
 * whose label and placeholder switch to "Workspace notes" when the system half
 * is present. This module is mobile's copy of the two decisions that switch
 * makes — which agents have a system half, and what the editable half is then
 * called. Kept as pure functions (no `react-native`, no `@/data/api`) so the
 * Node vitest lane can falsify each one, and so the label/placeholder pair
 * cannot drift between the form and the detail screen.
 *
 * Mirrored rather than imported from `packages/views` for the usual reason
 * (`apps/mobile/CLAUDE.md`): mobile writes its own copy of anything that is not
 * an `import type`, and views' copy is a React component, not a predicate.
 */
import type { Agent } from "@multica/core/types";

type SystemPromptSource = Pick<Agent, "system_instructions">;

/**
 * The read-only product half, trimmed — empty when the agent has none.
 *
 * Trimmed because the decision this feeds is "is there anything to show":
 * web makes the same call (`agent.system_instructions?.trim()`), and a
 * whitespace-only value would otherwise render an empty card under a heading
 * claiming Multica maintains instructions for this agent.
 *
 * The `typeof` guard is not redundant with the schema's `.catch(undefined)`:
 * that catch protects the parsed list and detail reads, and this protects the
 * render itself from any caller holding an unparsed value (`null` from a
 * partial response, a number from a drifted payload). One unread field must
 * not be able to throw inside the agent screen — the failure it degrades to,
 * "no system layer", is also the honest reading.
 */
export function systemPromptLayer(
  agent: SystemPromptSource | null | undefined,
): string {
  const value = agent?.system_instructions;
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Whether this agent has a product-maintained half to show read-only.
 *
 * Deliberately NOT `system_key === "mika"` and NOT a display-name check: the
 * server ships the text or it does not, and `system_key` is a label while
 * `system_instructions` is the payload. An ordinary agent — and a workspace
 * whose backend predates the field, which omits it entirely — answers false
 * here and renders exactly as it does today.
 */
export function hasSystemPromptLayer(
  agent: SystemPromptSource | null | undefined,
): boolean {
  return systemPromptLayer(agent).length > 0;
}

/** i18n keys for the editable half of the instruction field. */
export interface AgentInstructionsCopy {
  /** Field label above the textarea. */
  labelKey: string;
  /** Textarea placeholder. */
  placeholderKey: string;
  /** Sentence above the field explaining how this half relates to the system
   *  half, or null when there is no system half to relate to. */
  introKey: string | null;
}

/**
 * What the editable half is called. Web's two states
 * (`instructions-tab.tsx:32-34`, `:88-104`):
 *
 *   - no system half → 「指令」 with the "define its role, expertise and working
 *     style" placeholder. Unchanged from mobile's pre-existing copy.
 *   - system half present → 「工作区补充」 with the "context this agent should
 *     always have" placeholder, plus the sentence saying these notes layer on
 *     top of what Multica maintains and are never overwritten by a release.
 */
export const AGENT_INSTRUCTIONS_COPY: {
  readonly plain: AgentInstructionsCopy;
  readonly workspaceNotes: AgentInstructionsCopy;
} = {
  plain: {
    labelKey: "agents.new.instructionsLabel",
    placeholderKey: "agents.new.instructionsPlaceholder",
    introKey: null,
  },
  workspaceNotes: {
    labelKey: "agents.instructions.workspaceLabel",
    placeholderKey: "agents.instructions.workspacePlaceholder",
    introKey: "agents.instructions.workspaceIntro",
  },
};

export function agentInstructionsCopy(
  hasSystemLayer: boolean,
): AgentInstructionsCopy {
  return hasSystemLayer
    ? AGENT_INSTRUCTIONS_COPY.workspaceNotes
    : AGENT_INSTRUCTIONS_COPY.plain;
}
