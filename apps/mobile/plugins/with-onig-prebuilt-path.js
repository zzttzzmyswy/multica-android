// Point react-native-shiki-engine's Android CMake build at the per-ABI
// prebuilt libonig.so instead of letting find_library fall back to the HOST one.
//
// The library ships `android/CMakeLists.txt` with:
//
//   find_library(ONIG_LIB onig
//       PATHS ${CMAKE_CURRENT_SOURCE_DIR}/src/main/jniLibs/${ANDROID_ABI}
//       NO_CMAKE_FIND_ROOT_PATH
//       REQUIRED)
//
// `NO_CMAKE_FIND_ROOT_PATH` makes CMake search the BUILD MACHINE's library
// paths as well as the NDK sysroot's. On a distro that has oniguruma installed
// (Arch: /usr/lib/libonig.so, a host x86-64 build), find_library prefers it
// over the vendored Android .so and the aarch64 link dies with:
//
//   ld.lld: error: /usr/lib/libonig.so is incompatible with aarch64linux
//
// The failure is machine-dependent: the same tree builds fine on a host without
// distro oniguruma. That is exactly how it slipped through — iter-181 patched
// this file in place under node_modules, so the fix lived in a gitignored
// directory, survived until the next `pnpm install`, and then the error came
// back on a fresh worktree with no tracked change explaining it. Same class of
// bug as the floating fbjni version handled by with-fbjni-version-pin.js: a
// build that depends on machine state rather than on tracked source.
//
// Fix: rewrite the CMakeLists at prebuild time to set ONIG_LIB directly from
// the vendored path, with `CACHE ... FORCE` so a stale value already in the
// CMake cache cannot win. Idempotent — prebuild re-runs every plugin on every
// build, and the rewrite is a pure function of the marker's absence.
//
// Injected from app.config.ts plugins[]. CommonJS on purpose: Expo's
// config-plugin resolver requires plugin modules through Node `require`.
const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const MARKER = "Multica: point ONIG_LIB at the prebuilt";

/** webpack/vitest-safe twin of the splice, exported for unit tests. */
function spliceOnigPath(contents) {
  if (contents.includes(MARKER)) return contents;

  const vendored = `if(EXISTS "\${CMAKE_CURRENT_SOURCE_DIR}/src/main/jniLibs/\${ANDROID_ABI}/libonig.so")
    set(ONIG_LIB "\${CMAKE_CURRENT_SOURCE_DIR}/src/main/jniLibs/\${ANDROID_ABI}/libonig.so" CACHE FILEPATH "" FORCE)
else()
    message(FATAL_ERROR "Missing prebuilt oniguruma for ABI \${ANDROID_ABI}")
endif()`;

  // Replace the whole find_library(ONIG_LIB ...) call, whatever its exact
  // whitespace — a dependency bump that reflows the arguments must not
  // silently stop the patch from applying.
  const call = /find_library\(\s*ONIG_LIB\b[\s\S]*?\)\s*\n/;
  if (!call.test(contents)) {
    throw new Error(
      `with-onig-prebuilt-path: no find_library(ONIG_LIB ...) call found in the shiki-engine CMakeLists. ` +
        `The upstream file changed shape; re-check the host-oniguruma fallback before removing this plugin.`,
    );
  }
  return contents.replace(call, `# ${MARKER} — see plugins/with-onig-prebuilt-path.js for why.\n${vendored}\n`);
}

module.exports = function withOnigPrebuiltPath(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      // pnpm's real path (the package is a symlinked store entry).
      const libDir = path.join(
        projectRoot,
        "node_modules",
        "react-native-shiki-engine",
        "android",
      );
      const cmakeLists = path.join(
        fs.realpathSync(libDir),
        "CMakeLists.txt",
      );

      const before = fs.readFileSync(cmakeLists, "utf8");
      fs.writeFileSync(cmakeLists, spliceOnigPath(before));

      // The prebuilt must actually be there; without it the build would fail
      // later with a confusing CMake FATAL_ERROR instead of here.
      for (const abi of ["arm64-v8a", "armeabi-v7a", "x86", "x86_64"]) {
        const so = path.join(fs.realpathSync(libDir), "src", "main", "jniLibs", abi, "libonig.so");
        if (!fs.existsSync(so)) {
          throw new Error(
            `with-onig-prebuilt-path: missing vendored libonig.so for ${abi} at ${so}.`,
          );
        }
      }
      return config;
    },
  ]);
};

module.exports.MARKER = MARKER;
module.exports.spliceOnigPath = spliceOnigPath;
