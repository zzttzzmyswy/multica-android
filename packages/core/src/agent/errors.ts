/**
 * Error classification utilities for agent error handling.
 */

/**
 * Check if an error is a context overflow / "prompt too long" error from any LLM provider.
 *
 * These errors indicate the request exceeded the model's context window and should
 * trigger auto-compaction rather than auth profile rotation.
 */
export function isContextOverflowError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    msg.includes("prompt is too long") ||
    msg.includes("context length exceeded") ||
    msg.includes("maximum context length") ||
    msg.includes("request_too_large") ||
    msg.includes("request size exceeds") ||
    (msg.includes("413") && msg.includes("too large"))
  );
}
