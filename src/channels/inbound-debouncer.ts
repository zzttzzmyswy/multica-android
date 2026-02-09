/**
 * Inbound message debouncer — batches rapid-fire messages from the same
 * conversation into a single agent.write() call.
 *
 * When a message arrives:
 * 1. Start a timer (delayMs, default 500ms)
 * 2. If another message from the same conversationId arrives before timer fires,
 *    reset the timer and append the text
 * 3. If maxWaitMs (default 2000ms) has elapsed since the first message,
 *    fire immediately regardless of timer
 * 4. When timer fires, call the flush callback with all accumulated text
 *
 * This prevents rapid-fire messages from triggering multiple separate Agent
 * runs. Instead, messages sent within a short window are concatenated with
 * newlines and dispatched as one combined prompt.
 *
 * Inspired by OpenClaw's createInboundDebouncer pattern.
 * @see docs/channel/openclaw-research.md — Section 7.3 message preprocessing
 */

interface PendingBatch {
  /** Accumulated message texts in arrival order */
  texts: string[];
  /** Timestamp of the first message in this batch */
  firstArrival: number;
  /** Idle timer — fires when no new message arrives within delayMs */
  timer: ReturnType<typeof setTimeout>;
}

export class InboundDebouncer {
  private pending = new Map<string, PendingBatch>();

  /**
   * @param flushFn  - Called when a batch is ready; receives conversationId and combined text
   * @param delayMs  - Idle window: how long to wait after each message before flushing (default 500ms)
   * @param maxWaitMs - Hard cap: max time since first message before force-flushing (default 2000ms)
   */
  constructor(
    private readonly flushFn: (conversationId: string, combinedText: string) => void,
    private readonly delayMs = 500,
    private readonly maxWaitMs = 2000,
  ) {}

  /** Add a message to the buffer. May trigger an immediate flush if maxWaitMs exceeded. */
  push(conversationId: string, text: string): void {
    const existing = this.pending.get(conversationId);

    if (existing) {
      // Append to existing batch, reset idle timer
      existing.texts.push(text);
      clearTimeout(existing.timer);

      // Check hard cap: if we've been buffering too long, flush now
      const elapsed = Date.now() - existing.firstArrival;
      if (elapsed >= this.maxWaitMs) {
        this.flush(conversationId);
        return;
      }

      // Reset idle timer
      existing.timer = setTimeout(() => this.flush(conversationId), this.delayMs);
    } else {
      // Start a new batch
      const timer = setTimeout(() => this.flush(conversationId), this.delayMs);
      this.pending.set(conversationId, {
        texts: [text],
        firstArrival: Date.now(),
        timer,
      });
    }
  }

  /** Flush all pending messages for a conversation, invoking the flush callback */
  private flush(conversationId: string): void {
    const batch = this.pending.get(conversationId);
    if (!batch) return;

    clearTimeout(batch.timer);
    this.pending.delete(conversationId);

    // Join multiple messages with newlines so the Agent sees them as one prompt
    const combined = batch.texts.join("\n");
    this.flushFn(conversationId, combined);
  }

  /** Clean up all pending timers (call on shutdown) */
  dispose(): void {
    for (const batch of this.pending.values()) {
      clearTimeout(batch.timer);
    }
    this.pending.clear();
  }
}
