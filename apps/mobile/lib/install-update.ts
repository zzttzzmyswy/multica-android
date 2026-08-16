/**
 * APK download + system-installer handoff for the GitHub-Release update flow.
 *
 * Lives outside React (except the About-page button wiring): pure-enough
 * async steps over expo-file-system (download to cache), the legacy
 * `getContentUriAsync` bridge (expo-file-system's own FileSystemFileProvider
 * turns the `file://` cache path into a `content://` URI the installer can
 * read), and expo-intent-launcher (ACTION_VIEW with the APK MIME type).
 *
 * The legacy import is deliberate: the new `File` API exposes no
 * content-URI bridge, and the deprecated top-level `getContentUriAsync`
 * THROWS on purpose (see `expo-file-system/src/legacyWarnings.ts`) — the
 * `/legacy` subpath is the supported route.
 */
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as IntentLauncher from "expo-intent-launcher";
import { File, Paths } from "expo-file-system";
import { getContentUriAsync } from "expo-file-system/legacy";

import {
  matchAssetForAbi,
  type LatestRelease,
  type ReleaseAsset,
} from "./release-check";

/** MIME type understood by the Android package installer. */
export const APK_MIME_TYPE = "application/vnd.android.package-archive";

/** `Intent.FLAG_GRANT_READ_URI_PERMISSION` — lets the installer read our content URI. */
export const FLAG_GRANT_READ_URI_PERMISSION = 1;

export type InstallErrorReason =
  | "no-match-abi"
  | "download"
  | "content-uri"
  | "install"
  | "unknown";

export class UpdateInstallError extends Error {
  constructor(
    readonly reason: InstallErrorReason,
    message?: string,
  ) {
    super(message ?? defaultMessage(reason));
    this.name = "UpdateInstallError";
  }
}

function defaultMessage(reason: InstallErrorReason): string {
  switch (reason) {
    case "no-match-abi":
      return "No APK matches the device ABI";
    case "download":
      return "Download failed";
    case "content-uri":
      return "Failed to open the downloaded file";
    case "install":
      return "Failed to launch the installer";
    case "unknown":
      return "Unexpected update error";
  }
}

/**
 * ABI list reported by the device, in preference order (device-owner trumps
 * far rarer exotic ABIs). `Device.supportedCpuArchitectures` returns e.g.
 * `["arm64-v8a", "armeabi-v7a"]` on modern 64-bit devices and `["x86_64"]`
 * on the emulator — we want the intersection with our released ABI markers.
 */
const ABI_PREFERENCE = ["arm64-v8a", "x86_64", "armeabi-v7a", "x86"] as const;

export function resolveDeviceAbi(): string | null {
  const archs = Device.supportedCpuArchitectures ?? [];
  for (const preferred of ABI_PREFERENCE) {
    if (archs.includes(preferred)) return preferred;
  }
  return null;
}

/** Cache filename mirroring the spec: `multica-update-v<tag>-<abi>.apk`. */
export function apkCacheFilename(tagName: string, abi: string): string {
  const safeTag = tagName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `multica-update-${safeTag}-${abi}.apk`;
}

export interface DownloadedApk {
  asset: ReleaseAsset;
  file: File;
}

/**
 * Pick the ABI-matching asset and download it into the app cache.
 * Throws `UpdateInstallError("no-match-abi")` when the latest release ships
 * no APK for this device's architecture.
 */
export async function downloadUpdateApk(
  release: LatestRelease,
  abi: string,
): Promise<DownloadedApk> {
  const asset = matchAssetForAbi(release.assets, abi);
  if (!asset) {
    throw new UpdateInstallError("no-match-abi");
  }

  const filename = apkCacheFilename(release.tag_name, abi);
  const destination = new File(Paths.cache, filename);
  if (destination.exists) {
    destination.delete();
  }

  try {
    const file = await File.downloadFileAsync(
      asset.browser_download_url,
      destination,
      { idempotent: true },
    );
    return { asset, file };
  } catch (err) {
    throw new UpdateInstallError(
      "download",
      err instanceof Error ? err.message : "Download failed",
    );
  }
}

/**
 * Hand the downloaded APK to the system package installer via a
 * `content://` URI. Throws `UpdateInstallError("content-uri" | "install")`
 * so the caller can surface a readable error + unknown-sources hint.
 */
export async function installApkFile(file: File): Promise<void> {
  let contentUri: string;
  try {
    contentUri = await getContentUriAsync(file.uri);
  } catch (err) {
    throw new UpdateInstallError(
      "content-uri",
      err instanceof Error ? err.message : "Failed to open the downloaded file",
    );
  }

  try {
    await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
      data: contentUri,
      type: APK_MIME_TYPE,
      flags: FLAG_GRANT_READ_URI_PERMISSION,
    });
  } catch (err) {
    throw new UpdateInstallError(
      "install",
      err instanceof Error ? err.message : "Failed to launch the installer",
    );
  }
}

/**
 * Jump to this app's "install unknown apps" toggle. Called when install is
 * blocked because the user hasn't allowed APK installs from this source.
 */
export function openUnknownAppSourcesSettings(): void {
  const packageName = Constants.expoConfig?.android?.package;
  void IntentLauncher.startActivityAsync(
    IntentLauncher.ActivityAction.MANAGE_UNKNOWN_APP_SOURCES,
    {
      extra: packageName
        ? { "android.provider.Settings.EXTRA_APP_PACKAGE": packageName }
        : undefined,
    },
  );
}