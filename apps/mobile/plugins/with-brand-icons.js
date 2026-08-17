// Multica brand-icon config plugin for Android.
//
// The generated apps/mobile/android/ tree is gitignored (Expo convention), so
// the notification small icon lives in tracked source (assets/android-notification/*)
// and is copied into the native res/ tree at prebuild time, alongside the
// manifest meta-data that points system notifications at it.
//
// Three surfaces are wired by prebuild itself (no code needed here):
//   - legacy launcher icon  -> from assets/icon.png
//   - adaptive background   -> from assets/adaptive-bg.png
//   - adaptive foreground   -> from assets/adaptive-fg.png
// (declared in app.config.ts `icon` / `android.adaptiveIcon`).
//
// This plugin only owns the notification small icon: the white starburst glyph
// Android shows in the status bar / heads-up for any notification the app emits
// (FCM, expo-notifications, or a future in-app channel). Both meta-data keys
// below are recognised by those stacks; harmless when neither is installed.
const {
  withAndroidManifest,
  withDangerousMod,
} = require("@expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const NOTIFICATION_DENSITIES = ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"];

const NOTIFICATION_IMPORT_KEYS = [
  // Firebase Messaging small-icon fallback.
  "com.google.firebase.messaging.default_notification_icon",
  // expo-notifications small-icon fallback.
  "expo.modules.notifications.default_notification_icon",
];

function withNotificationIcon(config) {
  config = withDangerousMod(config, [
    "android",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const srcDir = path.join(projectRoot, "assets", "android-notification");
      const resDir = path.join(
        config.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "res",
      );
      for (const density of NOTIFICATION_DENSITIES) {
        const from = path.join(srcDir, `ic_notification_${density}.png`);
        if (!fs.existsSync(from)) {
          throw new Error(`Missing notification icon source: ${from}`);
        }
        const drawableDir = path.join(resDir, `drawable-${density}`);
        fs.mkdirSync(drawableDir, { recursive: true });
        fs.copyFileSync(from, path.join(drawableDir, "ic_notification.png"));
      }
      return config;
    },
  ]);

  config = withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (!app) return cfg;
    const metas = app["meta-data"] ?? [];
    for (const key of NOTIFICATION_IMPORT_KEYS) {
      if (!metas.some((m) => m.$?.["android:name"] === key)) {
        metas.push({
          $: {
            "android:name": key,
            "android:resource": "@drawable/ic_notification",
          },
        });
      }
    }
    app["meta-data"] = metas;
    return cfg;
  });

  return config;
}

module.exports = withNotificationIcon;