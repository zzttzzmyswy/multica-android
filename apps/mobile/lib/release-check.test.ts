import { describe, expect, it } from "vitest";
import {
  archToAbiCandidates,
  checkForUpdate,
  displayVersion,
  filenameForUpdate,
  isNewer,
  matchAssetForAbi,
  parseLatestRelease,
  pickAssetForDevice,
  type ReleaseAsset,
} from "./release-check";

const ASSET = (name: string, url = `https://github.com/x/y/releases/download/v0.1.0/${name}`): ReleaseAsset => ({
  name,
  browser_download_url: url,
  size: 1 << 20,
});

describe("parseLatestRelease", () => {
  it("extracts tag, name, published_at and the asset list", () => {
    const json = {
      tag_name: "v0.1.1",
      name: "Multica 0.1.1",
      published_at: "2026-08-16T00:00:00Z",
      assets: [
        { name: "multica-0.1.1-arm64-v8a.apk", browser_download_url: "https://u/a", size: 123 },
      ],
    };
    expect(parseLatestRelease(json)).toEqual({
      tag_name: "v0.1.1",
      name: "Multica 0.1.1",
      published_at: "2026-08-16T00:00:00Z",
      assets: [
        { name: "multica-0.1.1-arm64-v8a.apk", browser_download_url: "https://u/a", size: 123 },
      ],
    });
  });

  it("returns null when tag_name is missing or not a string", () => {
    expect(parseLatestRelease({ assets: [] })).toBeNull();
    expect(parseLatestRelease({ tag_name: 42, assets: [] })).toBeNull();
  });

  it("coerces a missing / malformed assets field to an empty list", () => {
    expect(parseLatestRelease({ tag_name: "v0.1.0" })?.assets).toEqual([]);
    expect(parseLatestRelease({ tag_name: "v0.1.0", assets: "nope" })?.assets).toEqual([]);
  });

  it("drops asset entries that lack a usable name or url", () => {
    const json = {
      tag_name: "v0.1.0",
      assets: [
        { name: "multica.apk", browser_download_url: "https://u/a" },
        { name: "missing-url.apk" },
        { browser_download_url: "https://u/b" },
      ],
    };
    const parsed = parseLatestRelease(json);
    expect(parsed?.assets).toHaveLength(1);
    expect(parsed?.assets[0].name).toBe("multica.apk");
  });
});

describe("matchAssetForAbi", () => {
  it("picks the apk whose name contains the requested abi", () => {
    const assets = [
      ASSET("multica-0.1.0-armeabi-v7a.apk"),
      ASSET("multica-0.1.0-arm64-v8a.apk"),
      ASSET("multica-0.1.0-x86_64.apk"),
    ];
    expect(matchAssetForAbi(assets, "arm64-v8a")?.name).toBe("multica-0.1.0-arm64-v8a.apk");
    expect(matchAssetForAbi(assets, "x86_64")?.name).toBe("multica-0.1.0-x86_64.apk");
  });

  it("returns null when no apk matches the abi", () => {
    expect(matchAssetForAbi([ASSET("multica-0.1.0-x86.apk")], "arm64-v8a")).toBeNull();
  });

  it("never matches non-apk artifacts (.aab, source tarball)", () => {
    const assets = [
      ASSET("multica-0.1.0-release.aab"),
      ASSET("multica-0.1.0-arm64-v8a.aab"),
      ASSET("source.tar.gz"),
    ];
    expect(matchAssetForAbi(assets, "arm64-v8a")).toBeNull();
  });

  it("returns null for an empty asset list or missing abi", () => {
    expect(matchAssetForAbi([], "arm64-v8a")).toBeNull();
    expect(matchAssetForAbi([ASSET("multica-arm64-v8a.apk")], "")).toBeNull();
  });
});

describe("isNewer", () => {
  it("compares stripped tag vs current app version", () => {
    expect(isNewer("v0.2.0", "0.1.0")).toBe(true);
    expect(isNewer("v0.1.1", "0.1.0")).toBe(true);
    expect(isNewer("0.2.0", "0.1.0")).toBe(true); // no v prefix tolerated
  });

  it("is false when the tag is equal or older", () => {
    expect(isNewer("v0.1.0", "0.1.0")).toBe(false);
    expect(isNewer("v0.0.9", "0.1.0")).toBe(false);
  });

  it("falls back to false (safe direction) on malformed versions", () => {
    expect(isNewer("not-a-version", "0.1.0")).toBe(false);
    expect(isNewer("v0.2.0", "")).toBe(false);
  });

  it("sees a namespaced mobile-v tag as newer", () => {
    expect(isNewer("mobile-v0.6.83", "0.6.43")).toBe(true);
    expect(isNewer("mobile-v0.6.43", "0.6.43")).toBe(false);
  });
});

/**
 * The 2026-10-15 field report, reduced to its inputs: an install on v0.6.43
 * against a published `mobile-v0.6.83` tag rendered "当前已是最新版本" while the
 * row directly below it named a different version. `false` from `isNewer`
 * could not tell the two apart, so the About page had no way to avoid making
 * the claim. These are the assertions that would have caught it.
 */
describe("checkForUpdate", () => {
  it("reports a namespaced tag newer than the installed version", () => {
    expect(checkForUpdate("mobile-v0.6.83", "0.6.43")).toBe("update-available");
  });

  it("reports up-to-date only for a genuine tie or an older tag", () => {
    expect(checkForUpdate("mobile-v0.6.43", "0.6.43")).toBe("up-to-date");
    expect(checkForUpdate("mobile-v0.6.42", "0.6.43")).toBe("up-to-date");
    expect(checkForUpdate("v0.6.43", "0.6.43")).toBe("up-to-date");
  });

  it("reports an unreadable tag as unreadable, never as up-to-date", () => {
    expect(checkForUpdate("not-a-version", "0.6.43")).toBe("unreadable");
    expect(checkForUpdate("mobile-latest", "0.6.43")).toBe("unreadable");
    expect(checkForUpdate("mobile-v0.6.83", "")).toBe("unreadable");
  });

  it("covers the bare-v era and the namespaced era across the changeover", () => {
    expect(checkForUpdate("v0.6.58", "0.6.57")).toBe("update-available");
    expect(checkForUpdate("mobile-v0.6.59", "0.6.58")).toBe("update-available");
    expect(checkForUpdate("mobile-v0.6.83", "0.6.83")).toBe("up-to-date");
  });
});

describe("displayVersion", () => {
  /**
   * The second half of the same report: the About page rendered the literal
   * string `vmobile-v0.6.83`, because `replace(/^v/i, "")` cannot strip a `v`
   * that is not at the start, and the locale template already spells its own
   * `v` before `{{version}}`.
   */
  it("strips the namespace and the v marker down to the bare version", () => {
    expect(displayVersion("mobile-v0.6.83")).toBe("0.6.83");
    expect(displayVersion("v0.1.0")).toBe("0.1.0");
    expect(displayVersion("0.1.0")).toBe("0.1.0");
    expect(displayVersion("android-release-v1.2.3")).toBe("1.2.3");
  });

  it("shows an unreadable tag verbatim rather than as an empty string", () => {
    expect(displayVersion("mobile-latest")).toBe("mobile-latest");
    expect(displayVersion("  weird  ")).toBe("weird");
  });
});

describe("archToAbiCandidates", () => {
  it("normalizes display-ish architecture strings to canonical ABIs", () => {
    expect(archToAbiCandidates("arm64 v8")).toEqual(["arm64-v8a"]);
    expect(archToAbiCandidates("arm64-v8a")).toEqual(["arm64-v8a"]);
    expect(archToAbiCandidates("x86_64")).toEqual(["x86_64"]);
    expect(archToAbiCandidates("Intel x86-64h Haswell")).toEqual(["x86_64"]);
    expect(archToAbiCandidates("armeabi-v7a")).toEqual(["armeabi-v7a"]);
  });

  it("yields no candidates for foreign architectures", () => {
    expect(archToAbiCandidates("mips64")).toEqual([]);
    expect(archToAbiCandidates("")).toEqual([]);
  });
});

describe("pickAssetForDevice", () => {
  const arm64 = ASSET("multica-0.1.0-arm64-v8a.apk");
  const x86 = ASSET("multica-0.1.0-x86_64.apk");

  it("picks the asset matching the first supported architecture", () => {
    expect(pickAssetForDevice([arm64, x86], ["arm64-v8a", "armeabi-v7a"])?.name).toBe(
      "multica-0.1.0-arm64-v8a.apk",
    );
  });

  it("falls through to a later architecture when the first ships no apk", () => {
    const onlyX86 = [ASSET("multica-0.1.0-x86.apk")];
    expect(pickAssetForDevice(onlyX86, ["arm64-v8a", "x86"])?.name).toBe(
      "multica-0.1.0-x86.apk",
    );
  });

  it("returns null when nothing matches or there are no architectures", () => {
    expect(pickAssetForDevice([arm64], ["mips64"])).toBeNull();
    expect(pickAssetForDevice([arm64], null)).toBeNull();
    expect(pickAssetForDevice([], ["arm64-v8a"])).toBeNull();
  });
});

describe("filenameForUpdate", () => {
  it("builds a tag+abi filename safe for the cache directory", () => {
    expect(filenameForUpdate("v0.1.1", "arm64-v8a")).toBe(
      "multica-update-v0.1.1-arm64-v8a.apk",
    );
  });

  it("scrubs hostile tag characters", () => {
    expect(filenameForUpdate("v1.0/../../x", "arm64-v8a")).toBe(
      "multica-update-v1.0_.._.._x-arm64-v8a.apk",
    );
  });
});