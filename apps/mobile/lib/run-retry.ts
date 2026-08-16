/**
 * Run-retry helpers — decide which terminal runs can be re-run and classify
 * a rerun failure for localization. Mirrors web's execution-log-section
 * (web packages/views/issues/components/execution-log-section.tsx:457,485)
 * and core's dispatchReasonCode (packages/core/api/client.ts:462).
 */

/** Which terminal run statuses allow a re-run. Web only retries runs that
 *  failed or were cancelled — a completed run is not re-runnable
 *  (web execution-log-section.tsx:457). */
export function canRerunRun(status: string): boolean {
  return status === "failed" || status === "cancelled";
}

/**
 * True for a structured 403 "invocation_not_allowed" — the operator lacks
 * invoke permission on the run's agent (MUL-4525). Any other error shape
 * (network failure, generic 4xx/5xx, non-JSON 403) reads as false so the
 * caller falls back to the generic failure message.
 *
 * Duck-typed on `{status, body}` rather than `instanceof ApiError` so the
 * helper stays importable in the Node vitest lane without pulling the whole
 * api module graph (native module mocks) into a lib/ test.
 */
export function isInvocationBlocked(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: unknown; body?: unknown };
  if (typeof e.status !== "number" || e.status !== 403) return false;
  if (!e.body || typeof e.body !== "object") return false;
  return (
    (e.body as { reason_code?: unknown }).reason_code ===
    "invocation_not_allowed"
  );
}