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

// Dead-font stripper. expo-router pulls in `expo-symbols` (and through it
// `@expo-google-fonts/material-symbols`) as a transitive dependency, which the
// RN gradle plugin's `createBundle<variant>JsAndAssets` task copies into
// `build/generated/res/react/<variant>/raw/` on every build — shorthand `res/raw`
// font resources (~6.8MB across the 100Thin..700Bold weight variants). The app
// imports zero of them and uses plain JS `<Tabs>` from expo-router (see
// apps/mobile/app/(app)/[workspace]/(tabs)/_layout.tsx — NativeTabs was tried and
// dropped), so no runtime code path ever `loadAsync`s these fonts; they are dead
// weight whose `tools:keep` entry in the generated keep.xml hides them from
// shrinkResources.
//
// We can't drop them at the JS/dependency layer (expo-router hard-depends on
// expo-symbols), so we strip them from the generated res/react raw dir at the
// start of each merge, then neutralise their keep.xml entries so resource
// shrinking stays consistent. This must run inside the merge task (not just the
// generator's doLast) because the generator re-creates the files every build and
// an up-to-date generator would skip a doLast hook.
const STRIP_DEAD_FONTS_GRADLE = `
// Multica: strip expo-symbols' Material Symbols raw fonts (dead resources) and
// their keep.xml entries before resource merging, injected from
// plugins/with-abi-splits.js. Preserves ionicons (the one font the app loads).
tasks.whenTaskAdded { t ->
  if (t.name ==~ /merge.*Resources/) {
    t.doFirst {
      def reactRes = layout.buildDirectory.dir("generated/res/react").get().asFile
      if (!reactRes.exists()) return
      reactRes.eachDirRecurse { dir ->
        if (dir.name != "raw") return
        dir.listFiles({ f ->
          f.isFile() && f.name.endsWith(".ttf") && f.name.toLowerCase().contains("materialsymbols")
        } as java.io.FileFilter)?.each { f ->
          logger.lifecycle("Multica: stripping dead font resource \${f.name}")
          f.delete()
        }
        def keep = new File(dir, "keep.xml")
        def s = keep.exists() ? keep.getText("UTF-8") : ""
        def deadKeep = ",@raw/__node_modules_pnpm_expogooglefontsmaterialsymbols[^,]+"
        def cleaned = s.replaceAll(deadKeep as String, "")
        // Also drop a leading '@raw/...materialsymbols' if it was first.
        cleaned = cleaned.replaceAll("@raw/__node_modules_pnpm_expogooglefontsmaterialsymbols[^,]+" as String, "")
        if (cleaned != s) keep.setText(cleaned, "UTF-8")
      }
    }
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
      // The dead-font strip splice needs to sit at the end of the gradle file,
      // outside the android {} block, so `tasks.whenTaskAdded` is active during
      // configuration.
      if (!cfg.modResults.contents.includes("strip expo-symbols' Material Symbols raw fonts")) {
        cfg.modResults.contents =
          cfg.modResults.contents.trimEnd() + "\n" + STRIP_DEAD_FONTS_GRADLE + "\n";
      }
      return cfg;
    }),
  );
};