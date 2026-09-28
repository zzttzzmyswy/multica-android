/**
 * Guards the shiki-engine ONIG_LIB redirect (plugins/with-onig-prebuilt-path.js).
 *
 * Why this test exists: the library's own CMakeLists asks
 * `find_library(ONIG_LIB onig ... NO_CMAKE_FIND_ROOT_PATH)`, which lets CMake
 * prefer the BUILD MACHINE's oniguruma over the vendored Android .so. On a host
 * that has distro oniguruma installed, the aarch64 link then fails with
 *
 *   ld.lld: error: /usr/lib/libonig.so is incompatible with aarch64linux
 *
 * This is not hypothetical: iter-181 hit it, patched the CMakeLists in place
 * under node_modules (a gitignored directory), and the fix evaporated on the
 * next install — iter-182's first build failed with it again, on a tree whose
 * tracked source was untouched. These tests pin the splice itself, including
 * the failure mode that matters: an upstream reshuffle of the find_library call
 * must throw rather than silently leave the host fallback in place.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require("../plugins/with-onig-prebuilt-path.js") as {
  MARKER: string;
  spliceOnigPath: (contents: string) => string;
};

/** The upstream call, verbatim from react-native-shiki-engine 0.3.10. */
const UPSTREAM = `cmake_minimum_required(VERSION 3.13)
project(ReactNativeShikiEngine)

# Find prebuilt oniguruma library
find_library(LOG_LIB log)
find_library(ONIG_LIB onig
    PATHS \${CMAKE_CURRENT_SOURCE_DIR}/src/main/jniLibs/\${ANDROID_ABI}
    NO_CMAKE_FIND_ROOT_PATH
    REQUIRED
)

add_library(react-native-shiki-engine SHARED
    src/main/cpp/cpp-adapter.cpp
)
`;

describe("with-onig-prebuilt-path", () => {
  it("replaces the host-searching find_library with the vendored path", () => {
    const patched = plugin.spliceOnigPath(UPSTREAM);
    expect(patched).not.toContain("find_library(ONIG_LIB");
    expect(patched).toContain(plugin.MARKER);
    // CACHE ... FORCE so a stale value already in the CMake cache cannot win.
    expect(patched).toContain("CACHE FILEPATH \"\" FORCE");
    expect(patched).toContain("jniLibs/\${ANDROID_ABI}/libonig.so");
    // The unrelated find_library call must survive untouched.
    expect(patched).toContain("find_library(LOG_LIB log)");
  });

  it("keeps a FATAL_ERROR for a missing prebuilt instead of falling back to the host", () => {
    const patched = plugin.spliceOnigPath(UPSTREAM);
    // A silent fallback is the whole bug; the patched file must refuse to build.
    expect(patched).toContain("FATAL_ERROR");
    expect(patched).toContain("Missing prebuilt oniguruma");
  });

  it("is idempotent — prebuild re-runs every plugin on every build", () => {
    const once = plugin.spliceOnigPath(UPSTREAM);
    expect(plugin.spliceOnigPath(once)).toBe(once);
  });

  it("throws when upstream reshapes the call, rather than silently no-op'ing", () => {
    // If the dependency bump renames the variable or drops the call, the patch
    // cannot apply — failing loudly here beats shipping a host-linked APK that
    // only breaks on machines with distro oniguruma.
    expect(() => plugin.spliceOnigPath("project(X)\n")).toThrow(
      /find_library\(ONIG_LIB/,
    );
  });

  it("ships the vendored prebuilt for every ABI it patches", () => {
    // The plugin's whole premise: the per-ABI .so exists to point at.
    const libDir = path.resolve(
      __dirname,
      "../node_modules/react-native-shiki-engine/android",
    );
    for (const abi of ["arm64-v8a", "armeabi-v7a", "x86", "x86_64"]) {
      const so = path.join(libDir, "src", "main", "jniLibs", abi, "libonig.so");
      expect(() => readFileSync(so)).not.toThrow();
    }
  });
});
