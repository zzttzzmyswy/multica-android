import { describe, expect, it } from "vitest";
import {
  analyzeCrossTurnWebFetchNeed,
  resolveWebFetchRequirementFromPrompt,
  shouldEnforceWebFetchAfterSearch,
  summarizeWebToolUsage,
  type ToolExecutionRecord,
} from "./web-tools-policy.js";

function buildRecord(params: {
  toolName: string;
  isError?: boolean;
  details?: Record<string, unknown> | null;
}): ToolExecutionRecord {
  return {
    toolName: params.toolName,
    isError: params.isError ?? false,
    details: params.details ?? null,
  };
}

describe("web-tools-policy", () => {
  describe("summarizeWebToolUsage", () => {
    it("counts successful web_search calls with results", () => {
      const usage = summarizeWebToolUsage([
        buildRecord({
          toolName: "web_search",
          details: { count: 3, results: [{}, {}, {}] },
        }),
      ]);

      expect(usage.searchCalls).toBe(1);
      expect(usage.searchSuccess).toBe(1);
      expect(usage.searchSuccessWithResults).toBe(1);
      expect(usage.searchNeedsFollowupFetch).toBe(true);
      expect(usage.fetchCalls).toBe(0);
      expect(usage.fetchSuccess).toBe(0);
    });

    it("does not count tool-level error payload as success", () => {
      const usage = summarizeWebToolUsage([
        buildRecord({
          toolName: "web_search",
          details: { error: true, code: "search_failed" },
        }),
      ]);

      expect(usage.searchCalls).toBe(1);
      expect(usage.searchSuccess).toBe(0);
      expect(usage.searchSuccessWithResults).toBe(0);
      expect(usage.searchNeedsFollowupFetch).toBe(false);
    });

    it("marks latest search as covered when successful fetch follows", () => {
      const usage = summarizeWebToolUsage([
        buildRecord({
          toolName: "web_search",
          details: { count: 1, results: [{}] },
        }),
        buildRecord({
          toolName: "web_fetch",
          details: { status: 200, length: 1024 },
        }),
      ]);

      expect(usage.searchNeedsFollowupFetch).toBe(false);
    });
  });

  describe("shouldEnforceWebFetchAfterSearch", () => {
    it("enforces when search has results but fetch never succeeded", () => {
      const usage = summarizeWebToolUsage([
        buildRecord({
          toolName: "web_search",
          details: { count: 2, results: [{}, {}] },
        }),
      ]);

      expect(
        shouldEnforceWebFetchAfterSearch({
          usage,
          webSearchAvailable: true,
          webFetchAvailable: true,
        }),
      ).toBe(true);
    });

    it("does not enforce after a successful web_fetch", () => {
      const usage = summarizeWebToolUsage([
        buildRecord({
          toolName: "web_search",
          details: { count: 2, results: [{}, {}] },
        }),
        buildRecord({
          toolName: "web_fetch",
          details: { status: 200, length: 1024 },
        }),
      ]);

      expect(
        shouldEnforceWebFetchAfterSearch({
          usage,
          webSearchAvailable: true,
          webFetchAvailable: true,
        }),
      ).toBe(false);
    });

    it("enforces when the latest successful search has no follow-up fetch", () => {
      const usage = summarizeWebToolUsage([
        buildRecord({
          toolName: "web_search",
          details: { count: 2, results: [{}, {}] },
        }),
        buildRecord({
          toolName: "web_fetch",
          details: { status: 200, length: 1200 },
        }),
        buildRecord({
          toolName: "web_search",
          details: { count: 3, results: [{}, {}, {}] },
        }),
      ]);

      expect(
        shouldEnforceWebFetchAfterSearch({
          usage,
          webSearchAvailable: true,
          webFetchAvailable: true,
        }),
      ).toBe(true);
    });

    it("enforces when prompt requires deeper evidence coverage", () => {
      const usage = summarizeWebToolUsage([
        buildRecord({
          toolName: "web_search",
          details: { count: 6, results: [{}, {}, {}] },
        }),
        buildRecord({
          toolName: "web_fetch",
          details: { status: 200, length: 2200 },
        }),
      ]);

      expect(
        shouldEnforceWebFetchAfterSearch({
          usage,
          webSearchAvailable: true,
          webFetchAvailable: true,
          requiredMinFetchSuccess: 2,
        }),
      ).toBe(true);
    });

    it("does not enforce when search returns no results", () => {
      const usage = summarizeWebToolUsage([
        buildRecord({
          toolName: "web_search",
          details: { count: 0, results: [] },
        }),
      ]);

      expect(
        shouldEnforceWebFetchAfterSearch({
          usage,
          webSearchAvailable: true,
          webFetchAvailable: true,
        }),
      ).toBe(false);
    });

    it("does not enforce when web_fetch is unavailable", () => {
      const usage = summarizeWebToolUsage([
        buildRecord({
          toolName: "web_search",
          details: { count: 1, results: [{}] },
        }),
      ]);

      expect(
        shouldEnforceWebFetchAfterSearch({
          usage,
          webSearchAvailable: true,
          webFetchAvailable: false,
        }),
      ).toBe(false);
    });

    it("enforces when fetch was attempted but failed", () => {
      const usage = summarizeWebToolUsage([
        buildRecord({
          toolName: "web_search",
          details: { count: 1, results: [{}] },
        }),
        buildRecord({
          toolName: "web_fetch",
          details: { error: true, code: "fetch_failed" },
        }),
      ]);

      expect(
        shouldEnforceWebFetchAfterSearch({
          usage,
          webSearchAvailable: true,
          webFetchAvailable: true,
        }),
      ).toBe(true);
    });
  });

  describe("analyzeCrossTurnWebFetchNeed", () => {
    it("enforces when user explicitly asks to refetch page content", () => {
      const usage = summarizeWebToolUsage([]);
      const analysis = analyzeCrossTurnWebFetchNeed({
        usage,
        webFetchAvailable: true,
        userPrompt: "Please refetch the page body this turn and verify with sources.",
        assistantText: "Here is a quick summary.",
      });

      expect(analysis.shouldEnforce).toBe(true);
      expect(analysis.explicitFetchRequest).toBe(true);
    });

    it("enforces for freshness requests when assistant makes web-style claims", () => {
      const usage = summarizeWebToolUsage([]);
      const analysis = analyzeCrossTurnWebFetchNeed({
        usage,
        webFetchAvailable: true,
        userPrompt: "Give me the latest web news about OpenAI with sources.",
        assistantText: "According to Reuters, OpenAI announced a new release.",
      });

      expect(analysis.shouldEnforce).toBe(true);
      expect(analysis.freshnessCue).toBe(true);
      expect(analysis.webCue).toBe(true);
      expect(analysis.assistantHasWebClaimSignal).toBe(true);
    });

    it("does not enforce when a fetch was already attempted in this turn", () => {
      const usage = summarizeWebToolUsage([
        buildRecord({
          toolName: "web_fetch",
          details: { error: true, code: "fetch_failed" },
        }),
      ]);
      const analysis = analyzeCrossTurnWebFetchNeed({
        usage,
        webFetchAvailable: true,
        userPrompt: "Please verify with the latest web sources.",
        assistantText: "According to Reuters, ...",
      });

      expect(analysis.shouldEnforce).toBe(false);
    });

    it("does not enforce when user explicitly blocks web fetch", () => {
      const usage = summarizeWebToolUsage([]);
      const analysis = analyzeCrossTurnWebFetchNeed({
        usage,
        webFetchAvailable: true,
        userPrompt: "Do not browse the web, only use snippets.",
        assistantText: "According to Reuters, ...",
      });

      expect(analysis.shouldEnforce).toBe(false);
      expect(analysis.userBlocksWebFetch).toBe(true);
    });

    it("enforces when user provides a direct URL but no fetch happened", () => {
      const usage = summarizeWebToolUsage([]);
      const analysis = analyzeCrossTurnWebFetchNeed({
        usage,
        webFetchAvailable: true,
        userPrompt: "Summarize https://example.com/article and include key takeaways.",
        assistantText: "I can summarize it for you.",
      });

      expect(analysis.shouldEnforce).toBe(true);
      expect(analysis.userProvidesUrl).toBe(true);
    });

    it("does not enforce for non-web freshness requests", () => {
      const usage = summarizeWebToolUsage([]);
      const analysis = analyzeCrossTurnWebFetchNeed({
        usage,
        webFetchAvailable: true,
        userPrompt: "What is the latest version in this repository?",
        assistantText: "The latest version is 1.2.3.",
      });

      expect(analysis.shouldEnforce).toBe(false);
      expect(analysis.freshnessCue).toBe(true);
      expect(analysis.webCue).toBe(false);
    });
  });

  describe("resolveWebFetchRequirementFromPrompt", () => {
    it("requires deeper fetch coverage for research-style prompts", () => {
      const result = resolveWebFetchRequirementFromPrompt(
        "帮我调研一下 APPLE 最近的产品信息，并做分析。",
      );

      expect(result.requiredMinFetchSuccess).toBe(2);
      expect(result.promptSuggestsResearchDepth).toBe(true);
    });

    it("uses explicit minimum source count when present", () => {
      const result = resolveWebFetchRequirementFromPrompt(
        "Please use at least 3 sources and summarize the latest updates.",
      );

      expect(result.requiredMinFetchSuccess).toBe(3);
      expect(result.explicitMinFetchFromPrompt).toBe(3);
    });

    it("falls back to 1 for simple prompts", () => {
      const result = resolveWebFetchRequirementFromPrompt(
        "What is OpenAI's CEO?",
      );

      expect(result.requiredMinFetchSuccess).toBe(1);
      expect(result.promptSuggestsResearchDepth).toBe(false);
    });
  });
});
