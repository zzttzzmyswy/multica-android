import { describe, it, expect, vi } from "vitest";
import {
  compactMessagesByTokens,
  compactMessages,
  type CompactionResult,
} from "./compaction.js";
import type { AgentMessage } from "@mariozechner/pi-agent-core";

// Mock only the third-party dependency (allowed by mock policy).
// The internal context-window module uses real logic.
vi.mock("@mariozechner/pi-coding-agent", () => ({
  estimateTokens: (message: AgentMessage) => {
    const msg = message as any;
    if (typeof msg.content === "string") {
      return Math.ceil(msg.content.length / 4);
    }
    return 50;
  },
}));

describe("compaction", () => {
  function createMessages(count: number, prefix = "Message"): AgentMessage[] {
    return Array.from({ length: count }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `${prefix} ${i}`,
    })) as AgentMessage[];
  }

  describe("compactMessagesByTokens", () => {
    it("should return null when under token limit", () => {
      const messages = createMessages(5);
      // ~15 tokens total, target = 1000 * 0.5 = 500 → no compact needed
      const result = compactMessagesByTokens(messages, 1000);
      expect(result).toBeNull();
    });

    it("should compact when over token limit", () => {
      const messages = createMessages(100);
      // ~300 tokens total, target = 200 * 0.5 = 100 → needs compact
      const result = compactMessagesByTokens(messages, 200, {
        targetRatio: 0.5,
        minKeepMessages: 5,
      });

      expect(result).not.toBeNull();
      expect(result!.reason).toBe("tokens");
      expect(result!.tokensRemoved).toBeGreaterThan(0);
      expect(result!.tokensKept).toBeGreaterThan(0);
    });

    it("should respect minKeepMessages", () => {
      const messages = createMessages(20);
      const result = compactMessagesByTokens(messages, 50, {
        minKeepMessages: 15,
      });

      if (result) {
        expect(result.kept.length).toBeGreaterThanOrEqual(15);
      }
    });

    it("should use default options when not specified", () => {
      const messages = createMessages(50);
      const result = compactMessagesByTokens(messages, 100);

      if (result) {
        expect(result.kept.length).toBeGreaterThanOrEqual(10); // Default minKeepMessages
      }
    });
  });

  describe("compactMessages (unified entry point)", () => {
    describe("tokens mode", () => {
      it("should use token-based compaction when utilization is high", () => {
        const messages = createMessages(100);
        // ~300 message tokens (real estimator: ~3 tokens/msg)
        // systemPromptTokens ≈ 4, reserveTokens = 0
        // available = 400 - 4 = 396
        // utilization = (300 * 1.2) / 396 ≈ 0.91 > 0.8 → should compact
        const result = compactMessages(messages, {
          mode: "tokens",
          contextWindowTokens: 400,
          systemPrompt: "System prompt",
          reserveTokens: 0,
        });

        expect(result).not.toBeNull();
        expect(result!.reason).toBe("tokens");
      });

      it("should return null when utilization is low", () => {
        const messages = createMessages(5);
        // ~15 message tokens
        // available = 10000 - 4 - 1024 = 8972
        // utilization = (15 * 1.2) / 8972 ≈ 0.002 < 0.8
        const result = compactMessages(messages, {
          mode: "tokens",
          contextWindowTokens: 10000,
          systemPrompt: "System prompt",
        });

        expect(result).toBeNull();
      });

      it("should use default context window tokens", () => {
        const messages = createMessages(5);
        const result = compactMessages(messages, {
          mode: "tokens",
        });

        // Default: 200_000 tokens, very low utilization
        expect(result).toBeNull();
      });

      it("should pass through target ratio and min keep messages", () => {
        const messages = createMessages(50);
        const result = compactMessages(messages, {
          mode: "tokens",
          contextWindowTokens: 1000,
          targetRatio: 0.3,
          minKeepMessages: 20,
        });

        if (result) {
          expect(result.kept.length).toBeGreaterThanOrEqual(20);
        }
      });
    });
  });
});
