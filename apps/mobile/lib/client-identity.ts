/**
 * Client identity headers for every mobile HTTP request.
 *
 * The server records these per request (`server/internal/middleware/client.go`)
 * and reads them as analytics / feedback metadata — `handler/feedback.go`,
 * `handler/onboarding.go`, `handler/chat.go`'s instrumentation, and the request
 * logger. They were hard-coded to `ios` / `0.6.5` at both call sites, so every
 * Android user was reported as an iOS client running a version 70 releases
 * behind: the platform breakdown and the "which version is this bug from"
 * dimension were both wrong, and `0.6.5` predates the current build by so much
 * that version-scoped debugging was meaningless.
 *
 * Values are resolved from the running app rather than declared, and kept as
 * pure functions over an injected source so the Node vitest lane can exercise
 * the real payload shapes without loading React Native (same pattern as
 * `lib/app-identity.ts`).
 *
 * Kept in `lib/` and free of native imports on purpose: `data/api.ts` is loaded
 * by every data-layer test, so anything it imports must survive the Node lane.
 */

/** Which client surface this is. The server has a fixed token for the mobile
 *  app (as distinct from web / desktop / CLI), so it is not `Platform.OS`. */
export const CLIENT_PLATFORM = "mobile";

/** Where the identity values come from. `os` is RN's `Platform.OS`; `version`
 *  is the embedded app config's `version` (see `lib/app-identity.ts` for why
 *  the app config, not `Constants.platform`). Both are optional so a missing
 *  source degrades to "unknown" rather than a wrong claim. */
export interface ClientIdentitySource {
  os?: string | null;
  version?: string | null;
}

/**
 * Shown when the platform or version cannot be determined.
 *
 * Deliberately not a plausible-looking value: a wrong platform or version is
 * worse than an honest "unknown", because it silently corrupts the analytics
 * dimension rather than just leaving a gap. The server treats these headers as
 * free-form metadata, so an explicit "unknown" is reportable.
 */
export const UNKNOWN_CLIENT_OS = "unknown";
export const UNKNOWN_CLIENT_VERSION = "unknown";

export function resolveClientOs(source: ClientIdentitySource): string {
  const os = source.os?.trim();
  return os ? os : UNKNOWN_CLIENT_OS;
}

export function resolveClientVersion(source: ClientIdentitySource): string {
  const version = source.version?.trim();
  return version ? version : UNKNOWN_CLIENT_VERSION;
}

/**
 * The three identity headers as they go on the wire. Merged into every request
 * by `ApiClient.fetch` and by the multipart upload path.
 */
export function clientIdentityHeaders(
  source: ClientIdentitySource,
): Record<string, string> {
  return {
    "X-Client-Platform": CLIENT_PLATFORM,
    "X-Client-OS": resolveClientOs(source),
    "X-Client-Version": resolveClientVersion(source),
  };
}
