/**
 * The "allow installs from this source" settings deep-link behind the
 * self-update flow's blocked-install hint.
 *
 * `ACTION_MANAGE_UNKNOWN_APP_SOURCES` only narrows Settings to a single app
 * when the package travels as the intent's **data URI** (`package:<pkg>`).
 * Carrying it in `extras` instead opens the all-apps list
 * (`Settings$ManageExternalSourcesActivity`), which has no per-app toggle to
 * flip — so the user is sent somewhere they cannot act. Measured on
 * Android 15 / API 35, `cmd package resolve-activity` resolves the two forms
 * to two different activities:
 *
 *   -e android.provider.extra.APP_PACKAGE <pkg>  -> Settings$ManageExternalSourcesActivity (all apps)
 *   -d package:<pkg>                             -> Settings$ManageAppExternalSourcesActivity (that app)
 *
 * The extras key was also written as the *Java symbol* name
 * (`android.provider.Settings.EXTRA_APP_PACKAGE`) rather than the constant's
 * value (`android.provider.extra.APP_PACKAGE`) — which changed nothing, because
 * the extras form is unscoped either way. Only the data URI is correct; the
 * Android docs describe exactly this ("the Intent's data URI can specify the
 * application package name to directly invoke the management GUI specific to
 * the package name").
 *
 * Kept as pure functions over an injected source so the Node vitest lane can
 * exercise the real payload shapes without loading React Native.
 */
export type UnknownAppSourcesSource = {
  expoConfig?: { android?: { package?: string | null } | null } | null;
};

/** Params for `IntentLauncher.startActivityAsync`; `data` scopes it to one app. */
export type UnknownAppSourcesParams = { data?: string };

/**
 * The package id the deep-link must name, or `null` when the embedded config
 * carries none. The value has to be the package the APK was installed under —
 * a data URI naming a package that is not installed lands on an empty screen —
 * which is why the build pins the embedded config to the manifest's package
 * (`scripts/verify-apk.mjs` fails the build when those two disagree).
 */
export function resolveAppPackageName(
  source: UnknownAppSourcesSource,
): string | null {
  const pkg = source.expoConfig?.android?.package;
  return typeof pkg === "string" && pkg.length > 0 ? pkg : null;
}

/** Intent data URI that scopes the unknown-sources screen to one package. */
export function unknownAppSourcesDataUri(packageName: string): string {
  return `package:${packageName}`;
}

/**
 * Intent params for the unknown-sources screen. Scoped when a package is
 * known; otherwise an unscoped launch (Settings' all-apps list), which is a
 * usable screen rather than a blank one.
 *
 * Never returns `extra`: that form is what made this button a no-op.
 */
export function unknownAppSourcesIntentParams(
  source: UnknownAppSourcesSource,
): UnknownAppSourcesParams {
  const packageName = resolveAppPackageName(source);
  return packageName ? { data: unknownAppSourcesDataUri(packageName) } : {};
}
