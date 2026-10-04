/**
 * The release channel's Android package id — and the check that stops an
 * in-app update from installing a *second* app instead of upgrading this one.
 *
 * Android identifies an app by its package id, not by its version. Two APKs
 * whose ids differ are, to the installer, unrelated apps: handing one to the
 * package installer while the other is already present creates a second icon
 * and a second data directory, returns `Success`, and says nothing about it.
 *
 * v0.6.17 did exactly that. Every release from v0.4.0 to v0.6.15 installed as
 * `ai.multica.mobile.dev`; v0.6.17 shipped as `ai.multica.mobile`, because the
 * iteration-186 build notes called the `.dev` artifact "the wrong app" and the
 * next release was built by following them (see docs/android-build.md). Nothing
 * compared one release's package to the next, so the whole channel's id moved
 * and every existing user's "check for updates" began installing a stranger.
 *
 * So there are two halves, and this module owns the second:
 *
 *   1. `release-identity.json` declares the one id releases install under, and
 *      `scripts/verify-apk.mjs` fails the build when an artifact disagrees. That
 *      is the half that prevents recurrence.
 *   2. This module answers, at update time, whether the running app is even
 *      entitled to install the release it is about to download. An app whose
 *      *installed* package is not the channel's declared package must not
 *      quietly self-update: the download would land beside it, not over it.
 *      That is the half that turns a silent second install into a readable
 *      refusal for anyone already stranded on the odd id.
 *
 * Notice what half 2 does *not* need: it never opens the downloaded APK, and
 * never parses a manifest. The app already knows the package it was installed
 * under (`Constants.expoConfig.android.package`, which the build pins to the
 * manifest — see plugins/with-app-config-env.js), so the comparison is between
 * two strings the process already holds. Kept as pure functions over an
 * injected value so the Node vitest lane covers every branch without React
 * Native or a real device.
 */
import releaseIdentity from "@/release-identity.json";

/**
 * The package id every published release APK installs under.
 *
 * Read from `release-identity.json` rather than written here, because
 * `scripts/verify-apk.mjs` and `app.config.ts` must agree with this value and
 * a second copy is exactly how the two halves drifted apart in the first place.
 */
export const RELEASE_ANDROID_PACKAGE: string =
  releaseIdentity.androidPackage;

/** Where an app can find the package it was installed under, as expo-constants
 *  shapes it. Injected so tests can drive the real payload shapes. */
export type InstalledIdentitySource = {
  expoConfig?: { android?: { package?: string | null } | null } | null;
};

/** The package the running app was installed under, or `null` when the
 *  embedded config carries none (a build with Android config stripped). */
export function resolveInstalledPackage(
  source: InstalledIdentitySource,
): string | null {
  const pkg = source.expoConfig?.android?.package;
  return typeof pkg === "string" && pkg.length > 0 ? pkg : null;
}

export type UpdateTargetVerdict =
  | { ok: true; installedPackage: string }
  | { ok: false; reason: "foreign-package"; installedPackage: string }
  | { ok: false; reason: "unknown-package"; installedPackage: null };

/**
 * May this app install the channel's release APK as an *upgrade of itself*?
 *
 * `ok` requires the installed package to equal the channel's declared package.
 * A different id means the installer would create a second app, so the update
 * flow must refuse and explain rather than hand the file over and report
 * success. An unknown id is refused too — the safe direction, since it is
 * precisely the state in which we cannot tell.
 */
export function checkUpdateInstallTarget(
  source: InstalledIdentitySource,
): UpdateTargetVerdict {
  const installedPackage = resolveInstalledPackage(source);
  if (installedPackage === null) {
    return { ok: false, reason: "unknown-package", installedPackage: null };
  }
  if (installedPackage !== RELEASE_ANDROID_PACKAGE) {
    return { ok: false, reason: "foreign-package", installedPackage };
  }
  return { ok: true, installedPackage };
}
