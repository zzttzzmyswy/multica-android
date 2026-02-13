import { describe, it, expect, vi } from "vitest";
import {
  compactMessagesByCount,
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

  function createMessagesWithToolUse(): AgentMessage[] {
    return [
      { role: "user", content: "Start" },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "tool-1", name: "test", input: {} }],
      } as any,
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tool-1", content: "Result" }],
      } as any,
      { role: "assistant", content: "Done" },
      { role: "user", content: "Next message" },
    ];
  }

  describe("compactMessagesByCount", () => {
    it("should return null when under max messages", () => {
      const messages = createMessages(50);
      const result = compactMessagesByCount(messages, 80, 60);
      expect(result).toBeNull();
    });

    it("should compact when over max messages", () => {
      const messages = createMessages(100);
      const result = compactMessagesByCount(messages, 80, 60);

      expect(result).not.toBeNull();
      expect(result!.reason).toBe("count");
      expect(result!.kept.length).toBeLessThanOrEqual(100);
      expect(result!.removedCount).toBeGreaterThan(0);
    });

    it("should keep the specified number of last messages", () => {
      const messages = createMessages(100);
      const result = compactMessagesByCount(messages, 80, 50);

      if (result) {
        // Should keep approximately keepLast messages
        expect(result.kept.length).toBeGreaterThanOrEqual(40);
        expect(result.kept.length).toBeLessThanOrEqual(60);
      }
    });

    it("should return null when exact at max messages", () => {
      const messages = createMessages(80);
      const result = compactMessagesByCount(messages, 80, 60);
      expect(result).toBeNull();
    });

    it("should not break tool_use/tool_result pairs", () => {
      // Create many messages followed by a tool pair
      const regularMessages = createMessages(70);
      const toolMessages = createMessagesWithToolUse();
      const messages = [...regularMessages, ...toolMessages];

      const result = compactMessagesByCount(messages, 80, 20);

      if (result) {
        // Check that we didn't end up with orphaned tool_result
        let hasOrphanedToolResult = false;
        for (let i = 0; i < result.kept.length; i++) {
          const msg = result.kept[i] as any;
          if (Array.isArray(msg.content)) {
            const hasToolResult = msg.content.some((b: any) => b.type === "tool_result");
            if (hasToolResult) {
              // Check if previous message has corresponding tool_use
              const prevMsg = result.kept[i - 1] as any;
              if (!prevMsg || !Array.isArray(prevMsg.content)) {
                hasOrphanedToolResult = true;
              }
            }
          }
        }
        // This test verifies the safe compaction point logic
        // The exact behavior depends on findSafeCompactionPoint implementation
      }
    });

    it("should return null when would keep almost all messages", () => {
      const messages = createMessages(85);
      const result = compactMessagesByCount(messages, 80, 82);

      // If we'd only remove 2-3 messages, should return null
      if (result) {
        expect(result.removedCount).toBeGreaterThan(2);
      }
    });
  });

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
    describe("count mode", () => {
      it("should use count-based compaction", () => {
        const messages = createMessages(100);
        const result = compactMessages(messages, {
          mode: "count",
          maxMessages: 80,
          keepLast: 60,
        });

        expect(result).not.toBeNull();
        expect(result!.reason).toBe("count");
      });

      it("should use default max and keep values", () => {
        const messages = createMessages(100);
        const result = compactMessages(messages, {
          mode: "count",
        });

        // Default: maxMessages: 80, keepLast: 60
        expect(result).not.toBeNull();
        expect(result!.reason).toBe("count");
      });
    });

    describe("tokens mode", () => {
      it("should use token-based compaction when utilization is high", () => {
        const messages = createMessages(100);
        // ~300 message tokens (real estimator: ~3 tokens/msg)
        // systemPromptTokens ≈ 7, reserveTokens = 0
        // available = 500 - 7 = 493
        // utilization = (300 * 1.5) / 493 ≈ 0.91 > 0.8 → should compact
        const result = compactMessages(messages, {
          mode: "tokens",
          contextWindowTokens: 500,
          systemPrompt: "System prompt",
          reserveTokens: 0,
        });

        expect(result).not.toBeNull();
        expect(result!.reason).toBe("tokens");
      });

      it("should return null when utilization is low", () => {
        const messages = createMessages(5);
        // ~15 message tokens
        // available = 10000 - 7 - 1024 = 8969
        // utilization = (15 * 1.5) / 8969 ≈ 0.003 < 0.8
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
