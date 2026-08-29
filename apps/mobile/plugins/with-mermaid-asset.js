// Multica Mermaid-asset config plugin for Android.
//
// The generated apps/mobile/android/ tree is gitignored (Expo convention), so
// mermaid.min.js (the 3.1MB diagram runtime loaded by ```mermaid fences via
// file:///android_asset/) must be injected at prebuild time from the mermaid
// devDependency. A fresh clone that runs `expo prebuild` without this plugin
// would silently ship an APK whose diagram WebView can't find its runtime —
// the fence falls back to the error card. Idempotent: re-runs overwrite the
// same single asset.
const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

function withMermaidAsset(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const from = path.join(
        projectRoot,
        "node_modules",
        "mermaid",
        "dist",
        "mermaid.min.js",
      );
      if (!fs.existsSync(from)) {
        throw new Error(
          `Missing mermaid runtime: expected ${from} (pnpm install pulls it as a devDependency).`,
        );
      }
      const assetsDir = path.join(
        config.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "assets",
      );
      fs.mkdirSync(assetsDir, { recursive: true });
      fs.copyFileSync(from, path.join(assetsDir, "mermaid.min.js"));
      return config;
    },
  ]);
}

module.exports = withMermaidAsset;