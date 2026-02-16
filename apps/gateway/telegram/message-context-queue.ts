export interface MessageContext {
  telegramChatId: number;
  telegramMessageId: number;
}

/**
 * Tracks inbound Telegram messages per device and pairs them with outbound agent runs.
 *
 * Why queue + active?
 * - Pending queue preserves arrival order for rapid-fire user messages.
 * - Active context binds the currently running agent response to exactly one message.
 */
export class MessageContextQueue {
  private readonly pending = new Map<string, MessageContext[]>();
  private readonly active = new Map<string, MessageContext>();

  enqueue(deviceId: string, context: MessageContext): void {
    const queue = this.pending.get(deviceId);
    if (queue) {
      queue.push(context);
      return;
    }
    this.pending.set(deviceId, [context]);
  }

  /**
   * Bind the next pending context to the active run for this device.
   * If a run is already active, keep it unchanged.
   */
  activate(deviceId: string): MessageContext | undefined {
    const current = this.active.get(deviceId);
    if (current) return current;

    const queue = this.pending.get(deviceId);
    if (!queue || queue.length === 0) return undefined;

    const next = queue.shift();
    if (queue.length === 0) {
      this.pending.delete(deviceId);
    }
    if (next) {
      this.active.set(deviceId, next);
    }
    return next;
  }

  /**
   * Get the context to use for outbound sends.
   * Prefer active run context; otherwise fall back to oldest pending.
   */
  peekForSend(deviceId: string): MessageContext | undefined {
    const current = this.active.get(deviceId);
    if (current) return current;

    const queue = this.pending.get(deviceId);
    return queue?.[0];
  }

  /**
   * Release one context after a run completes/errors.
   * Prefer active context; if none active, release oldest pending.
   */
  release(deviceId: string): MessageContext | undefined {
    const current = this.active.get(deviceId);
    if (current) {
      this.active.delete(deviceId);
      return current;
    }

    const queue = this.pending.get(deviceId);
    if (!queue || queue.length === 0) return undefined;

    const next = queue.shift();
    if (queue.length === 0) {
      this.pending.delete(deviceId);
    }
    return next;
  }
}
