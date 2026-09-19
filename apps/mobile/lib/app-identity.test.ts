/**
 * App-identity display test — the About page's "version" / "build" rows.
 *
 * The build row shipped broken: it read `Constants.platform.android.versionCode`,
 * but expo-constants hard-codes Android's platform payload to an empty map
 * (`ConstantsService.kt`: `"platform" to mapOf("android" to emptyMap())`), so
 * the row could only ever render "—". Its own type marks the field deprecated
 * in favour of `expo-application`.
 *
 * These tests pin both halves of the fix: the resolver reads the versionCode
 * from the embedded app config (the same object the version row already reads
 * successfully on device), and the About screen actually calls the resolver —
 * without that second half a revert of the screen would keep this file green
 * while the row went back to "—".
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  resolveAppVersion,
  resolveBuildNumber,
  UNKNOWN_APP_VERSION,
  UNKNOWN_BUILD_NUMBER,
} from "./app-identity";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ABOUT_SCREEN = path.resolve(
  HERE,
  "../app/(app)/[workspace]/more/about.tsx",
);

describe("resolveAppVersion", () => {
  it("reads the version out of the embedded app config", () => {
    expect(resolveAppVersion({ expoConfig: { version: "0.5.84" } })).toBe(
      "0.5.84",
    );
  });

  it("falls back to a placeholder when the config is missing or blank", () => {
    expect(resolveAppVersion({})).toBe(UNKNOWN_APP_VERSION);
    expect(resolveAppVersion({ expoConfig: null })).toBe(UNKNOWN_APP_VERSION);
    expect(resolveAppVersion({ expoConfig: {} })).toBe(UNKNOWN_APP_VERSION);
    expect(resolveAppVersion({ expoConfig: { version: "" } })).toBe(
      UNKNOWN_APP_VERSION,
    );
  });
});

describe("resolveBuildNumber", () => {
  it("reads Android's versionCode out of the embedded app config", () => {
    // The shape a prebuilt release APK really has: `expo prebuild` writes
    // app.config.ts into the APK's assets and expo-constants surfaces that
    // JSON as `expoConfig`.
    expect(
      resolveBuildNumber({ expoConfig: { android: { versionCode: 584 } } }),
    ).toBe("584");
  });

  it("cannot read Android's build number from the platform payload", () => {
    // Pins *why* the row used to read "—": `platform.android` is always an
    // empty map on Android, so the old inline read was reading a key that is
    // never there. A "simplification" back to that expression has to fail here
    // (and in the test above).
    expect(resolveBuildNumber({ platform: { android: {} } })).toBe(
      UNKNOWN_BUILD_NUMBER,
    );
  });

  it("reads iOS's build number from the native platform payload", () => {
    // expo-constants' iOS service does populate this one (CFBundleVersion).
    expect(
      resolveBuildNumber({ platform: { ios: { buildNumber: "584" } } }),
    ).toBe("584");
  });

  it("falls back to a placeholder when neither platform supplies one", () => {
    expect(resolveBuildNumber({})).toBe(UNKNOWN_BUILD_NUMBER);
    expect(resolveBuildNumber({ expoConfig: {}, platform: {} })).toBe(
      UNKNOWN_BUILD_NUMBER,
    );
    expect(
      resolveBuildNumber({ expoConfig: { android: { versionCode: null } } }),
    ).toBe(UNKNOWN_BUILD_NUMBER);
    expect(resolveBuildNumber({ platform: { ios: { buildNumber: "" } } })).toBe(
      UNKNOWN_BUILD_NUMBER,
    );
  });
});

describe("About page identity rows", () => {
  const source = readFileSync(ABOUT_SCREEN, "utf8").replace(/\s+/g, "");

  it("resolves both rows through the shared helpers", () => {
    expect(source).toContain("resolveAppVersion(Constants)");
    expect(source).toContain("resolveBuildNumber(Constants)");
  });

  it("no longer reads the build number from the empty Android platform payload", () => {
    expect(source).not.toContain("platform?.android?.versionCode");
  });
});
