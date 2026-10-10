import type { ExpoConfig, ConfigContext } from "expo/config";

import releaseIdentity from "./release-identity.json";

/**
 * Dynamic Expo config — replaces app.json so we can read APP_ENV at runtime
 * and switch bundleIdentifier / display name for dev / staging / production.
 *
 * APP_ENV is set by package.json scripts:
 *   - dev          → APP_ENV unset (treated as "development")
 *   - dev:staging  → APP_ENV=staging
 *   - dev:prod     → APP_ENV=production (rare; usually only for EAS build)
 *
 * The Android package id is NOT derived from APP_ENV alone: the `production`
 * branch resolves to `release-identity.json`, the one id every published
 * release installs under. Android treats a changed package id as a different
 * app, so a release that moved it would install *beside* existing users
 * instead of over them — which is exactly what v0.6.17 did. See
 * `lib/release-identity.ts`, `scripts/verify-apk.mjs`, and docs/android-build.md.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const env = process.env.APP_ENV ?? "development";
  const isProd = env === "production";
  const isStaging = env === "staging";

  const androidPackage = isProd
    ? (process.env.EXPO_ANDROID_PACKAGE_PROD ?? releaseIdentity.androidPackage)
    : isStaging
      ? "ai.multica.mobile.staging"
      : (process.env.EXPO_ANDROID_PACKAGE_DEV ?? "ai.multica.mobile.dev");

  return {
    ...config,
    name: isProd
      ? "Multica"
      : isStaging
        ? "Multica (Staging)"
        : "Multica (Dev)",
    slug: "multica-mobile",
    version: "0.6.52",
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    scheme: "multica",
    // App icon master — the official Multica starburst, same polygon as the
    // web favicon (apps/web/public/favicon.svg), light-gray fill over the
    // desktop icon's deep slate radial gradient. Regenerate with
    // `node scripts/generate-brand-icons.ts`; invariants are locked by
    // `lib/brand-assets.test.ts`. MYS-355.
    icon: "./assets/icon.png",
    android: {
      // Explicit versionCode — `expo prebuild` defaults to 1 when unset, which
      // regresses on every fresh prebuild (`adb install -r` then fails with
      // INSTALL_FAILED_VERSION_DOWNGRADE against a previously installed build).
      // Convention: minor*100 + patch — keep it monotonic with every
      // `version` bump so self-hosted APK updates always upgrade. Shown as the
      // About-page "build" number (Constants.platform.android.versionCode).
      versionCode: 652,
      // Adaptive icon: separate full-bleed background + centered foreground so
      // Android launchers can mask them into circles / squiggles cleanly.
      adaptiveIcon: {
        backgroundColor: "#131824",
        backgroundImage: "./assets/adaptive-bg.png",
        foregroundImage: "./assets/adaptive-fg.png",
      },
      // Per-variant android package, mirroring the iOS bundleIdentifier so
      // dev / staging / prod builds can coexist. This is the core Android
      // adaptation that lets a single Expo codebase ship to Android too.
      //
      // The release id comes from release-identity.json, not a literal here:
      // Android treats a changed package id as a different app, so this value
      // is what makes an in-app update replace the installed app instead of
      // sitting beside it. `scripts/verify-apk.mjs` asserts every built
      // artifact matches it, which is what stops the id moving again.
      package: androidPackage,
    },
    ios: {
      supportsTablet: false,
      // Per-variant bundle id overrides exist for one reason: an Apple ID
      // can only sign bundle prefixes it owns, so contributors not on the
      // Multica Apple Developer team (and external users self-building a
      // personal copy against production) need to swap to a reverse-domain
      // they control. Each variant has its own `_<VARIANT>` suffix and is
      // only read inside that variant's branch — a generic
      // `EXPO_BUNDLE_IDENTIFIER` would leak across variants (Expo CLI
      // auto-loads `.env.<mode>.local` regardless of APP_ENV) and collapse
      // dev / staging / prod onto a single id.
      bundleIdentifier: isProd
        ? (process.env.EXPO_BUNDLE_IDENTIFIER_PROD ?? "ai.multica.mobile")
        : isStaging
          ? "ai.multica.mobile.staging"
          : (process.env.EXPO_BUNDLE_IDENTIFIER_DEV ?? "ai.multica.mobile.dev"),
    },
    plugins: [
      "expo-router",
      "expo-secure-store",
      "@react-native-community/datetimepicker",
      "react-native-enriched-markdown",
      [
        "expo-image-picker",
        {
          // iOS NSPhotoLibraryUsageDescription. Without this string in
          // Info.plist, calling launchImageLibraryAsync hard-crashes on
          // iOS 14+. Camera + microphone are disabled — we only ever read
          // from the existing photo library.
          photosPermission:
            "Allow Multica to access your photos to attach images to issues and comments.",
          cameraPermission: false,
          microphonePermission: false,
        },
      ],
      [
        "expo-build-properties",
        {
          ios: {
            buildReactNativeFromSource: true,
          },
        },
      ],
      // Keeps the ABI-splitting gradle config in tracked source (the generated
      // android/ tree is gitignored); injects on every prebuild, idempotently.
      "./plugins/with-abi-splits.js",
      // Copies the white starburst notification small icon into res/drawable-*
      // and points system notifications at it (idempotent). See the plugin.
      "./plugins/with-brand-icons.js",
      // Copies mermaid.min.js (```mermaid fence runtime) into the APK's assets
      // at prebuild time; android/ is gitignored so this is the only way a fresh
      // clone builds a diagram-capable APK. See the plugin. Rich-content, MYS-799.
      "./plugins/with-mermaid-asset.js",
      // Copies katex.min.js + katex.min.css + fonts/ (math-block WebView
      // runtime) into the APK's assets at prebuild time — same gitignored-
      // android/ reasoning as the mermaid plugin above. Rich-content, MYS-1005.
      "./plugins/with-katex-asset.js",
      // Pins com.facebook.fbjni:fbjni to React Native's own version. shiki-engine
      // declares it as a dynamic "+" version, so an upstream release can silently
      // produce an APK that dies at startup (0.8.1 did). See the plugin.
      "./plugins/with-fbjni-version-pin.js",
      // Repoints shiki-engine's ONIG_LIB at its vendored per-ABI libonig.so.
      // Its CMakeLists uses find_library with NO_CMAKE_FIND_ROOT_PATH, so a host
      // with distro oniguruma links /usr/lib/libonig.so into an aarch64 target
      // and fails. See the plugin (iter-181 fixed this in node_modules only,
      // which a reinstall wipes).
      "./plugins/with-onig-prebuilt-path.js",
      // Raises the Gradle daemon's metaspace ceiling, which the prebuild
      // template leaves at 512m — too low for an all-ABI release build. See
      // the plugin and docs/android-build.md.
      "./plugins/with-gradle-jvmargs.js",
      // Pins expo-constants' gradle-time `assets/app.config` regeneration to the
      // applicationId Gradle is building, so a release APK's embedded config
      // cannot name the .dev package while its manifest names the production
      // one. See the plugin and docs/android-build.md.
      "./plugins/with-app-config-env.js",
    ],
    extra: { APP_ENV: env },
  };
};
