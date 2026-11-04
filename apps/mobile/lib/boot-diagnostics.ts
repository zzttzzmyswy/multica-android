/**
 * Crash-survivable boot breadcrumbs (MYS-2582).
 *
 * The 0.6.122 report was "installs, then immediately closes, and there is no
 * log to send". That combination has a specific cause on Android: a JS error
 * thrown from MODULE TOP-LEVEL code — before any React tree exists — kills the
 * bundle while the splash is still up. With no red box in a release build and
 * no user-facing surface, the user sees a close and has nothing to report.
 *
 * `console.log` does not help, because the user cannot run `adb logcat`. So the
 * breadcrumbs go to a FILE in the app's private dir, which survives the crash:
 *
 *   - `markBootStep` writes a marker before each risky boot stage.
 *   - `markBootComplete` clears it once the root layout has painted.
 *   - On the next cold start, a marker still present means the previous run
 *     died inside that stage, and `readPreviousBootFailure()` returns it.
 *
 * Everything here is best-effort and must NEVER throw: a diagnostics helper
 * that can itself crash the app is worse than no diagnostics. Every call is
 * wrapped, every failure is swallowed.
 */
import { Directory, File, Paths } from "expo-file-system";

/** Marker file. Absent = the last boot either finished or never started. */
const BOOT_STEP_FILE = "boot-step.txt";

/**
 * The stage the CURRENT process has reached.
 *
 * Deliberately in-memory rather than re-read from disk: once a crash is in
 * flight the filesystem may already be unavailable, and this value is only
 * used to annotate an error that is about to be displayed. `null` before the
 * first `markBootStep` of this process.
 */
let currentStep: string | null = null;

export function readCurrentBootStep(): string | null {
  return currentStep;
}

function bootStepFile(): File {
  return new File(Paths.document, BOOT_STEP_FILE);
}

/**
 * Record that boot has reached `step`.
 *
 * Synchronous write on purpose: the whole point is that the marker is on disk
 * BEFORE the next statement runs, so a crash in that statement is attributable.
 * The file is a few dozen bytes; the cost is irrelevant next to a cold start.
 */
export function markBootStep(step: string): void {
  currentStep = step;
  try {
    bootStepFile().write(step);
  } catch {
    // Private dir unwritable / module missing: diagnostics degrade to nothing,
    // the app keeps booting normally.
  }
}

/** Boot finished (root layout mounted). Clears the marker. */
export function markBootComplete(): void {
  try {
    const file = bootStepFile();
    if (file.exists) file.delete();
  } catch {
    // See markBootStep.
  }
}

/**
 * The step the PREVIOUS boot died in, or null when the previous boot completed
 * (or never recorded anything). Read-only: does not clear the marker, so a
 * crash loop keeps reporting the same step until a boot finally succeeds.
 */
export function readPreviousBootFailure(): string | null {
  try {
    const file = bootStepFile();
    if (!file.exists) return null;
    const step = file.textSync().trim();
    return step === "" ? null : step;
  } catch {
    return null;
  }
}

/** Directory used for breadcrumbs. Exposed for tests and the About screen. */
export function bootDiagnosticsDir(): Directory {
  return Paths.document;
}
