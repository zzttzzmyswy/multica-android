/**
 * Last-resort error capture for release builds (MYS-2582).
 *
 * A release build has no red box. When JS throws outside React's tree — a
 * module top-level failure, an async error with no catch, a native-module
 * call that explodes during boot — the bridge tears the app down and the user
 * sees an instant close with nothing to report. That is precisely the 0.6.122
 * report: "it closes, and there is no log".
 *
 * `installGlobalErrorCapture()` hooks `ErrorUtils.setGlobalHandler`, which is
 * the one funnel EVERY uncaught JS error passes through (RN's own dev red box
 * is built on top of the same hook). We:
 *
 *   1. record the error to a file (guarded — see lib/boot-diagnostics.ts), and
 *   2. hand it to a listener that can render it on screen.
 *
 * The listener is registered by the root layout. Until one is registered the
 * error is only recorded, so a very early failure still leaves a breadcrumb
 * instead of vanishing.
 *
 * The previous handler is always preserved and always called: swallowing an
 * error here would hide real crashes from every other consumer (Sentry-style
 * reporters, RN's own logging), which is worse than the problem being solved.
 */
import { markBootStep, readCurrentBootStep } from "./boot-diagnostics";

export interface CapturedError {
  message: string;
  stack?: string;
  isFatal: boolean;
  /** Boot stage recorded when the error arrived, when available. */
  bootStep?: string;
}

type Listener = (error: CapturedError) => void;

let listener: Listener | null = null;
let installed = false;

/** Register the UI that renders a captured fatal error. Returns an unsubscribe. */
export function setCapturedErrorListener(next: Listener | null): () => void {
  listener = next;
  return () => {
    if (listener === next) listener = null;
  };
}

function describe(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) {
    return { message: err.message || err.name || "Unknown error", stack: err.stack };
  }
  if (typeof err === "string") return { message: err };
  try {
    return { message: JSON.stringify(err) };
  } catch {
    return { message: String(err) };
  }
}

interface ErrorUtilsLike {
  setGlobalHandler?: (fn: (error: unknown, isFatal?: boolean) => void) => void;
  getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
}

/**
 * Install the global handler once. Idempotent — the root layout may remount
 * (fast refresh, provider reset) and a chain of handlers would multiply the
 * recording.
 */
export function installGlobalErrorCapture(): void {
  if (installed) return;
  const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (!errorUtils?.setGlobalHandler) return;
  installed = true;

  const previous = errorUtils.getGlobalHandler?.();

  errorUtils.setGlobalHandler((error, isFatal) => {
    const { message, stack } = describe(error);
    const captured: CapturedError = { message, stack, isFatal: isFatal === true };

    // Record first: if the app is about to die, the file is the only artefact
    // that survives. Guarded so diagnostics can never mask the real error.
    try {
      captured.bootStep = readCurrentBootStep() ?? undefined;
      markBootStep(`js-error: ${message}`);
    } catch {
      // Diagnostics unavailable — the screen path below still runs.
    }

    try {
      listener?.(captured);
    } catch {
      // A broken listener must not stop the app's own handler.
    }

    // Always delegate. Dropping this call would make every other consumer
    // (including RN's own fatal handling) blind to the error.
    previous?.(error, isFatal);
  });
}

/** Test seam: reset the installed flag. Not used by app code. */
export function __resetGlobalErrorCaptureForTests(): void {
  installed = false;
  listener = null;
}
