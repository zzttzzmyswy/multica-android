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
 * Extract artifact references from messages that contain truncated tool results.
 */
function extractArtifactRefs(messages: AgentMessage[]): string[] {
  const refs: string[] = [];
  const pattern = /Full result (?:saved to|available at) (artifacts\/[^\s.]+\.txt)/g;

  for (const msg of messages) {
    if (msg.role !== "user") continue;
    const content = (msg as any).content;
    if (typeof content === "string") {
      for (const match of content.matchAll(pattern)) {
        if (match[1] && !refs.includes(match[1])) refs.push(match[1]);
      }
    } else if (Array.isArray(content)) {
      for (const block of content) {
        const text =
          typeof block === "string"
            ? block
            : block?.type === "tool_result" && typeof block.content === "string"
              ? block.content
              : block?.type === "tool_result" && Array.isArray(block.content)
                ? block.content
                    .filter((b: any) => b?.type === "text")
                    .map((b: any) => b.text)
                    .join("")
                : block?.type === "text"
                  ? block.text ?? ""
                  : "";
        for (const match of text.matchAll(pattern)) {
          if (match[1] && !refs.includes(match[1])) refs.push(match[1]);
        }
      }
    }
  }
  return refs;
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

  // Extract and append metadata (format functions return strings with leading \n,
  // designed for direct concatenation — so we concatenate rather than join)
  const failures = collectToolFailures(messages);
  const fileOps = collectFileOperations(messages);

  let result = parts.join("\n\n");
  result += formatToolFailuresSection(failures);
  result += formatFileOperationsSection(fileOps);

  // Extract artifact references from truncated tool results
  const artifactRefs = extractArtifactRefs(messages);
  if (artifactRefs.length > 0) {
    result += `\n\n## Saved Artifacts\nThe following tool results were saved as artifacts and can be re-read:\n`;
    for (const ref of artifactRefs) {
      result += `- ${ref}\n`;
    }
  }

  return result;
}
