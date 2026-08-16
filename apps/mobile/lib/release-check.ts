/**
 * Pure parsing/selection helpers for the GitHub Release update flow.
 *
 * Everything here is a pure function over the GitHub API response shape so the
 * Node vitest lane can cover the safety invariants (malformed payloads, ABI
 * selection, version ordering) without loading any native module. The network
 * fetch, download and install live elsewhere (`lib/use-latest-release.ts`,
 * `lib/install-update.ts`).
 */
import { compareVersions } from "./app-version";

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  /** Byte size — optional; used only for display. */
  size?: number;
}

export interface LatestRelease {
  tag_name: string;
  name?: string;
  published_at?: string;
  assets: ReleaseAsset[];
}

/** GitHub repo that publishes the Android APKs. */
export const GITHUB_REPO = "zzttzzmyswy/multica-android" as const;
export const GITHUB_RELEASES_API =
  `https://api.github.com/repos/${GITHUB_REPO}/releases/latest` as const;
/** Human-facing repository page, linked from the About screen. */
export const GITHUB_REPO_URL =
  `https://github.com/${GITHUB_REPO}` as const;

/** Release asset name must contain one of these to be an ABI-matching APK. */
export const RELEASE_APK_MARKER = ".apk";

/**
 * Extract the parts of a GitHub `releases/latest` response the update flow
 * needs. Returns `null` when `tag_name` is absent or not a string (not a
 * usable release). Asset entries without both a name and a download URL are
 * filtered out; a missing/malformed `assets` field degrades to `[]`.
 */
export function parseLatestRelease(json: unknown): LatestRelease | null {
  if (typeof json !== "object" || json === null) return null;
  const record = json as Record<string, unknown>;
  const tag = record.tag_name;
  if (typeof tag !== "string" || tag.trim() === "") return null;

  const rawAssets = Array.isArray(record.assets) ? record.assets : [];
  const assets: ReleaseAsset[] = [];
  for (const raw of rawAssets) {
    if (typeof raw !== "object" || raw === null) continue;
    const asset = raw as Record<string, unknown>;
    if (typeof asset.name !== "string" || typeof asset.browser_download_url !== "string") {
      continue;
    }
    assets.push({
      name: asset.name,
      browser_download_url: asset.browser_download_url,
      ...(typeof asset.size === "number" ? { size: asset.size } : {}),
    });
  }

  return {
    tag_name: tag,
    name: typeof record.name === "string" ? record.name : undefined,
    published_at: typeof record.published_at === "string" ? record.published_at : undefined,
    assets,
  };
}

/**
 * Pick the asset that matches the device's ABI. Only `.apk` artifacts are
 * candidates; the abi is matched as a substring of the filename (release
 * naming: `multica-0.1.1-arm64-v8a.apk`). Returns `null` when nothing fits.
 */
export function matchAssetForAbi(
  assets: ReleaseAsset[],
  abi: string,
): ReleaseAsset | null {
  if (!abi) return null;
  const needle = abi.toLowerCase();
  for (const asset of assets) {
    if (!asset.name.toLowerCase().endsWith(RELEASE_APK_MARKER)) continue;
    if (asset.name.toLowerCase().includes(needle)) return asset;
  }
  return null;
}

/**
 * `true` when the release tag is strictly newer than the installed app
 * version. Malformed inputs resolve to `false` — the update flow's safe
 * direction (never block on a version we can't compare).
 */
export function isNewer(tagName: string, currentVersion: string): boolean {
  return compareVersions(tagName, currentVersion) > 0;
}

/**
 * Map a device architecture string (from `expo-device`'s
 * `supportedCpuArchitectures`, e.g. `"x86_64"` or the display-ish
 * `"arm64 v8"`) to the canonical Android ABI markers used in release asset
 * names. Returns `[]` for architectures we don't ship APKs for.
 */
export function archToAbiCandidates(arch: string): string[] {
  const a = arch.toLowerCase();
  if (a.includes("arm64")) return ["arm64-v8a"];
  if (a.includes("armeabi") || a.includes("armv7")) return ["armeabi-v7a"];
  if (a.includes("x86_64") || a.includes("x86-64")) return ["x86_64"];
  if (a.includes("x86")) return ["x86"];
  return [];
}

/**
 * Pick the release APK that fits the device, honouring the order the device
 * reports its supported architectures (first hit wins). Returns `null` when
 * no asset matches any architecture (e.g. the release only ships AABs).
 */
export function pickAssetForDevice(
  assets: ReleaseAsset[],
  architectures: string[] | null | undefined,
): ReleaseAsset | null {
  for (const arch of architectures ?? []) {
    for (const abi of archToAbiCandidates(arch)) {
      const hit = matchAssetForAbi(assets, abi);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Safe cache filename for a downloaded update APK. Release tag + ABI become
 * part of the filename (`multica-update-v0.1.1-arm64-v8a.apk`) so a newer
 * download never collides with an older one; the tag is scrubbed of anything
 * that could escape the cache directory.
 */
export function filenameForUpdate(tagName: string, abi: string): string {
  const safeTag = tagName.replace(/[^A-Za-z0-9._-]/g, "_");
  return `multica-update-${safeTag}-${abi}.apk`;
}