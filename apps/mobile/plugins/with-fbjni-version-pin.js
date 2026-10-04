// Pin `com.facebook.fbjni:fbjni` to the version React Native itself ships.
//
// `react-native-shiki-engine` declares its fbjni dependency with a DYNAMIC
// version (`implementation "com.facebook.fbjni:fbjni:+"`, build.gradle:152).
// Gradle resolves a dynamic version to whatever is newest on Maven Central at
// build time — a landmine with a delayed fuse. On 2026-09-28 that resolved to
// fbjni 0.8.1, whose native `libfbjni.so` is built against a newer NDK's
// libc++ and imports `__cxa_init_primary_exception`. Every other native library
// in this app is compiled by NDK 27.1.12297006 and links the NDK 27
// `libc++_shared.so`, which does not export that symbol, so the APK built fine
// and then died at startup:
//
//   dlopen failed: cannot locate symbol "__cxa_init_primary_exception"
//   referenced by ".../lib/arm64-v8a/libfbjni.so"
//   → com.facebook.soloader.B: couldn't find DSO to load: libfbjni.so
//
// React Native 0.83.6 pins fbjni 0.7.0 (`gradle/libs.versions.toml:23`), and
// that is the version the rest of the tree is built and tested against, so we
// force it for the whole build. This keeps the app on the exact combination
// every earlier release shipped, independent of what gets published upstream.
//
// The pin is applied as a resolution strategy on all subprojects, which — unlike
// editing the library's own build.gradle — survives `pnpm install` (a
// node_modules edit is wiped by any reinstall; see build-fixes.sh for the same
// reasoning applied to the onig patch). Generated `android/` is gitignored, so
// this plugin is the only durable place for the pin.
//
// Injected from app.config.ts plugins[]. CommonJS on purpose: Expo's
// config-plugin resolver requires plugin modules through Node `require`.
const { withProjectBuildGradle } = require("@expo/config-plugins");

// Must track `fbjni` in apps/mobile/node_modules/react-native/gradle/libs.versions.toml.
const FBJNI_VERSION = "0.7.0";

const MARKER = "Multica: pin fbjni";

const PIN_BLOCK = `
// ${MARKER} — see plugins/with-fbjni-version-pin.js for why.
// react-native-shiki-engine asks for "com.facebook.fbjni:fbjni:+", and a dynamic
// version means any future upstream release can silently break the APK at
// startup (0.8.1 did: it needs a libc++ symbol NDK 27 does not export). Force
// the version React Native 0.83.6 pins instead of whatever is newest.
allprojects {
  configurations.all {
    resolutionStrategy {
      force "com.facebook.fbjni:fbjni:${FBJNI_VERSION}"
    }
  }
}
`;

/**
 * Splice the pin into a root build.gradle body. Exported (and kept free of any
 * Expo mod plumbing) so the splice is unit-testable without running a full
 * `expo prebuild` — see plugins/with-fbjni-version-pin.test.ts. Idempotent:
 * prebuild re-runs every plugin on every build, so a second pass must not stack
 * a second `allprojects` block.
 */
function spliceFbjniPin(contents) {
  if (contents.includes(MARKER)) return contents;
  return contents.trimEnd() + "\n" + PIN_BLOCK;
}

module.exports = function withFbjniVersionPin(config) {
  return withProjectBuildGradle(config, (cfg) => {
    cfg.modResults.contents = spliceFbjniPin(cfg.modResults.contents);
    return cfg;
  });
};

module.exports.FBJNI_VERSION = FBJNI_VERSION;
module.exports.MARKER = MARKER;
module.exports.spliceFbjniPin = spliceFbjniPin;
