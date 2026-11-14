/**
 * The held write behind the handoff gate: what to do with it, and the rule that
 * it can never be dropped silently (MYS-2743).
 *
 * ## The two defects this module exists to make impossible
 *
 * 1. **A withheld write stranded whatever its caller had already committed.**
 *    Only `apply` and a confirmed `confirm` reach the caller's `write`;
 *    `refuse` and a cancelled `confirm` perform no write — correctly. But every
 *    caller wraps work around the gate. On the board, `commitDrop` engages the
 *    `settledLaneIds` lock BEFORE calling into the gate (it must: the mutation's
 *    settle invalidates the list queries, and a lock engaged afterwards
 *    re-derives from a cache that has already moved the card) and releases it
 *    only from the mutation's `onSettled`. With no write there is no settle, so
 *    cancelling the sheet — or refusing at cold start — left the lock engaged
 *    forever. `laneIdsForRender` then returned the frozen frame for the rest of
 *    the screen's life: the board stopped following the server, new issues
 *    never appeared, and other members' moves never showed.
 *
 * 2. **A refused gate was an unannounced no-op.** The action sheet closed, the
 *    card snapped back, and nothing said why. The code claimed "the surface
 *    shows the same 'unverified' line the picker already uses" — no board or
 *    swimlane surface rendered it. This module's answer is not a new banner:
 *    a refusal now HOLDS the write and opens the sheet that already knows how
 *    to explain itself (checking / could-not-verify + Retry). The tap is
 *    deferred until the read answers, which is the one outcome that is neither
 *    silent nor a guess.
 *
 * ## Why a slot rather than a bare ref
 *
 * Three lifecycle events — RUN it, REPLACE it, DISCARD it — must stay
 * distinguishable, because abandoning twice is as wrong as never abandoning
 * (the board would release a lock a concurrent drop had just engaged). The slot
 * functions below make that mechanical: `abandonPending` returns `null` so the
 * caller stores emptiness directly, and `holdPending` abandons the incumbent
 * before installing the successor, so the previous holder always releases.
 *
 * Deliberately framework-free: `data/use-handoff-gate.ts` owns the React state,
 * this owns the bookkeeping, and the Node vitest lane can therefore drive every
 * branch without an RN renderer (see `vitest.config.ts`).
 */
import type { HandoffGateOutcome } from "@/lib/handoff-gate";

/** A write the gate is holding while the user decides. */
export interface PendingWrite<Control> {
  /** Run this to perform the move. Never called by this module. */
  write: (control: Control) => void;
  /**
   * Called exactly once when the write will NOT run: the user cancelled, a
   * newer target replaced this one, or the holding surface unmounted.
   *
   * This is where the board releases its settle lock and where any surface puts
   * back state it changed in anticipation of a write. Optional because the
   * picker surfaces hold nothing: they close in `onWritten`, which by
   * definition does not run for a withheld write, so they simply stay open.
   */
  onAbandon?: () => void;
}

/**
 * What the gate does with an outcome, as data rather than as three `if`s in the
 * hook — so the rule is testable without React.
 *
 *   - `write` — the write runs now, and no abandon hook is involved.
 *   - `ask` — the sheet opens holding the write; the user's answer decides
 *     between running it and abandoning it.
 *
 * There is deliberately no `discard` member. Before this module, `refuse` was
 * one, and it is exactly the branch that produced both defects: work held by
 * the caller with nothing to release it, and a tap the user could not
 * distinguish from a broken app.
 */
export type GatePlan = "write" | "ask";

export function planForOutcome(outcome: HandoffGateOutcome): GatePlan {
  // `apply` is the only positively-established "nothing hands off", and it is
  // the only outcome that may write without asking.
  return outcome === "apply" ? "write" : "ask";
}

/**
 * Install `next` as the only pending write, abandoning any incumbent.
 *
 * Two gestures while the sheet is open is a real sequence — tapping another
 * column from the board card's sheet, or dropping a second card. The incumbent
 * will never run, so whatever it was holding has to be released here or it
 * leaks into the second move.
 */
export function holdPending<Control>(
  current: PendingWrite<Control> | null,
  next: PendingWrite<Control>,
): PendingWrite<Control> {
  abandonPending(current);
  return next;
}

/**
 * Discard the pending write WITHOUT running it, firing its abandon hook.
 *
 * Returns `null` because callers store the result directly; handing the dead
 * write back would invite them to keep using a slot they have just declared
 * empty.
 *
 * A CONFIRMED move deliberately does not go through this: it takes the write
 * and clears the slot without firing the hook. Both paths must empty the slot,
 * but only the abandoned one may release what the write itself would have
 * released on settle — for the board, firing it on the confirm path would
 * unlock a drop that is still in flight and the card would jump back for a
 * frame, the exact reason the lock is taken before the mutation at all.
 */
export function abandonPending<Control>(
  current: PendingWrite<Control> | null,
): null {
  current?.onAbandon?.();
  return null;
}

/**
 * How a hold ends. Five ways, and the split between them is the whole point:
 * the first two RUN the write, the rest release what its holder had committed.
 */
export type PendingEnding =
  /** The user confirmed the sheet. */
  | "confirmed"
  /** The preview answered "no handoff", so upstream applies it silently. */
  | "autoNoHandoff"
  /** The user dismissed the sheet. */
  | "cancelled"
  /** A newer target replaced this one before either could be answered. */
  | "superseded"
  /** The surface holding it went away. */
  | "unmounted";

export interface PendingSettlement<Control> {
  /** Run this, exactly once. Null when the ending abandoned the write. */
  run: ((control: Control) => void) | null;
  /** Whether the abandon hook fired. True iff `run` is null AND a slot existed. */
  abandoned: boolean;
}

/**
 * End a hold, deciding between running the write and abandoning it.
 *
 * Extracted from `data/use-handoff-gate.ts` because this is the decision the
 * iteration got wrong, and it is the one decision that must never be wrong: a
 * held write either runs or releases its holder, and NOTHING must do both or
 * neither. `confirmed` is the interesting case — it deliberately abandons
 * nothing, because the write releases the holder itself when the mutation
 * settles (for the board, that is the same lock; unlocking here would let the
 * card jump back mid-flight).
 *
 * Note `autoNoHandoff` also runs without abandoning: that path writes
 * immediately, so it settles on its own exactly like a confirmation.
 */
export function settlePending<Control>(
  slot: PendingWrite<Control> | null,
  ending: PendingEnding,
): PendingSettlement<Control> {
  if (!slot) return { run: null, abandoned: false };
  if (ending === "confirmed" || ending === "autoNoHandoff") {
    return { run: slot.write, abandoned: false };
  }
  // cancelled / superseded / unmounted
  slot.onAbandon?.();
  return { run: null, abandoned: true };
}
