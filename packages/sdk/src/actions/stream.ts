/** Stream Action */

export const StreamAction = "stream" as const;

// --- Content block types (re-exported from pi-ai, the single source of truth) ---

import type {
  TextContent,
  ThinkingContent,
  ToolCall,
  ImageContent,
} from "@mariozechner/pi-ai";
import type { AgentEvent } from "@mariozechner/pi-agent-core";

export type { TextContent, ThinkingContent, ToolCall, ImageContent };
export type { AgentEvent };

/**
 * Convenience union of all content block types across message roles.
 *
 * NOTE: This is a deliberate simplification. The backend uses narrower unions
 * per role (e.g. AssistantMessage.content excludes ImageContent, UserMessage
 * excludes ThinkingContent/ToolCall). We accept the wider union on the frontend
 * for simpler handling — the backend already guarantees correctness.
 */
export type ContentBlock = TextContent | ThinkingContent | ToolCall | ImageContent;

// --- Stream event types ---

/**
 * Hub forwards AgentEvent from pi-agent-core as-is.
 * StreamPayload wraps it with routing metadata.
 */
export interface StreamPayload {
  streamId: string;
  agentId: string;
  event: AgentEvent;
}

/** Extract thinking/reasoning content from an AgentEvent that carries a message */
export function extractThinkingFromEvent(event: AgentEvent): string {
  if (!("message" in event)) return "";
  const msg = event.message;
  if (!msg || !("content" in msg)) return "";
  const content = msg.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c): c is ThinkingContent => c.type === "thinking")
    .map((c) => c.thinking ?? "")
    .join("");
}
