/**
 * System-installer handoff for the GitHub-Release update flow: turns a
 * downloaded APK's `file://` cache path into a `content://` URI
 * (expo-file-system's own FileSystemFileProvider) and opens the Android
 * package installer (expo-intent-launcher ACTION_VIEW). The download
 * itself is managed by the download-manager store (`data/downloads-store.ts`
 * `downloadManaged`, MYS-361) so progress/cancel/history stay unified.
 *
 * The legacy import is deliberate: the new `File` API exposes no
 * content-URI bridge, and the deprecated top-level `getContentUriAsync`
 * THROWS on purpose (see `expo-file-system/src/legacyWarnings.ts`) — the
 * `/legacy` subpath is the supported route.
 */
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as IntentLauncher from "expo-intent-launcher";
import { File } from "expo-file-system";
import { getContentUriAsync } from "expo-file-system/legacy";

/** MIME type understood by the Android package installer. */
export const APK_MIME_TYPE = "application/vnd.android.package-archive";

/** `Intent.FLAG_GRANT_READ_URI_PERMISSION` — lets the installer read our content URI. */
export const FLAG_GRANT_READ_URI_PERMISSION = 1;

export type InstallErrorReason = "content-uri" | "install";

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
    case "content-uri":
      return "Failed to open the downloaded file";
    case "install":
      return "Failed to launch the installer";
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