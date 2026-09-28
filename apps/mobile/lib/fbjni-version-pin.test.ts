/**
 * Guards the fbjni version pin (plugins/with-fbjni-version-pin.js).
 *
 * Why this test exists: the pin is the only thing between the app and a
 * startup crash. `react-native-shiki-engine` declares
 * `com.facebook.fbjni:fbjni:+` — a DYNAMIC version — so Gradle resolves
 * whatever is newest upstream. On 2026-09-28 that was 0.8.1, whose
 * `libfbjni.so` imports `__cxa_init_primary_exception`, a symbol NDK 27's
 * `libc++_shared.so` does not export (every other native library in the APK is
 * built with NDK 27). The APK built clean and then died on launch with
 * "couldn't find DSO to load: libfbjni.so" — a failure that no type check or
 * unit test of app code can catch, because it only exists at Gradle resolution
 * time. These tests pin the splice itself and keep the pinned version tied to
 * the one React Native ships.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require("../plugins/with-fbjni-version-pin.js") as {
  FBJNI_VERSION: string;
  MARKER: string;
  spliceFbjniPin: (contents: string) => string;
};

const ROOT_BUILD_GRADLE = `// Top-level build file
buildscript {
  repositories {
    google()
  }
}

allprojects {
  repositories {
    google()
    mavenCentral()
  }
}

apply plugin: "expo-root-project"
apply plugin: "com.facebook.react.rootproject"
`;

describe("with-fbjni-version-pin", () => {
  it("forces the fbjni version React Native pins", () => {
    // The pinned version must equal react-native's own, otherwise the app links
    // an fbjni built against a different NDK than the rest of the tree.
    const toml = readFileSync(
      path.resolve(__dirname, "../node_modules/react-native/gradle/libs.versions.toml"),
      "utf8",
    );
    const declared = /^fbjni\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
    expect(declared).toBe(plugin.FBJNI_VERSION);
  });

  it("splices a resolution strategy that forces the pinned version", () => {
    const out = plugin.spliceFbjniPin(ROOT_BUILD_GRADLE);
    expect(out).toContain(plugin.MARKER);
    expect(out).toContain(
      `force "com.facebook.fbjni:fbjni:${plugin.FBJNI_VERSION}"`,
    );
    // Applied to every subproject: shiki-engine resolves the dependency inside
    // its own configuration, so the pin has to reach it from the root.
    expect(out).toContain("allprojects {");
    expect(out).toContain("configurations.all");
    expect(out).toContain("resolutionStrategy");
  });

  it("keeps the file it was handed intact", () => {
    const out = plugin.spliceFbjniPin(ROOT_BUILD_GRADLE);
    expect(out).toContain('apply plugin: "com.facebook.react.rootproject"');
    expect(out).toContain("mavenCentral()");
    expect(out.startsWith(ROOT_BUILD_GRADLE.trimEnd())).toBe(true);
  });

  it("is idempotent — prebuild re-runs plugins on every build", () => {
    const once = plugin.spliceFbjniPin(ROOT_BUILD_GRADLE);
    const twice = plugin.spliceFbjniPin(once);
    expect(twice).toBe(once);
    // Exactly one block, not one per build.
    expect(once.split(plugin.MARKER).length - 1).toBe(1);
  });

  it("does not pin any other coordinate", () => {
    // A blanket `force` on everything would silently downgrade unrelated
    // libraries; the pin must name fbjni and nothing else.
    const out = plugin.spliceFbjniPin(ROOT_BUILD_GRADLE);
    const forces = [...out.matchAll(/force\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(forces).toEqual([`com.facebook.fbjni:fbjni:${plugin.FBJNI_VERSION}`]);
  });
});
