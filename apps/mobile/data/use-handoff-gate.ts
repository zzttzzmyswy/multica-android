/**
 * The ONE gate every status-write and project-move surface goes through
 * (MUL-7420, MYS-2743).
 *
 * ## Why a gate and not four call sites
 *
 * The phone has four ways to move an issue into another column: the status
 * picker sheet, the board card's status sheet, the swimlane card's long-press
 * menu, and a drag onto a column. The desktop routes all of them through one
 * `WorkflowHandoffConfirmDialog`; if each mobile surface grew its own "should I
 * ask?" branch the first one edited would drift and the rest would keep
 * reassigning silently — the state this iteration removes. So the decision
 * lives here once and a surface only chooses what to do with the answer.
 *
 * The DECISIONS are in `lib/handoff-gate.ts` (should we ask at all) and
 * `lib/workflow-handoff.ts` (what the dialog shows). This file is the query and
 * state wiring between them, and it deliberately adds no rules of its own.
 *
 * ## The two writes this hook performs on the user's behalf
 *
 *   - `apply` — the pre-check is positive that no handoff is possible, so the
 *     write runs immediately.
 *   - `noHandoff` — the preview answered "nothing to hand off", which upstream
 *     also treats as "apply without asking" (the write still applies the
 *     workflow; only the confirmation is skipped).
 *
 * `failed` is neither. It reaches the dialog, which refuses to confirm.
 *
 * ## Why a withheld write still has an owner (the MYS-2743 regression)
 *
 * `refuse`, and a `confirm` the user cancels, perform no write — correctly.
 * But callers wrap work around the gate: the board's drop engages its settle
 * lock BEFORE calling in (it must — the mutation's settle invalidates the
 * queries) and releases it only from the mutation's `onSettled`. With no write
 * there is no settle, so those two outcomes used to strand the lock forever and
 * the board stopped following the server until the screen was re-entered.
 *
 * Two changes close that, and they are complementary:
 *
 *   1. Every held write carries an `onAbandon` hook. Cancel, replacement by a
 *      newer target, and unmount all fire it exactly once, so whatever a
 *      surface changed in anticipation of a write is put back.
 *   2. `refuse` now HOLDS the write and opens the sheet instead of returning
 *      silently. The sheet is already able to say "couldn't check" and offer
 *      Retry, which is both honest and the only outcome that is neither a
 *      guess nor an unannounced no-op. The write stays owned by the gate, so
 *      the abandon path covers it like any other.
 *
 * The bookkeeping lives in `lib/handoff-pending.ts` where it is unit-tested;
 * this file only drives it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { IssueWorkflow } from "@multica/core/types";
import { projectListOptions } from "@/data/queries/projects";
import { useIssueWorkflows } from "@/data/queries/workflows";
import { useHandoffPreview } from "@/data/queries/workflow-handoff";
import type { HandoffTarget } from "@/components/issue/workflow-handoff-dialog";
import { qualifiesForHandoffGate } from "@/lib/handoff-gate";
import { handoffStopPayload } from "@/lib/workflow-handoff";
import type { HandoffGateOutcome } from "@/lib/handoff-gate";
import {
  holdPending,
  planForOutcome,
  settlePending,
  type PendingWrite,
} from "@/lib/handoff-pending";
import { useWorkspaceStore } from "@/data/workspace-store";

export type { HandoffGateOutcome } from "@/lib/handoff-gate";

/** The issue fields the gate reads. A full `Issue` satisfies this. */
export interface GateIssue {
  id: string;
  identifier: string;
  status: string;
  project_id: string | null;
}

/** What a write receives: the control field to merge, or `{}` for none. */
export type HandoffControl = { stop_previous_assignee_runs?: true };

export interface HandoffGate {
  /** The target awaiting confirmation, or null when the sheet is closed. */
  pending: HandoffTarget | null;
  /** The preview for `pending`, with its read state. */
  preview: ReturnType<typeof useHandoffPreview>["preview"];
  readState: ReturnType<typeof useHandoffPreview>["state"];
  retry: () => void;
  cancel: () => void;
  /** Ask (or not) before writing. Returns what the pre-check decided. `abandon`
   *  is where the surface puts back anything it changed in anticipation of the
   *  write, and it runs exactly once if the write will not. */
  gate: (
    target: HandoffTarget,
    write: (control: HandoffControl) => void,
    options?: { onAbandon?: () => void },
  ) => HandoffGateOutcome;
  /** The dialog's confirm handler: runs the held write with the stop choice. */
  confirm: (options: { stopPreviousRuns: boolean }) => void;
}

export function useHandoffGate(
  issue: GateIssue | null | undefined,
  options: {
    /**
     * Called after ANY write this gate performs — the immediate apply, the
     * auto-applied no-handoff answer, and the user's confirmation.
     *
     * This exists because the picker surfaces are formSheet ROUTES: calling
     * `router.back()` inside `onChange` unmounts the route that hosts both the
     * gate's state and the dialog, so the write was cancelled with it (caught
     * on a real device — the status silently stayed put). They instead close
     * themselves from here, once the write has actually been issued. The board
     * and swimlane cards pass nothing: they are always mounted.
     */
    onWritten?: () => void;
  } = {},
): HandoffGate {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { workflows, state: workflowState } = useIssueWorkflows(wsId);
  const { data: projects } = useQuery(projectListOptions(wsId));
  const onWritten = options.onWritten;
  // Through a ref so `gate` does not change identity when a caller passes a
  // fresh arrow each render — that would re-register the board's card handle
  // on every render, the churn the handle exists to avoid.
  const onWrittenRef = useRef(onWritten);
  onWrittenRef.current = onWritten;

  const [pending, setPending] = useState<HandoffTarget | null>(null);
  // A ref, not state: the held write is invoked from a callback and never
  // rendered, and putting a function in state re-creates it on every render.
  const held = useRef<PendingWrite<HandoffControl> | null>(null);

  const previewInput = useMemo(
    () => ({
      issueId: issue?.id ?? null,
      status: pending?.kind === "status" ? pending.status : "",
      projectId: pending?.kind === "project" ? pending.projectId : null,
      enabled: !!pending,
    }),
    [issue?.id, pending],
  );
  const { preview, state: readState, refetch } = useHandoffPreview(previewInput);

  const cancel = useCallback(() => {
    setPending(null);
    // The tested decision — `settlePending` is where "cancelled" is defined to
    // abandon without running, so this cannot drift into the opposite. Read the
    // slot BEFORE clearing it, or the hook goes with it.
    const slot = held.current;
    held.current = null;
    settlePending(slot, "cancelled");
  }, []);

  /**
   * Unmount abandons whatever is still held.
   *
   * The board's card can be unmounted mid-confirmation (a filter change, a
   * lane hidden, a realtime update removing the row). Its settle lock lives in
   * the BOARD, which outlives the card, so without this the lock would outlive
   * the only object that could ever have released it.
   */
  useEffect(
    () => () => {
      const slot = held.current;
      held.current = null;
      settlePending(slot, "unmounted");
    },
    [],
  );

  const gate = useCallback<HandoffGate["gate"]>(
    (target, write, gateOptions) => {
      const outcome = qualifiesForHandoffGate({
        issue: issue ? { status: issue.status, project_id: issue.project_id } : null,
        target,
        workflows: workflows as readonly IssueWorkflow[] | undefined,
        workflowState,
        projects,
      });
      if (planForOutcome(outcome) === "write") {
        write({});
        onWrittenRef.current?.();
        return outcome;
      }
      // `confirm` on a loaded workflow, and `refuse` when the workflow read has
      // not answered. The second used to return here with nothing written and
      // nothing held; see the file header for what that cost. Both now open the
      // sheet, which tells the difference: on `refuse` the preview is disabled,
      // so the sheet sits in its "couldn't check" state with Retry and Confirm
      // disabled — the write is deferred, never applied on a guess.
      held.current = holdPending(held.current, {
        write,
        onAbandon: gateOptions?.onAbandon,
      });
      setPending(target);
      return outcome;
    },
    [issue, workflows, workflowState, projects],
  );

  const confirm = useCallback<HandoffGate["confirm"]>(
    ({ stopPreviousRuns }) => {
      const slot = held.current;
      const target = pending;
      // Clear the slot BEFORE the write: it is about to run, so a later unmount
      // must not abandon it and unlock lanes that are still moving.
      held.current = null;
      setPending(null);
      // The tested decision. `confirmed` runs the write and deliberately does
      // NOT fire the abandon hook — the write releases its own hold on settle,
      // and unlocking here would let the card jump back mid-flight.
      const settlement = settlePending(slot, "confirmed");
      if (!settlement.run || !target) return;
      // `handoffStopPayload` is the tested reducer for whether the flag applies
      // at all; `stopPreviousRuns` is the dialog's already-reduced answer.
      const payload = handoffStopPayload({
        // The dialog only confirms when the preview exists, so this narrowing
        // is safe and the reducer's own guards still apply.
        preview: preview ?? null,
        stop: stopPreviousRuns,
      });
      settlement.run(payload);
      onWrittenRef.current?.();
    },
    [pending, preview],
  );

  /**
   * Upstream's "preview says no handoff → apply it, don't bother the user".
   *
   * Run here rather than in the dialog so EVERY surface gets it: the sheet and
   * the board card otherwise would each have to remember, and the one that
   * forgot would leave a sheet open forever with nothing to say.
   *
   * An effect, not a render-phase branch: it performs the caller's write, which
   * is a side effect and would run twice under a double render. The `handled`
   * ref keeps it to once per pending target — without it the effect would
   * re-fire as `setPending(null)` lands.
   */
  const handled = useRef<HandoffTarget | null>(null);
  useEffect(() => {
    if (!pending || readState !== "ready" || !preview || preview.handoff) return;
    if (handled.current === pending) return;
    handled.current = pending;
    const slot = held.current;
    held.current = null;
    setPending(null);
    // Same path as a confirmation: it writes now, so nothing stays held.
    const settlement = settlePending(slot, "autoNoHandoff");
    // A no-handoff preview means there are no runs to stop, so the control
    // field is `{}` by construction — `handoffStopPayload` agrees, but this
    // path does not even ask.
    settlement.run?.({});
    // Only announce a write that actually happened: an empty slot (a double
    // render, or the sheet already dismissed) must not close the picker route
    // over a move nobody made.
    if (settlement.run) onWrittenRef.current?.();
  }, [pending, readState, preview]);

  return {
    pending,
    preview,
    readState,
    retry: refetch,
    cancel,
    gate,
    confirm,
  };
}
