import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@multica/core/types";
import { onboardingOpeningMessageId } from "@/lib/chat-onboarding";

/**
 * Starter-card selection (iteration 174, R2).
 *
 * The branch that renders the cards is keyed off this lookup, and in v0.6.2 it
 * could never fire: `ChatMessageSchema` dropped `onboarding_opening` before the
 * component ever saw the message (see `data/schemas.test.ts`). These cases hold
 * the selection rule itself, which is the half a component test would have
 * covered — mobile's vitest lane is Node-only and renders no RN components.
 */
function message(over: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    chat_session_id: "session-1",
    role: "assistant",
    content: "",
    task_id: null,
    created_at: "2026-09-22T00:00:00Z",
    ...over,
  };
}

describe("onboardingOpeningMessageId", () => {
  it("finds the assistant opening", () => {
    const messages = [
      message({ id: "m1", role: "user", content: "hello" }),
      message({ id: "m2", message_kind: "onboarding_opening" }),
    ];
    expect(onboardingOpeningMessageId(messages)).toBe("m2");
  });

  it("returns null when the session has no opening", () => {
    expect(
      onboardingOpeningMessageId([
        message({ id: "m1", role: "user" }),
        message({ id: "m2", message_kind: "no_response" }),
        message({ id: "m3" }),
      ]),
    ).toBeNull();
  });

  it("returns null for an empty window", () => {
    expect(onboardingOpeningMessageId([])).toBeNull();
  });

  it("ignores a user row that carries the marker", () => {
    // A member can paste the opening text back. The cards are the product's
    // greeting, so only the assistant's own row may claim them.
    expect(
      onboardingOpeningMessageId([
        message({ id: "m1", role: "user", message_kind: "onboarding_opening" }),
      ]),
    ).toBeNull();
  });

  it("ignores the hidden kickoff kind", () => {
    expect(
      onboardingOpeningMessageId([
        message({ id: "m1", message_kind: "onboarding_kickoff" }),
      ]),
    ).toBeNull();
  });

  it("takes the first opening when a reload duplicated the window", () => {
    const messages = [
      message({ id: "m1", message_kind: "onboarding_opening" }),
      message({ id: "m2", message_kind: "onboarding_opening" }),
    ];
    expect(onboardingOpeningMessageId(messages)).toBe("m1");
  });
});
