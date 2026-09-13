/**
 * Which action the composer's single trailing slot offers while a chat run is
 * in flight — ports the rule web's `chat-input.tsx` encodes in its
 * `SubmitButton` props:
 *
 *   running={isRunning &&
 *     (!allowSubmitWhileRunning || hasNothingToSend || gate.uploading)}
 *   allowSubmitWhileRunning={pendingTask?.supports_queue === true}
 *
 * A queue-capable run reuses Stop's slot for "Queue message" the moment the
 * composer holds content, so a follow-up can be enqueued without cancelling
 * the current turn. It falls back to Stop when:
 *
 *   - the current task cannot accept follow-ups (`supports_queue !== true`) —
 *     older servers would just reject the message, and Stop must not vanish;
 *   - the composer is empty — otherwise a queue-capable run would have no
 *     cancellation affordance at all;
 *   - an attachment is still uploading — an upload blocks submit, so the slot
 *     has to stay on the cancellation path.
 *
 * Pure logic only: the composer renders from this, the vitest lane exercises
 * every branch without React Native.
 */
export type ComposerSubmitMode = "send" | "queue-send" | "stop";

export interface ComposerSubmitInput {
  /** A task is in flight for the active chat session. */
  isRunning: boolean;
  /** `pendingTask.supports_queue === true` — the server takes follow-ups. */
  queueSendEnabled: boolean;
  /** Draft text or mention chips are present. */
  hasContent: boolean;
  /** An attachment upload has not settled yet. */
  uploading: boolean;
}

export function composerSubmitMode(input: ComposerSubmitInput): ComposerSubmitMode {
  if (!input.isRunning) return "send";
  if (!input.queueSendEnabled) return "stop";
  if (input.uploading) return "stop";
  if (!input.hasContent) return "stop";
  return "queue-send";
}

export interface ComposerSubmitGate extends ComposerSubmitInput {
  /** The composer is hard-disabled (no usable agent, archived session, …). */
  disabled?: boolean;
  /** A send is already being committed. */
  submitting?: boolean;
}

/**
 * Whether pressing the slot may commit. Mirrors web's button `disabled` prop
 * plus the guard `submit()` re-reads for the keyboard path: while a run is in
 * flight, only a queue-capable run accepts a submit.
 */
export function composerCanSubmit(input: ComposerSubmitGate): boolean {
  if (input.disabled || input.submitting || input.uploading) return false;
  if (!input.hasContent) return false;
  if (input.isRunning && !input.queueSendEnabled) return false;
  return true;
}
