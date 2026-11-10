/**
 * The gate's held-write bookkeeping (MYS-2743).
 *
 * Every case here is a regression test for a defect that shipped in the
 * iteration this module was extracted from: a withheld write stranded the
 * board's settle lock, and a refusal was an unannounced no-op. Both reduce to
 * one question per outcome — does anything run, and does anything get
 * released — so that is what these tests pin.
 */
import { describe, expect, it, vi } from "vitest";
import {
  abandonPending,
  holdPending,
  planForOutcome,
  settlePending,
  type PendingWrite,
} from "./handoff-pending";

function pending(control = "ctrl"): {
  slot: PendingWrite<string>;
  write: ReturnType<typeof vi.fn>;
  onAbandon: ReturnType<typeof vi.fn>;
} {
  const write = vi.fn();
  const onAbandon = vi.fn();
  return { slot: { write, onAbandon }, write, onAbandon };
}

describe("planForOutcome", () => {
  it("writes immediately only for the positively-established no-handoff", () => {
    expect(planForOutcome("apply")).toBe("write");
  });

  it("asks before writing when a handoff is possible", () => {
    expect(planForOutcome("confirm")).toBe("ask");
  });

  it("ASKS rather than discards when the workflow read has not answered", () => {
    // The defect: `refuse` used to be a third plan that wrote nothing AND held
    // nothing, so the caller's already-engaged lock had no owner and never
    // released. Asking is what makes the tap recoverable — the sheet opens in
    // its "couldn't check" state and offers Retry, instead of the tap doing
    // visibly nothing.
    expect(planForOutcome("refuse")).toBe("ask");
    // Stated as a set so a future fourth outcome cannot silently default to a
    // plan that neither writes nor holds.
    const plans = new Set(
      (["apply", "confirm", "refuse"] as const).map(planForOutcome),
    );
    expect(plans).toEqual(new Set(["write", "ask"]));
  });
});

describe("abandonPending", () => {
  it("fires the abandon hook so a caller's held state is released", () => {
    const { slot, write, onAbandon } = pending();
    abandonPending(slot);
    expect(onAbandon).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
  });

  it("returns null so the caller stores emptiness, not a dead write", () => {
    const { slot } = pending();
    expect(abandonPending(slot)).toBeNull();
  });

  it("is a no-op on an empty slot (a second cancel must not release twice)", () => {
    // The board's cancel can be reached twice — the backdrop and the Cancel
    // button both route to it, and a `null` slot on the second press must not
    // throw or, worse, reach some other holder's hook.
    expect(abandonPending(null)).toBeNull();
    expect(() => abandonPending(null)).not.toThrow();
  });

  it("tolerates a write that carries no abandon hook", () => {
    // The picker routes hold nothing: they close themselves in `onWritten`,
    // which by definition never runs for a withheld write.
    const write = vi.fn();
    expect(() => abandonPending({ write })).not.toThrow();
  });
});

describe("holdPending", () => {
  it("abandons the incumbent before installing the successor", () => {
    // A second gesture while the sheet is open: the first write will never
    // run, so whatever it was holding has to be released NOW or it leaks into
    // the second move — on the board, two stranded lanes instead of one.
    const first = pending();
    const second = pending();
    const installed = holdPending(first.slot, second.slot);
    expect(first.onAbandon).toHaveBeenCalledTimes(1);
    expect(first.write).not.toHaveBeenCalled();
    expect(second.onAbandon).not.toHaveBeenCalled();
    expect(installed).toBe(second.slot);
  });

  it("installs into an empty slot without firing anything", () => {
    const first = pending();
    expect(holdPending(null, first.slot)).toBe(first.slot);
    expect(first.onAbandon).not.toHaveBeenCalled();
    expect(first.write).not.toHaveBeenCalled();
  });
});

describe("settlePending", () => {
  it("RUNS a confirmed write and does NOT abandon it", () => {
    // The board's confirm path: the write is in flight and will release the
    // lane lock on settle. Firing abandon here unlocks a drop mid-flight and
    // the card jumps back for a frame — the race the lock exists to prevent.
    const { slot, write, onAbandon } = pending();
    const out = settlePending(slot, "confirmed");
    expect(out.abandoned).toBe(false);
    expect(onAbandon).not.toHaveBeenCalled();
    out.run?.("stop");
    expect(write).toHaveBeenCalledWith("stop");
  });

  it("RUNS an auto-applied no-handoff write, also without abandoning", () => {
    // Same shape: this path writes immediately, so nothing is left held.
    const { slot, write, onAbandon } = pending();
    const out = settlePending(slot, "autoNoHandoff");
    expect(out.abandoned).toBe(false);
    expect(onAbandon).not.toHaveBeenCalled();
    out.run?.("ctrl");
    expect(write).toHaveBeenCalledTimes(1);
  });

  it.each(["cancelled", "superseded", "unmounted"] as const)(
    "ABANDONS without running on %s",
    (ending) => {
      // Every ending that does not write must release the holder, or the board
      // keeps a frozen lane order forever. Parametrised because all three reach
      // it through different code paths and the first version of this fix
      // covered only `cancelled`.
      const { slot, write, onAbandon } = pending();
      const out = settlePending(slot, ending);
      expect(out.abandoned).toBe(true);
      expect(out.run).toBeNull();
      expect(onAbandon).toHaveBeenCalledTimes(1);
      expect(write).not.toHaveBeenCalled();
    },
  );

  it("does neither for an empty slot", () => {
    // A second cancel (backdrop + button) must not throw or reach another
    // holder's hook.
    expect(settlePending(null, "cancelled")).toEqual({ run: null, abandoned: false });
    expect(settlePending(null, "confirmed")).toEqual({ run: null, abandoned: false });
  });

  it("never does both, for ANY ending", () => {
    // The invariant, stated directly: exactly one of {run, abandon}.
    const endings = [
      "confirmed",
      "autoNoHandoff",
      "cancelled",
      "superseded",
      "unmounted",
    ] as const;
    for (const ending of endings) {
      const { slot } = pending();
      const out = settlePending(slot, ending);
      expect(Boolean(out.run)).toBe(!out.abandoned);
    }
  });
});
