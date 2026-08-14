// ABI splitting config-plugin for the Multica Android client.
//
// The generated apps/mobile/android/ tree is gitignored (Expo convention), so
// authoritative build config has to live in tracked source and be spliced in at
// prebuild time. When `android.enableSplitPerAbi` is true, assembleRelease /
// bundleRelease produce one APK per architecture (~45 MB for arm64) instead of
// the 107 MB universal, and the App Bundle delivers the same saving via Play's
// on-demand per-ABI download. Idempotent: no-op when a `splits {` block exists.
//
// CommonJS on purpose: Expo's config-plugin resolver requires plugin modules
// through Node `require`, so a plain .js module works where a raw .ts would
// fail to resolve.
const { withAppBuildGradle } = require("@expo/config-plugins");

const ABI_SPLITS_GRADLE_BLOCK = `
    // Multica Android: ABI splitting, injected from plugins/with-abi-splits.js.
    // Handsets install only their own arch's native libs, cutting single-device
    // install from ~107 MB to ~45 MB. Disable with -Pandroid.enableSplitPerAbi=false.
    splits {
        abi {
            enable = (findProperty('android.enableSplitPerAbi') ?: 'true').toBoolean()
            reset()
            include 'armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64'
            universalApk false
        }
    }
`;

module.exports = function withAbiSplits(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes("splits {")) {
      // Insert at the end of the android { } block, just before androidResources.
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /(\n\s*androidResources \{)/,
        `${ABI_SPLITS_GRADLE_BLOCK}$1`,
      );
    }
    return cfg;
  });
};