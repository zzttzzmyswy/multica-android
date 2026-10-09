/**
 * The decisions a wakeup rule's controls read (MYS-2031).
 *
 * MYS-2023 put the wakeup rules ON the phone — a reader could finally see that
 * an issue was waiting on something. This round makes them actionable. Every
 * control that acts on a rule (the enable/disable switch, "withdraw",
 * "enable again", "set a new time", "wake now", "edit prompt", "delete") needs
 * the same three facts before it can be drawn:
 *
 *   1. WHICH control this row gets. Web draws one of four, chosen by
 *      `wakeup-control.tsx:55-105`, and the branch order is load-bearing: a
 *      spent one-shot shows "enable again", not a switch reading "off", and an
 *      expired time rule shows a date picker, because re-enabling it without a
 *      new time is a server-side 400.
 *   2. Whether it can be pressed.
 *   3. When it is not pressable, WHY — so the row can say it instead of
 *      rendering a dead control.
 *
 * This module is pure and free of React and React Native, for the same reason
 * `lib/wakeup-presentation.ts` is: `vitest.config.ts` runs a Node-only lane
 * with no renderer, so a decision written inside JSX cannot be tested at all.
 * It is also this round's must-agree point with web — same rule JSON, same run
 * status, same verdict — and the divergences from web are each called out
 * below with the defect they close.
 *
 * Every predicate is ported from web's `wakeup-control.tsx` /
 * `wakeup-presentation.ts` rather than re-derived, so the two clients cannot
 * drift into disagreeing about whether a switch is live.
 */
import type { AgentTask, IssueWakeup } from "@multica/core/types";
import { isActiveWakeupRun } from "./wakeup-presentation";

/**
 * A wakeup as every read on this side of the wire hands it over.
 *
 * The workspace table's rows (`WorkspaceWakeup`) carry no `instruction` —
 * the endpoint does not send it (`data/schemas.ts`) — while the issue-level
 * reads do. Every predicate below reads only lifecycle fields, so widening
 * the parameter to the `Omit` lets both surfaces share one implementation
 * instead of the table re-deriving "can this be switched off" for itself.
 * Web types the same helpers against `Omit<IssueWakeup, "instruction">`.
 */
type WakeupLike = Omit<IssueWakeup, "instruction">;

/** The server's own ceilings, read from the Go source rather than guessed:
 *  `issue_wakeup.go:287` (`instruction must be 1–12000 bytes`) and
 *  `issue_wakeup_system.go:34` (`MaxSystemWakeupInstruction = 4000`). Both are
 *  BYTE counts — a Chinese prompt is three bytes a character, so measuring in
 *  characters would let the client send a body the server answers 400 to. */
export const WAKEUP_INSTRUCTION_MAX_BYTES = 12_000;
export const WAKEUP_SYSTEM_INSTRUCTION_MAX_BYTES = 4_000;

/** UTF-8 length of `text`, without pulling `TextEncoder` into a module the
 *  Node lane loads (Hermes ships it, but this keeps the function total and
 *  dependency-free). A lone surrogate encodes as U+FFFD — three bytes — which
 *  is what the server counts too. */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    bytes +=
      code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  // `for…of` walks code points, so a lone surrogate arrives as itself rather
  // than as a pair; the encoder would write a replacement character for it.
  return bytes;
}

/**
 * The run facts a control branches on.
 *
 * Web reads `task?.status ?? wakeup.last_task_status` in five places, and the
 * `started_at` of the task when there is one. Both live here so no call site
 * can pick up half the rule — which is how a "withdraw" button once appeared
 * for a run that had already started.
 */
export interface WakeupRunFacts {
  /** The run's status: the task's if there is one, else `last_task_status`. */
  status: string | null;
  /** When the run started, or null while it is only enqueued. A run with no
   *  task behind it counts as unstarted, matching web's `!task?.started_at`. */
  startedAt: string | null;
}

/** Fold a rule and its run into the facts the controls read. */
export function wakeupRunFacts(
  wakeup: WakeupLike,
  task?: AgentTask,
): WakeupRunFacts {
  return {
    status: task?.status ?? wakeup.last_task_status ?? null,
    startedAt: task?.started_at ?? null,
  };
}

/**
 * Whether the rule can be switched off right now.
 *
 * Two ways, and the second is web's: the rule is live, OR it is already off but
 * its run is only QUEUED/DEFERRED and has not started. The second case is the
 * "withdraw" affordance — the run is enqueued and nothing has begun, so
 * stopping the rule still stops it, and the user needs a control that says so.
 *
 * A rule the platform already switched off (`disabled_at`) is excluded: there
 * is nothing left to stop, and leaving it pressable would send a redundant
 * write on every tap.
 */
export function canDisableWakeup(
  wakeup: WakeupLike,
  facts: WakeupRunFacts,
): boolean {
  return (
    !wakeup.disabled_at &&
    (wakeup.enabled ||
      (["queued", "deferred"].includes(facts.status ?? "") &&
        !facts.startedAt))
  );
}

/**
 * Whether a one-shot rule has already been spent.
 *
 * `!disabled_at || last_task_id` is web's, and the two halves mean different
 * things: a one-shot the platform or a person switched off before it fired was
 * never used (no `disabled_at`, no run) — re-enabling it is a plain resume. One
 * that fired and was then switched off was consumed, and the server refuses to
 * re-enable it without an explicit `rearm` ("consumed one-shot requires
 * explicit rearm").
 */
export function isConsumedWakeup(wakeup: WakeupLike): boolean {
  return (
    !wakeup.enabled &&
    wakeup.mode === "once" &&
    (!wakeup.disabled_at || !!wakeup.last_task_id)
  );
}

/**
 * Whether a single-time rule's deadline has passed.
 *
 * A missing `next_fire_at` counts as expired, which is web's reading and the
 * safe one: an `at` rule with no deadline can never fire, so offering "enable
 * again" would send an enable the server rejects with "choose a future time".
 */
export function isExpiredWakeup(wakeup: WakeupLike, now = Date.now()): boolean {
  return (
    wakeup.kind === "at" &&
    (!wakeup.next_fire_at ||
      Date.parse(wakeup.next_fire_at) <= now)
  );
}

/**
 * Whether re-enabling this rule means "start over" rather than "resume".
 *
 * A rearm restarts a relative wait from now and is what the server demands for
 * a consumed one-shot; sending it for a rule that is merely paused would
 * silently move its deadline.
 */
export function needsWakeupRearm(wakeup: WakeupLike, now = Date.now()): boolean {
  return (
    !wakeup.enabled && (isConsumedWakeup(wakeup) || isExpiredWakeup(wakeup, now))
  );
}

/** What an enable is gated on. */
export interface WakeupEnableGate {
  /** A closed issue cannot hold a rule: the server disables them all on close
   *  and refuses to create or enable one ("issue is closed"). */
  closed: boolean;
  status?: string | null;
  startedAt?: string | null;
}

/**
 * Whether the rule can be turned on right now.
 *
 * Web's gate, unchanged: a closed issue never enables, and a run still in
 * flight blocks the enable UNLESS the rule is continuous. The continuous
 * exception is not a loophole — a continuous rule is meant to fire again, so it
 * is not racing its own run. The server enforces the same rule and answers a
 * 409 for the ones this refuses ("previous run is still active").
 */
export function canEnableWakeup(
  wakeup: WakeupLike,
  gate: WakeupEnableGate,
): boolean {
  return (
    !gate.closed &&
    (!isActiveWakeupRun(gate.status ?? undefined) ||
      wakeup.mode === "continuous")
  );
}

/** Why a control is not pressable. `null` means it is. */
export type WakeupControlBlock =
  | "pending"
  | "closed"
  | "active_run"
  | "revision";

/** The control a row draws, and whether it can be pressed. */
export interface WakeupControlState {
  kind: "switch" | "withdraw" | "resubscribe" | "reschedule";
  /** `switch` only: the state the toggle shows. */
  checked: boolean;
  disabled: boolean;
  blocked: WakeupControlBlock | null;
  /**
   * The revision an enable must send, or null when enabling is not on offer.
   *
   * This exists so the call site cannot invent one. Web sends
   * `revision ?? 0` and the server answers "revision is required" — a 400 the
   * user can do nothing about. Returning the fence from the decision layer, as
   * a value the caller spreads rather than a field it reads, makes that
   * mistake unwritable: when the revision is unusable, `disabled` is true AND
   * this is null, so both halves agree and there is no `??` to get wrong.
   */
  enableRevision: number | null;
}

export interface WakeupControlInput {
  wakeup: WakeupLike;
  status?: string | null;
  startedAt?: string | null;
  closed?: boolean;
  /** A write for this rule is in flight. */
  pending?: boolean;
  now?: number;
}

/**
 * The one control this row gets, and its availability.
 *
 * Branch order is web's, and every step of it matters:
 *
 *   1. `enabled || (!needsRearm && !canDisable)` → the switch. A live rule
 *      always gets one (so it can be stopped), and so does a rule that is off
 *      for a reason a toggle can express — a continuous rule the user paused.
 *   2. `canDisable` → "withdraw". The rule is off but its run is enqueued and
 *      unstarted; a switch reading "off" would hide a run that is on its way.
 *   3. `kind === "at"` → "set a new time". Enabling a time rule needs a time.
 *   4. otherwise → "enable again", the rearm path.
 *
 * DIVERGENCE FROM WEB, deliberate: web sends `revision ?? 0` when enabling, so
 * a rule whose revision could not be read produces a request the server rejects
 * with "revision is required" — a 400 with no recovery. This refuses up front
 * and reports `blocked: "revision"`, so the row can say the rule needs a
 * refresh instead of failing after the tap. Cycling the rule OFF never needs a
 * revision (the disable endpoint takes no body), so a rule with an unreadable
 * revision stays switchable-off: stopping a misbehaving rule is the one action
 * that must not be gated on data the client failed to read.
 */
export function wakeupControlState({
  wakeup,
  status = null,
  startedAt = null,
  closed = false,
  pending = false,
  now = Date.now(),
}: WakeupControlInput): WakeupControlState {
  const facts: WakeupRunFacts = { status, startedAt };
  // Web's `canDisable`: a live rule, or one already off whose run is merely
  // queued — except a rule the platform switched off, which has nothing left
  // to stop.
  const withdrawable = canDisableWakeup(wakeup, facts);
  const rearm = needsWakeupRearm(wakeup, now);
  const enable = canEnableWakeup(wakeup, { closed, status, startedAt });

  const kind: WakeupControlState["kind"] =
    wakeup.enabled || (!rearm && !withdrawable)
      ? "switch"
      : withdrawable
        ? "withdraw"
        : wakeup.kind === "at"
          ? "reschedule"
          : "resubscribe";

  // Web gates each branch differently, and the differences are the point:
  //   - "withdraw" is gated on `pending` ALONE. The run is enqueued and
  //     unstarted; withdrawing it is the one action that gets the user out of a
  //     rule they just switched off, so nothing else may block it.
  //   - a switch sitting ON is gated on `pending` alone too — stopping a live
  //     rule must not depend on the rule's own run state.
  //   - every path that turns a rule ON (switch flipped on, reschedule,
  //     resubscribe) is additionally gated on the enable gate, and here also on
  //     a usable revision.
  const needsRevision = kind !== "withdraw" && !wakeup.enabled;
  const revision = wakeup.revision ?? 0;
  const revisionUsable = revision >= 1;
  const blocked: WakeupControlBlock | null = pending
    ? "pending"
    : kind === "withdraw" || (kind === "switch" && wakeup.enabled)
      ? null
      : !revisionUsable
        ? "revision"
        : closed
          ? "closed"
          : !enable
            ? "active_run"
            : null;

  return {
    kind,
    checked: wakeup.enabled,
    disabled: blocked !== null,
    blocked,
    // Offered only alongside an enable the row can actually send. A caller that
    // spreads this into an enable call cannot produce web's `revision ?? 0`
    // 400, because the value is null exactly when the control is inert.
    enableRevision: needsRevision && blocked === null ? revision : null,
  };
}

/**
 * The i18n id to show for a rejected prompt edit, or null when it is fine.
 *
 * `wakeups.instructionInvalid` is an existing catalog key (MYS-2023's read
 * round added the copy); this only decides WHEN it applies. Empty is invalid
 * because the server trims and then refuses an empty body, so sending one is a
 * guaranteed 400 rather than a way to clear the field.
 */
export function wakeupInstructionErrorKey(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return "wakeups.instructionInvalid";
  return utf8ByteLength(trimmed) > WAKEUP_INSTRUCTION_MAX_BYTES
    ? "wakeups.instructionInvalid"
    : null;
}

/**
 * The same decision for the platform rule, whose limit is smaller and whose
 * empty value is MEANINGFUL.
 *
 * Clearing a system instruction means "go back to the default", so empty is
 * accepted here where it is refused above. Sharing one validator between the
 * two would either make the default unreachable or send the server a 400.
 */
export function wakeupSystemInstructionErrorKey(text: string): string | null {
  const trimmed = text.trim();
  return utf8ByteLength(trimmed) > WAKEUP_SYSTEM_INSTRUCTION_MAX_BYTES
    ? "wakeups.system.instructionInvalid"
    : null;
}

/**
 * The line to show for a failed wakeup write.
 *
 * Web's `error()` classifier (`wakeup-presentation.ts:342-352`), plus the
 * duck-typing discipline the rest of mobile's write path uses
 * (`lib/write-failure.ts`): a `status` is only read when it is a number, so a
 * body carrying `"403"` as a string is not mistaken for an authorization
 * failure.
 *
 * A 409 is the one failure with a real recovery — the rule moved under the
 * editor, so refreshing fixes it — and a 403 is the one the user cannot fix by
 * retrying. Everything else keeps the caller's line, which names the action.
 */
export function wakeupWriteErrorKey(error: unknown, fallbackKey: string): string {
  const status =
    error && typeof error === "object"
      ? (error as { status?: unknown }).status
      : undefined;
  if (status === 403) return "wakeups.permissionError";
  if (status === 409) return "wakeups.conflictError";
  return fallbackKey;
}

/**
 * Whether the caller should re-read the rule after a failed write.
 *
 * Only a 409 means the row on screen is out of date: another editor, or the
 * server's own tick, moved the rule's revision. Refreshing is the fix, and the
 * alert says so (`wakeups.conflictError`). Retrying a 403 or a network failure
 * against the same data would just fail the same way, so those leave the row
 * alone — nothing about it is known to be stale.
 */
export function wakeupWriteNeedsRefresh(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { status?: unknown }).status === 409
  );
}

/**
 * The instant a picked local day + clock time names, as the RFC3339 string the
 * enable endpoint's `at` field takes.
 *
 * The picker hands back a day and an "HH:MM" pair from two native dialogs
 * (Android's date and time pickers are separate controls — `mode="datetime"` is
 * iOS-only), so the two have to be recombined in LOCAL time, which is what the
 * person who picked them meant. `new Date(y, m, d, h, min)` does that; building
 * from an ISO date-only string would silently read as UTC and move the wakeup by
 * the viewer's offset.
 */
export function rescheduleInstant(
  day: Date,
  hours: number,
  minutes: number,
): Date {
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    hours,
    minutes,
    0,
    0,
  );
}

/**
 * Whether a chosen instant is one the server will accept.
 *
 * The server refuses an `at` enable that is not strictly in the future
 * ("choose a future time", `issue_wakeup.go:434`), and web checks the same
 * before sending (`wakeup-control.tsx` RescheduleWakeup). Refusing here turns a
 * 400 into a field error on the sheet the user is still looking at.
 */
export function isFutureWakeupTime(at: Date, now = Date.now()): boolean {
  return Number.isFinite(at.getTime()) && at.getTime() > now;
}
