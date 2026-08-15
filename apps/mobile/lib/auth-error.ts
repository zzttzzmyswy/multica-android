/**
 * Map backend auth errors to user-facing strings. The backend returns raw
 * English messages that are fine for logs but should not surface as-is —
 * we map the known shapes to friendlier copy and fall back to the caller's
 * default for anything unrecognised.
 */
export function mapAuthError(
  err: unknown,
  fallback: string,
  t: (id: string) => string,
): string {
  if (!(err instanceof Error)) return fallback;
  const msg = err.message.toLowerCase();
  if (/invalid|incorrect|wrong/.test(msg)) {
    return t("auth.codeMismatch");
  }
  if (/expired/.test(msg)) {
    return t("auth.codeExpired");
  }
  if (/rate.?limit|too many|throttle/.test(msg)) {
    return t("auth.tooManyAttempts");
  }
  if (/network|fetch|timeout|unreachable/.test(msg)) {
    return t("auth.networkError");
  }
  return fallback;
}
