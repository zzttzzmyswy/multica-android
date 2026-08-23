import type { ExpoConfig, ConfigContext } from "expo/config";

/**
 * Dynamic Expo config — replaces app.json so we can read APP_ENV at runtime
 * and switch bundleIdentifier / display name for dev / staging / production.
 *
 * APP_ENV is set by package.json scripts:
 *   - dev          → APP_ENV unset (treated as "development")
 *   - dev:staging  → APP_ENV=staging
 *   - dev:prod     → APP_ENV=production (rare; usually only for EAS build)
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const env = process.env.APP_ENV ?? "development";
  const isProd = env === "production";
  const isStaging = env === "staging";

  return {
    ...config,
    name: isProd
      ? "Multica"
      : isStaging
        ? "Multica (Staging)"
        : "Multica (Dev)",
    slug: "multica-mobile",
    version: "0.5.18",
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
      versionCode: 518,
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
      package: isProd
        ? (process.env.EXPO_ANDROID_PACKAGE_PROD ?? "ai.multica.mobile")
        : isStaging
          ? "ai.multica.mobile.staging"
          : (process.env.EXPO_ANDROID_PACKAGE_DEV ?? "ai.multica.mobile.dev"),
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
    ],
    extra: { APP_ENV: env },
  };
};
