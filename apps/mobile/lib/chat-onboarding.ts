import type { ChatMessage } from "@multica/core/types";

/**
 * Id of the message whose suggestion strip is the product's fixed starter
 * cards rather than that turn's quick-action chips.
 *
 * Mika's onboarding opening self-describes: the server stamps
 * `message_kind = "onboarding_opening"` on the product-authored first reply
 * (`normalizeMessageKind`, server/internal/handler/chat.go), and the hidden
 * kickoff row that precedes it is filtered before it ever reaches a client.
 * Web reads the same marker (packages/views/chat/components/chat-message-list.tsx).
 *
 * Only the assistant's own message counts. A member can quote the opening
 * text, and a user row carrying the marker would otherwise hand the cards to
 * a message the product did not author.
 */
export function onboardingOpeningMessageId(
  messages: readonly ChatMessage[],
): string | null {
  for (const message of messages) {
    if (message.role === "assistant" && message.message_kind === "onboarding_opening") {
      return message.id;
    }
  }
  return null;
}
