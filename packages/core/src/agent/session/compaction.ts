import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import {
  compactMessagesTokenAware,
  estimateTokenUsage,
  shouldCompact as shouldCompactTokens,
  compactMessagesWithChunkedSummary,
  COMPACTION_TARGET_RATIO,
  MIN_KEEP_MESSAGES,
} from "../context-window/index.js";

/** Tool result pruning statistics */
export type PruningStats = {
  softTrimmed: number;
  hardCleared: number;
  charsSaved: number;
};

export type CompactionResult = {
  kept: AgentMessage[];
  removedCount: number;
  /** Additional information in token-aware mode */
  tokensRemoved?: number | undefined;
  tokensKept?: number | undefined;
  /** Summary generated in summary mode */
  summary?: string | undefined;
  /** File operations extracted from compacted messages */
  fileOperations?: { readFiles: string[]; modifiedFiles: string[] } | undefined;
  /** Tool failures extracted from compacted messages */
  toolFailures?: Array<{ toolName: string; summary: string }> | undefined;
  /** Reason for compaction: tokens, summary, or pruning (tool result trimming only) */
  reason: "tokens" | "summary" | "pruning";
  /** Tool result pruning statistics (when Phase 1 pruning was applied) */
  pruningStats?: PruningStats | undefined;
};

/**
 * Token-based intelligent compression
 */
export function compactMessagesByTokens(
  messages: AgentMessage[],
  availableTokens: number,
  options?: {
    targetRatio?: number;
    minKeepMessages?: number;
  },
): CompactionResult | null {
  const result = compactMessagesTokenAware(messages, availableTokens, options);
  if (!result) return null;

  return {
    kept: result.kept,
    removedCount: result.removedCount,
    tokensRemoved: result.tokensRemoved,
    tokensKept: result.tokensKept,
    reason: "tokens",
  };
}

/** Token-based compaction options */
export type TokenCompactionOptions = {
  mode: "tokens";
  contextWindowTokens?: number | undefined;
  systemPrompt?: string | undefined;
  reserveTokens?: number | undefined;
  targetRatio?: number | undefined;
  minKeepMessages?: number | undefined;
};

/** Summary compaction options (summary mode) */
export type SummaryCompactionOptions = {
  mode: "summary";
  // Required parameters
  model: Model<any>;
  apiKey: string;
  // Token parameters (reused)
  contextWindowTokens?: number | undefined;
  systemPrompt?: string | undefined;
  reserveTokens?: number | undefined;
  targetRatio?: number | undefined;
  minKeepMessages?: number | undefined;
  // Summary-specific parameters
  customInstructions?: string | undefined;
  previousSummary?: string | undefined;
  signal?: AbortSignal | undefined;
  maxChunkTokens?: number | undefined;
};

export type CompactionOptions = TokenCompactionOptions | SummaryCompactionOptions;

/**
 * Synchronous token-based compaction
 */
export function compactMessages(
  messages: AgentMessage[],
  options: TokenCompactionOptions,
): CompactionResult | null {
  const contextWindowTokens = options.contextWindowTokens ?? 200_000;
  const estimation = estimateTokenUsage({
    messages,
    systemPrompt: options.systemPrompt,
    contextWindowTokens,
    reserveTokens: options.reserveTokens,
  });

  if (!shouldCompactTokens(estimation)) {
    return null;
  }

  return compactMessagesByTokens(messages, estimation.availableTokens, {
    targetRatio: options.targetRatio ?? COMPACTION_TARGET_RATIO,
    minKeepMessages: options.minKeepMessages ?? MIN_KEEP_MESSAGES,
  });
}

/**
 * Summary-based compaction (asynchronous version)
 *
 * Uses LLM to generate summary of historical messages
 */
export async function compactMessagesAsync(
  messages: AgentMessage[],
  options: SummaryCompactionOptions,
): Promise<CompactionResult | null> {
  const contextWindowTokens = options.contextWindowTokens ?? 200_000;
  const estimation = estimateTokenUsage({
    messages,
    systemPrompt: options.systemPrompt,
    contextWindowTokens,
    reserveTokens: options.reserveTokens,
  });

  // Check if compaction is needed
  if (!shouldCompactTokens(estimation)) {
    return null;
  }

  // Use chunked summary to handle very large history
  const result = await compactMessagesWithChunkedSummary({
    messages,
    model: options.model,
    apiKey: options.apiKey,
    availableTokens: estimation.availableTokens,
    targetRatio: options.targetRatio ?? COMPACTION_TARGET_RATIO,
    minKeepMessages: options.minKeepMessages ?? MIN_KEEP_MESSAGES,
    reserveTokens: options.reserveTokens ?? 2048,
    customInstructions: options.customInstructions,
    previousSummary: options.previousSummary,
    signal: options.signal,
    maxChunkTokens: options.maxChunkTokens,
  });

  if (!result) {
    return null;
  }

  return {
    kept: result.kept,
    removedCount: result.removedCount,
    tokensRemoved: result.tokensRemoved,
    tokensKept: result.tokensKept,
    summary: result.summary,
    fileOperations: result.fileOperations,
    toolFailures: result.toolFailures,
    reason: "summary",
  };
}
