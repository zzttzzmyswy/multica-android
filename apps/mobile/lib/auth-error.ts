/**
 * Classify backend/transport errors into the buckets the auth screens care
 * about, and map them to user-facing strings. The backend returns raw
 * English messages that are fine for logs but should not surface as-is — we
 * map the known shapes to friendlier copy and fall back to the caller's
 * default for anything unrecognised.
 *
 * `classifyError` is the single source of truth for "is this a connectivity
 * failure?" — the auth screens use it to decide whether to offer the
 * custom-server recovery affordance, and `mapAuthError` uses it so the
 * wording and the affordance can never disagree.
 */

/** Messages that mean the request never reached a server that answered:
 *  RN's fetch rejection, our own timeout abort, and ApiError's status-0
 *  transport failures all land here. A 5xx from a reachable host is *not*
 *  a connection error — the server answered, so retrying the same host is
 *  the right move and switching servers is not. */
const OFFLINE_PATTERN = /network|fetch|timeout|timed out|unreachable|offline/;

export type ErrorClass = "offline" | "auth" | "other" | "unknown";

function errorMessage(err: unknown): string | null {
  if (err instanceof Error) return err.message.toLowerCase();
  return null;
}

function errorStatus(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

export function classifyError(err: unknown): ErrorClass {
  const msg = errorMessage(err);
  if (msg === null) return "unknown";
  if (errorStatus(err) === 0 || OFFLINE_PATTERN.test(msg)) return "offline";
  if (/invalid|incorrect|wrong|expired|rate.?limit|too many|throttle/.test(msg)) {
    return "auth";
  }
  if (errorStatus(err) !== null) return "other";
  return "unknown";
}

/** True when the failure was a transport/connectivity problem (the request
 *  never got an HTTP answer), as opposed to an HTTP error response. */
export function isConnectionError(err: unknown): boolean {
  return classifyError(err) === "offline";
}

export function mapAuthError(
  err: unknown,
  fallback: string,
  t: (id: string) => string,
): string {
  switch (classifyError(err)) {
    case "offline":
      return t("auth.networkError");
    case "auth": {
      const msg = errorMessage(err) ?? "";
      if (/expired/.test(msg)) return t("auth.codeExpired");
      if (/rate.?limit|too many|throttle/.test(msg)) {
        return t("auth.tooManyAttempts");
      }
      return t("auth.codeMismatch");
    }
    default:
      return fallback;
  }
}
