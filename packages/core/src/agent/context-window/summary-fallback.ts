/**
 * Summary Fallback — multi-level degradation for summary compaction
 *
 * Level 1: Full LLM summary via generateSummary()
 * Level 2: Exclude oversized messages (> 50% context window), retry summary
 * Level 3: Plain-text fallback summary (with metadata: file ops + tool failures)
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { generateSummary, estimateTokens } from "@mariozechner/pi-coding-agent";
import type { Model } from "@mariozechner/pi-ai";
import {
  collectToolFailures,
  collectFileOperations,
  formatToolFailuresSection,
  formatFileOperationsSection,
} from "./compaction-metadata.js";

export type SummarizeWithFallbackParams = {
  /** Messages to summarize */
  messages: AgentMessage[];
  /** LLM model */
  model: Model<any>;
  /** Max tokens reserved for summary output */
  reserveTokens: number;
  /** API key */
  apiKey: string;
  /** AbortSignal */
  signal?: AbortSignal | undefined;
  /** Summary instructions */
  instructions: string;
  /** Previous summary for incremental context */
  previousSummary?: string | undefined;
  /** Available context window tokens (used for oversized-message filtering) */
  availableTokens: number;
};

/**
 * Attempt to generate an LLM summary with multi-level fallback.
 *
 * Returns { summary, level } where level indicates which fallback tier succeeded:
 *   1 = full summary, 2 = filtered summary, 3 = plain-text fallback
 */
export async function summarizeWithFallback(
  params: SummarizeWithFallbackParams,
): Promise<{ summary: string; level: 1 | 2 | 3 }> {
  const {
    messages,
    model,
    reserveTokens,
    apiKey,
    signal,
    instructions,
    previousSummary,
    availableTokens,
  } = params;

  // ── Level 1: Full summary ────────────────────────────────────────────
  try {
    const summary = await generateSummary(
      messages,
      model,
      reserveTokens,
      apiKey,
      signal,
      instructions,
      previousSummary,
    );
    return { summary, level: 1 };
  } catch (err) {
    console.warn(`[summary-fallback] Level 1 (full summary) failed: ${err}`);
  }

  // ── Level 2: Exclude oversized messages, retry ───────────────────────
  const oversizeThreshold = availableTokens * 0.5;
  const filtered = messages.filter((msg) => estimateTokens(msg) <= oversizeThreshold);

  if (filtered.length > 0 && filtered.length < messages.length) {
    try {
      const summary = await generateSummary(
        filtered,
        model,
        reserveTokens,
        apiKey,
        signal,
        instructions,
        previousSummary,
      );
      return { summary, level: 2 };
    } catch (err) {
      console.warn(`[summary-fallback] Level 2 (filtered summary) failed: ${err}`);
    }
  }

  // ── Level 3: Plain-text fallback with metadata ───────────────────────
  const summary = buildPlainTextFallback(messages, previousSummary);
  return { summary, level: 3 };
}

/**
 * Build a plain-text fallback summary from metadata extraction only (no LLM).
 */
function buildPlainTextFallback(
  messages: AgentMessage[],
  previousSummary?: string,
): string {
  const parts: string[] = [];

  if (previousSummary) {
    parts.push(`## Previous Context\n${previousSummary}`);
  }

  parts.push(
    `## Compaction Note\nLLM summarization was unavailable. ${messages.length} messages were compacted. ` +
    `Below is automatically extracted metadata from the removed messages.`,
  );

  // Extract and append metadata
  const failures = collectToolFailures(messages);
  const fileOps = collectFileOperations(messages);
  const failureSection = formatToolFailuresSection(failures);
  const fileOpsSection = formatFileOperationsSection(fileOps);

  if (failureSection) parts.push(failureSection);
  if (fileOpsSection) parts.push(fileOpsSection);

  return parts.join("\n\n");
}
