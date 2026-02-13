/**
 * Summary-based Compaction
 *
 * Uses LLM to generate summaries of historical messages instead of simple truncation.
 * Includes split-turn detection, adaptive chunk sizing, multi-level fallback,
 * and metadata extraction (file operations + tool failures).
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { estimateTokens } from "@mariozechner/pi-coding-agent";
import type { Model } from "@mariozechner/pi-ai";
import { estimateMessagesTokens } from "./token-estimation.js";
import { summarizeWithFallback } from "./summary-fallback.js";
import {
  collectToolFailures,
  collectFileOperations,
  formatToolFailuresSection,
  formatFileOperationsSection,
} from "./compaction-metadata.js";

/** Summary compaction result */
export type SummaryCompactionResult = {
  /** Kept messages (including summary message) */
  kept: AgentMessage[];
  /** Number of removed messages */
  removedCount: number;
  /** Tokens removed */
  tokensRemoved: number;
  /** Tokens kept */
  tokensKept: number;
  /** Generated summary */
  summary: string;
  /** Compaction reason */
  reason: "summary";
  /** File operations extracted from compacted messages */
  fileOperations?: { readFiles: string[]; modifiedFiles: string[] } | undefined;
  /** Tool failures extracted from compacted messages */
  toolFailures?: Array<{ toolName: string; summary: string }> | undefined;
};

/** Summary compaction parameters */
export type SummaryCompactionParams = {
  /** Message list */
  messages: AgentMessage[];
  /** LLM Model (for generating summary) */
  model: Model<any>;
  /** API Key */
  apiKey: string;
  /** Available tokens */
  availableTokens: number;
  /** Target utilization ratio (0-1), defaults to 0.5 */
  targetRatio?: number | undefined;
  /** Minimum messages to keep, defaults to 10 */
  minKeepMessages?: number | undefined;
  /** Tokens reserved for summary generation, defaults to 2048 */
  reserveTokens?: number | undefined;
  /** Custom summary instructions */
  customInstructions?: string | undefined;
  /** Previous summary (for incremental update) */
  previousSummary?: string | undefined;
  /** AbortSignal */
  signal?: AbortSignal | undefined;
};

/** Default summary instructions */
const DEFAULT_SUMMARY_INSTRUCTIONS = `Summarize the conversation history concisely, focusing on:
- Key decisions made
- Important context and constraints
- Open questions or TODOs
- Technical details that may be needed later

Keep the summary concise but complete. Use bullet points for clarity.`;

/**
 * Split messages into parts to summarize and parts to keep
 */
export function splitMessagesForSummary(
  messages: AgentMessage[],
  availableTokens: number,
  options?: {
    targetRatio?: number | undefined;
    minKeepMessages?: number | undefined;
  },
): { toSummarize: AgentMessage[]; toKeep: AgentMessage[] } | null {
  const targetRatio = options?.targetRatio ?? 0.5;
  const minKeep = options?.minKeepMessages ?? 10;

  if (messages.length <= minKeep) {
    return null; // Too few messages, no compression needed
  }

  const totalTokens = estimateMessagesTokens(messages);
  const targetTokens = Math.floor(availableTokens * targetRatio);

  // If already within target, no compression needed
  if (totalTokens <= targetTokens) {
    return null;
  }

  // Keep messages from back to front
  const toKeep: AgentMessage[] = [];
  let keptTokens = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    const msgTokens = estimateTokens(msg);

    // Check if this message can be added
    if (keptTokens + msgTokens <= targetTokens || toKeep.length < minKeep) {
      toKeep.unshift(msg);
      keptTokens += msgTokens;
    }

    // If minimum keep count reached and exceeds target, stop
    if (toKeep.length >= minKeep && keptTokens >= targetTokens) {
      break;
    }
  }

  // Messages to summarize
  const toSummarize = messages.slice(0, messages.length - toKeep.length);

  if (toSummarize.length === 0) {
    return null;
  }

  return { toSummarize, toKeep };
}

// ── Split Turn Detection ───────────────────────────────────────────────────

/**
 * Detect and fix a "split turn" — when the first kept message is a user message
 * containing tool_result blocks without the corresponding assistant tool_use.
 *
 * When detected, separates the orphaned turn (assistant tool_use + user tool_result)
 * into a `splitPrefix` for separate summarization, and returns adjusted arrays
 * where `toSummarize` no longer contains those messages.
 *
 * Returns null if no split turn was detected.
 */
export function detectSplitTurn(
  toSummarize: AgentMessage[],
  toKeep: AgentMessage[],
): {
  splitPrefix: AgentMessage[];
  adjustedToSummarize: AgentMessage[];
  adjustedToKeep: AgentMessage[];
} | null {
  if (toKeep.length === 0) return null;

  const firstKept = toKeep[0]!;
  if (firstKept.role !== "user") return null;

  // Check if this user message has tool_result blocks
  const content = (firstKept as any).content;
  if (!Array.isArray(content)) return null;

  const hasToolResult = content.some((b: any) => b.type === "tool_result");
  if (!hasToolResult) return null;

  // This is an orphaned tool_result — look back in toSummarize for the assistant tool_use
  const toolResultIds = new Set(
    content
      .filter((b: any) => b.type === "tool_result")
      .map((b: any) => b.tool_use_id ?? b.id)
      .filter(Boolean),
  );

  // Walk backwards through toSummarize to find the assistant with matching tool_use
  let assistantIndex = -1;
  for (let i = toSummarize.length - 1; i >= 0; i--) {
    const msg = toSummarize[i]!;
    if (msg.role !== "assistant") continue;

    const assistantContent = (msg as any).content;
    if (!Array.isArray(assistantContent)) continue;

    const hasMatchingToolUse = assistantContent.some(
      (b: any) => b.type === "tool_use" && toolResultIds.has(b.id),
    );
    if (hasMatchingToolUse) {
      assistantIndex = i;
      break;
    }
  }

  if (assistantIndex < 0) return null;

  // Split prefix: messages from assistantIndex to end of toSummarize + orphaned firstKept
  const splitPrefix = [
    ...toSummarize.slice(assistantIndex),
    firstKept,
  ];
  // Truncate toSummarize so the split prefix messages are NOT double-counted
  const adjustedToSummarize = toSummarize.slice(0, assistantIndex);
  const adjustedToKeep = toKeep.slice(1);

  return { splitPrefix, adjustedToSummarize, adjustedToKeep };
}

// ── Adaptive Chunk Ratio ───────────────────────────────────────────────────

const ADAPTIVE_CHUNK_MIN = 0.15;
const ADAPTIVE_CHUNK_MAX = 0.4;

/**
 * Compute adaptive chunk ratio based on average message token count.
 * Larger average messages → smaller ratio (to avoid exceeding limits).
 * Return value range: [0.15, 0.4] — multiply by availableTokens to get chunk size.
 */
export function computeAdaptiveChunkRatio(
  messages: AgentMessage[],
): number {
  if (messages.length === 0) return ADAPTIVE_CHUNK_MAX;

  const totalTokens = estimateMessagesTokens(messages);
  const avgTokens = totalTokens / messages.length;

  // Scale inversely: high avg → low ratio
  // avgTokens ~500 → ratio ~0.4; avgTokens ~5000+ → ratio ~0.15
  const ratio = ADAPTIVE_CHUNK_MAX - (avgTokens / 10000) * (ADAPTIVE_CHUNK_MAX - ADAPTIVE_CHUNK_MIN);
  return Math.max(ADAPTIVE_CHUNK_MIN, Math.min(ADAPTIVE_CHUNK_MAX, ratio));
}

/**
 * Create summary message
 */
function createSummaryMessage(summary: string, previousSummary?: string): AgentMessage {
  const content = previousSummary
    ? `## Previous Context Summary\n${previousSummary}\n\n## Recent Context Summary\n${summary}`
    : `## Conversation Summary\n${summary}`;

  return {
    role: "user",
    content: `[System Note: The following is a summary of the earlier conversation history that has been compacted to save context space.]\n\n${content}\n\n[End of Summary]`,
    timestamp: Date.now(),
  };
}

/**
 * Execute summary-based compaction
 *
 * Uses LLM to generate summary of historical messages, then combines summary with recent messages
 */
export async function compactMessagesWithSummary(
  params: SummaryCompactionParams,
): Promise<SummaryCompactionResult | null> {
  const {
    messages,
    model,
    apiKey,
    availableTokens,
    targetRatio,
    minKeepMessages,
    reserveTokens = 2048,
    customInstructions,
    previousSummary,
    signal,
  } = params;

  // Split messages
  const split = splitMessagesForSummary(messages, availableTokens, {
    targetRatio,
    minKeepMessages,
  });

  if (!split) {
    return null;
  }

  let { toSummarize, toKeep } = split;

  // Detect and handle split turn
  const splitTurn = detectSplitTurn(toSummarize, toKeep);
  let splitPrefixSummary = "";

  if (splitTurn) {
    toSummarize = splitTurn.adjustedToSummarize;
    toKeep = splitTurn.adjustedToKeep;

    // Summarize the split prefix separately
    const instructions = customInstructions || DEFAULT_SUMMARY_INSTRUCTIONS;
    const prefixResult = await summarizeWithFallback({
      messages: splitTurn.splitPrefix,
      model,
      reserveTokens,
      apiKey,
      signal,
      instructions,
      previousSummary,
      availableTokens,
    });
    splitPrefixSummary = prefixResult.summary;
  }

  // Generate summary with fallback (toSummarize no longer contains split prefix messages)
  const instructions = customInstructions || DEFAULT_SUMMARY_INSTRUCTIONS;
  let finalSummary = "";

  if (toSummarize.length > 0) {
    const { summary } = await summarizeWithFallback({
      messages: toSummarize,
      model,
      reserveTokens,
      apiKey,
      signal,
      instructions,
      previousSummary,
      availableTokens,
    });
    finalSummary = summary;
  }

  // Append split prefix summary if present
  if (splitPrefixSummary) {
    finalSummary += (finalSummary ? "\n\n" : "") + `## Split Turn Context\n${splitPrefixSummary}`;
  }

  // Append metadata sections (all compacted = adjusted toSummarize + splitPrefix)
  const allCompactedMessages = splitTurn
    ? [...toSummarize, ...splitTurn.splitPrefix]
    : toSummarize;
  const failures = collectToolFailures(allCompactedMessages);
  const fileOps = collectFileOperations(allCompactedMessages);

  finalSummary += formatToolFailuresSection(failures);
  finalSummary += formatFileOperationsSection(fileOps);

  // Create summary message
  const summaryMessage = createSummaryMessage(finalSummary, previousSummary);

  // Combine results
  const kept = [summaryMessage, ...toKeep];

  const tokensRemoved = estimateMessagesTokens(allCompactedMessages);
  const tokensKept = estimateMessagesTokens(kept);

  return {
    kept,
    removedCount: allCompactedMessages.length,
    tokensRemoved,
    tokensKept,
    summary: finalSummary,
    reason: "summary",
    fileOperations: (fileOps.readFiles.length > 0 || fileOps.modifiedFiles.length > 0) ? fileOps : undefined,
    toolFailures: failures.length > 0 ? failures : undefined,
  };
}

/**
 * Generate summary in chunks (for very large history)
 *
 * When history is too large, generate summaries by chunks then merge.
 * Uses adaptive chunk sizing and multi-level fallback.
 */
export async function compactMessagesWithChunkedSummary(
  params: SummaryCompactionParams & {
    maxChunkTokens?: number | undefined;
  },
): Promise<SummaryCompactionResult | null> {
  const {
    messages,
    model,
    apiKey,
    availableTokens,
    targetRatio,
    minKeepMessages,
    reserveTokens = 2048,
    customInstructions,
    previousSummary,
    signal,
  } = params;

  // Split messages
  const split = splitMessagesForSummary(messages, availableTokens, {
    targetRatio,
    minKeepMessages,
  });

  if (!split) {
    return null;
  }

  let { toSummarize, toKeep } = split;

  // Detect and handle split turn
  const splitTurn = detectSplitTurn(toSummarize, toKeep);
  let splitPrefixSummary = "";

  if (splitTurn) {
    toSummarize = splitTurn.adjustedToSummarize;
    toKeep = splitTurn.adjustedToKeep;

    // Summarize the split prefix separately
    const instructions = customInstructions || DEFAULT_SUMMARY_INSTRUCTIONS;
    const prefixResult = await summarizeWithFallback({
      messages: splitTurn.splitPrefix,
      model,
      reserveTokens,
      apiKey,
      signal,
      instructions,
      previousSummary,
      availableTokens,
    });
    splitPrefixSummary = prefixResult.summary;
  }

  // Compute adaptive chunk size
  const chunkRatio = computeAdaptiveChunkRatio(toSummarize);
  const maxChunkTokens = params.maxChunkTokens ?? Math.floor(availableTokens * chunkRatio);

  // Process in chunks (works naturally for single-chunk case too)
  const chunks: AgentMessage[][] = [];
  let currentChunk: AgentMessage[] = [];
  let currentTokens = 0;

  for (const msg of toSummarize) {
    const msgTokens = estimateTokens(msg);

    if (currentTokens + msgTokens > maxChunkTokens && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentTokens = 0;
    }

    currentChunk.push(msg);
    currentTokens += msgTokens;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  // Generate summary for each chunk with fallback
  const instructions = customInstructions || DEFAULT_SUMMARY_INSTRUCTIONS;
  const chunkSummaries: string[] = [];

  let runningContext = previousSummary;
  for (const chunk of chunks) {
    const { summary: chunkSummary } = await summarizeWithFallback({
      messages: chunk,
      model,
      reserveTokens,
      apiKey,
      signal,
      instructions,
      previousSummary: runningContext,
      availableTokens,
    });
    chunkSummaries.push(chunkSummary);
    runningContext = chunkSummary;
  }

  // Final summary is the last chunk's summary (already includes previous context)
  let finalSummary = chunkSummaries[chunkSummaries.length - 1] ?? "";

  // Append split prefix summary if present
  if (splitPrefixSummary) {
    finalSummary += (finalSummary ? "\n\n" : "") + `## Split Turn Context\n${splitPrefixSummary}`;
  }

  // Append metadata sections (all compacted = adjusted toSummarize + splitPrefix)
  const allCompactedMessages = splitTurn
    ? [...toSummarize, ...splitTurn.splitPrefix]
    : toSummarize;
  const failures = collectToolFailures(allCompactedMessages);
  const fileOps = collectFileOperations(allCompactedMessages);
  finalSummary += formatToolFailuresSection(failures);
  finalSummary += formatFileOperationsSection(fileOps);

  // Create summary message
  const summaryMessage = createSummaryMessage(finalSummary);

  // Combine results
  const kept = [summaryMessage, ...toKeep];

  const tokensRemoved = estimateMessagesTokens(allCompactedMessages);
  const tokensKept = estimateMessagesTokens(kept);

  return {
    kept,
    removedCount: allCompactedMessages.length,
    tokensRemoved,
    tokensKept,
    summary: finalSummary,
    reason: "summary",
    fileOperations: (fileOps.readFiles.length > 0 || fileOps.modifiedFiles.length > 0) ? fileOps : undefined,
    toolFailures: failures.length > 0 ? failures : undefined,
  };
}
