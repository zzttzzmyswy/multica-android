import { describe, expect, it } from "vitest";
import { composerCanSubmit, composerSubmitMode } from "./composer-submit";

// Ports web `chat-input.tsx`'s submit-slot rule:
//
//   running={isRunning &&
//     (!allowSubmitWhileRunning || hasNothingToSend || gate.uploading)}
//   allowSubmitWhileRunning={pendingTask?.supports_queue === true}
//   submit guard: isRunning && !allowSubmitWhileRunning -> refuse
//
// i.e. a queue-capable run swaps the single action slot from Stop to
// "Queue message" as soon as the composer holds content, and only falls back
// to Stop when the composer is empty or an upload owns the slot. Servers that
// cannot accept follow-ups stay stop-only, so Stop never disappears on them.
describe("composer submit slot (web chat-input parity)", () => {
  const base = {
    isRunning: false,
    queueSendEnabled: false,
    hasContent: false,
    uploading: false,
  };

  describe("composerSubmitMode", () => {
    it("is a plain send while nothing is running", () => {
      expect(composerSubmitMode({ ...base, hasContent: true })).toBe("send");
      // Even with an empty composer: the arrow is the only slot, and the
      // disabled state — not a Stop button — is what stops the press.
      expect(composerSubmitMode(base)).toBe("send");
    });

    it("stays stop-only when the running task cannot accept a follow-up", () => {
      expect(
        composerSubmitMode({ ...base, isRunning: true, hasContent: true }),
      ).toBe("stop");
      expect(
        composerSubmitMode({
          ...base,
          isRunning: true,
          hasContent: true,
          queueSendEnabled: true,
          uploading: false,
        }),
      ).toBe("queue-send");
    });

    it("keeps Stop reachable on a queue-capable run with an empty composer", () => {
      // Web's `hasNothingToSend` term: an empty composer must still be able to
      // cancel, otherwise queue-capable runs would have no stop affordance.
      expect(
        composerSubmitMode({
          ...base,
          isRunning: true,
          queueSendEnabled: true,
          hasContent: false,
        }),
      ).toBe("stop");
    });

    it("keeps Stop reachable while an upload owns the slot", () => {
      // Web's `gate.uploading` term — an upload blocks submit, so falling back
      // to Stop keeps chat's only cancellation path on screen.
      expect(
        composerSubmitMode({
          ...base,
          isRunning: true,
          queueSendEnabled: true,
          hasContent: true,
          uploading: true,
        }),
      ).toBe("stop");
    });
  });

  describe("composerCanSubmit", () => {
    it("allows a queue send only when the run declares queue support", () => {
      const running = {
        ...base,
        isRunning: true,
        hasContent: true,
        queueSendEnabled: true,
      };
      expect(composerCanSubmit(running)).toBe(true);
      expect(composerCanSubmit({ ...running, queueSendEnabled: false })).toBe(
        false,
      );
    });

    it("refuses while disabled, submitting, uploading or empty", () => {
      const ready = {
        ...base,
        isRunning: true,
        hasContent: true,
        queueSendEnabled: true,
      };
      expect(composerCanSubmit({ ...ready, disabled: true })).toBe(false);
      expect(composerCanSubmit({ ...ready, submitting: true })).toBe(false);
      expect(composerCanSubmit({ ...ready, uploading: true })).toBe(false);
      expect(composerCanSubmit({ ...ready, hasContent: false })).toBe(false);
    });

    it("still allows a normal send while idle", () => {
      expect(composerCanSubmit({ ...base, hasContent: true })).toBe(true);
    });
  });
});
