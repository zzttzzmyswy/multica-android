/**
 * App-identity display helpers — what the About page's "version" and "build"
 * rows show.
 *
 * Both values come out of `expo-constants`, but from two different places, and
 * the difference is not cosmetic:
 *
 *   - `version` lives on the embedded app config (`expo prebuild` writes
 *     app.config.ts into the APK's assets, and expo-constants parses that JSON
 *     into `Constants.expoConfig`).
 *   - Android's `versionCode` is NOT on `Constants.platform.android`.
 *     expo-constants hard-codes that map to `emptyMap()` on Android
 *     (`ConstantsService.kt`), and its own type marks the field deprecated in
 *     favour of `expo-application`. So Android's build number has to be read
 *     from the embedded app config too — the same object, so it cannot drift
 *     from the versionCode gradle actually stamps.
 *   - iOS is the mirror image: `Constants.platform.ios.buildNumber` IS
 *     populated natively (CFBundleVersion), and there is no Android-style
 *     equivalent to fall back to.
 *
 * Kept as pure functions over an injected source so the Node vitest lane can
 * exercise the real payload shapes without loading React Native.
 */
export type AppIdentitySource = {
  expoConfig?: {
    version?: string | null;
    android?: { versionCode?: number | null } | null;
    ios?: { buildNumber?: string | null } | null;
  } | null;
  platform?: {
    android?: { versionCode?: number | null } | null;
    ios?: { buildNumber?: string | null } | null;
  } | null;
};

/** Shown when the embedded app config carries no version. */
export const UNKNOWN_APP_VERSION = "0.0.0";

/** Shown when the platform supplies no build number. */
export const UNKNOWN_BUILD_NUMBER = "—";

export function resolveAppVersion(source: AppIdentitySource): string {
  const version = source.expoConfig?.version;
  return typeof version === "string" && version.length > 0
    ? version
    : UNKNOWN_APP_VERSION;
}

export function resolveBuildNumber(source: AppIdentitySource): string {
  const androidVersionCode = source.expoConfig?.android?.versionCode;
  if (typeof androidVersionCode === "number") return `${androidVersionCode}`;

  const iosBuildNumber = source.platform?.ios?.buildNumber;
  if (typeof iosBuildNumber === "string" && iosBuildNumber.length > 0) {
    return iosBuildNumber;
  }

  return UNKNOWN_BUILD_NUMBER;
}
