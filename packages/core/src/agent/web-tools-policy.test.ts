import { describe, expect, it } from "vitest";
import {
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
});
