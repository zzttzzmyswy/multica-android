// Android build-tune config-plugin for the Multica client.
//
// The generated apps/mobile/android/ tree is gitignored (Expo convention), so
// authoritative build config has to live in tracked source and be spliced in at
// prebuild time. Two things are handled here:
//
// 1. ABI splitting — when `android.enableSplitPerAbi` is true, assembleRelease /
//    bundleRelease produce one APK per architecture (~41 MB minified for arm64)
//    instead of a universal package, and the App Bundle delivers the same
//    saving via Play's on-demand per-ABI download. Idempotent: no-op when a
//    `splits {` block already exists.
//
// 2. Release code/resource shrinking — R8 minify + shrinkResources are defaulted
//    ON via gradle.properties (the official template's build.gradle already
//    reads `android.enableMinifyInReleaseBuilds` / `android.enableShrinkResourcesInReleaseBuilds`).
//    About 13% smaller arm64 installs; project proguard-rules.pro keeps
//    reanimated/worklets/turbomodule classes (verified post-shrink). Override on
//    the CLI with -Pandroid.enableMinifyInReleaseBuilds=false to turn off.
//
// CommonJS on purpose: Expo's config-plugin resolver requires plugin modules
// through Node `require`, so a plain .js module works where a raw .ts would
// fail to resolve.
const {
  withAppBuildGradle,
  withGradleProperties,
} = require("@expo/config-plugins");

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

// Default the release build to R8 + resource shrinking. The template reads
// these via findProperty with a 'false' fallback, so seeding them ON here makes
// shrink the default; `-Pandroid.enableMinifyInReleaseBuilds=false` still wins
// because a command-line -P overrides gradle.properties.
function withReleaseMinify(config) {
  return withGradleProperties(config, (cfg) => {
    const mods = cfg.modResults; // array of {type:'property'|'comment'|'empty', ...}
    const has = (key) => mods.some((p) => p.type === "property" && p.key === key);
    if (!has("android.enableMinifyInReleaseBuilds")) {
      mods.push({
        type: "comment",
        value: "Multica: R8/shrink releases by default (from plugins/with-abi-splits.js)",
      });
      mods.push({ type: "property", key: "android.enableMinifyInReleaseBuilds", value: "true" });
      mods.push({ type: "property", key: "android.enableShrinkResourcesInReleaseBuilds", value: "true" });
    }
    return cfg;
  });
}

module.exports = function withAbiSplits(config) {
  return withReleaseMinify(
    withAppBuildGradle(config, (cfg) => {
      if (!cfg.modResults.contents.includes("splits {")) {
        // Insert at the end of the android { } block, just before androidResources.
        cfg.modResults.contents = cfg.modResults.contents.replace(
          /(\n\s*androidResources \{)/,
          `${ABI_SPLITS_GRADLE_BLOCK}$1`,
        );
      }
      return cfg;
    }),
  );
};