/**
 * Chat session row: which queue state the second line shows.
 *
 * Web downgrades the optimistic "typing…" to a static "waiting" only when the
 * agent is DEFINITIVELY offline
 * (packages/views/chat/components/chat-thread-list.tsx:209-233). Presence that
 * hasn't loaded yet — and an agent the presence map doesn't know about — must
 * keep "typing…", otherwise a slow presence query would silently relabel a
 * running turn and, worse, flip back once the data lands.
 */
import { describe, expect, it } from "vitest";
import { deriveChatQueueState } from "./chat-queue-state";

describe("deriveChatQueueState", () => {
  it("shows nothing when no task is queued", () => {
    expect(deriveChatQueueState(false, "offline")).toBeNull();
    expect(deriveChatQueueState(false, "online")).toBeNull();
    expect(deriveChatQueueState(false, undefined)).toBeNull();
  });

  it("shows typing for a queued task while the agent is online", () => {
    expect(deriveChatQueueState(true, "online")).toBe("typing");
    expect(deriveChatQueueState(true, "busy")).toBe("typing");
  });

  it("downgrades to waiting only for a definitively offline agent", () => {
    expect(deriveChatQueueState(true, "offline")).toBe("waiting");
  });

  it("keeps typing while presence is still loading", () => {
    // `undefined` is what a missing map entry yields — loading, or an agent
    // the map has never seen. Neither is evidence of being offline.
    expect(deriveChatQueueState(true, undefined)).toBe("typing");
    expect(deriveChatQueueState(true, null)).toBe("typing");
  });
});
