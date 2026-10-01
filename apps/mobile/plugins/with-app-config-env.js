// Android build config-plugin: pin expo-constants' embedded `assets/app.config`
// to the package id the APK is actually installed under.
//
// The generated apps/mobile/android/ tree is gitignored (Expo prebuild output),
// so this has to be re-spliced on every prebuild from tracked source.
//
// The bug this exists for: `APP_ENV` selects the Android package id in
// app.config.ts (`production` -> ai.multica.mobile, unset -> ...mobile.dev), and
// the two ends of the build read that variable through different processes.
//
//   - `expo prebuild` (package.json's `android:prod`) runs with APP_ENV set, so
//     it bakes applicationId=ai.multica.mobile into the manifest and into the
//     generated android/app/build.gradle.
//   - `./gradlew assembleRelease` is run *without* APP_ENV. expo-constants'
//     createExpoConfig task shells out to `scripts/getAppConfig.js`, which
//     re-evaluates app.config.ts in a fresh Node process that inherits only the
//     ambient env — so APP_ENV falls back to "development" and the embedded
//     config says ai.multica.mobile.dev.
//
// The result is an APK whose manifest package and embedded config disagree. The
// iteration-186 release APKs were exactly this: `aapt2 dump packagename` said
// ai.multica.mobile while `assets/app.config` said ai.multica.mobile.dev.
//
// It is silent because the runtime reads the *embedded config*, not the
// manifest: every `Constants.expoConfig` consumer sees the dev id on a
// production install. The visible damage was the self-update flow's "allow
// installs from this source" deep-link, which scoped users to a settings page
// for a package they did not have.
//
// The fix derives APP_ENV from the applicationId Gradle is already building, so
// the embedded config cannot disagree with the manifest no matter what env the
// gradle invocation carries — and a stray APP_ENV in the shell cannot desync
// them either. `scripts/verify-apk.mjs` asserts the two agree on every artifact.
//
// CommonJS on purpose: Expo's config-plugin resolver requires plugin modules
// through Node `require`, so a plain .js module works where a raw .ts would
// fail to resolve.
const { withProjectBuildGradle } = require("@expo/config-plugins");

const MARKER = "Multica: keep the embedded app config's package id honest";

// applicationId -> APP_ENV, mirroring the package table in app.config.ts.
// Ordered most-specific-first so a prefix relationship cannot mis-resolve.
// The derivation goes by package id rather than by env on purpose: the package
// id is what Gradle has already committed to by the time this task runs.
const PACKAGE_TO_ENV = [
  ["ai.multica.mobile.staging", "staging"],
  ["ai.multica.mobile", "production"],
];

/** APP_ENV that produces `packageName` in app.config.ts (development otherwise). */
function appEnvForPackage(packageName) {
  const hit = PACKAGE_TO_ENV.find(([pkg]) => pkg === packageName);
  return hit ? hit[1] : "development";
}

const SPLICE = `
// ${MARKER} (plugins/with-app-config-env.js).
//
// expo-constants regenerates assets/app.config at Gradle time via
// getAppConfig.js, which re-evaluates app.config.ts in a *new* Node process
// that does not inherit the APP_ENV a prebuild run was given. APP_ENV then
// falls back to "development" and the embedded config claims the .dev package
// while the manifest — and the installed app — are the production one.
//
// Deriving APP_ENV from the applicationId Gradle is actually building makes the
// two agree by construction. Set explicitly, not inherited, so a stray APP_ENV
// in the caller's shell cannot desync them.
def multicaAppEnvForPackage = { appId ->
${PACKAGE_TO_ENV.map(([pkg, env]) => `  if (appId == '${pkg}') return '${env}'`).join("\n")}
  return 'development'
}

subprojects { sub ->
  sub.tasks.matching { it.name == 'createExpoConfig' }.configureEach { t ->
    t.doFirst {
      def appProject = rootProject.findProject(':app')
      if (appProject == null) return
      def appId = appProject.android.defaultConfig.applicationId
      if (appId == null) return
      t.environment 'APP_ENV', multicaAppEnvForPackage(appId)
    }
  }
}
`;

/**
 * Append the splice to a root `build.gradle`'s contents. In-place on a string,
 * idempotent (the marker guards re-application), and a no-op for a file that
 * already carries it.
 */
function spliceProjectBuildGradle(contents) {
  if (contents.includes(MARKER)) return contents;
  return contents.trimEnd() + "\n" + SPLICE;
}

module.exports = function withAppConfigEnv(config) {
  return withProjectBuildGradle(config, (cfg) => {
    cfg.modResults.contents = spliceProjectBuildGradle(cfg.modResults.contents);
    return cfg;
  });
};

module.exports.MARKER = MARKER;
module.exports.PACKAGE_TO_ENV = PACKAGE_TO_ENV;
module.exports.appEnvForPackage = appEnvForPackage;
module.exports.spliceProjectBuildGradle = spliceProjectBuildGradle;
module.exports.SPLICE = SPLICE;
