// Multica KaTeX-asset config plugin for Android.
//
// Twin of with-mermaid-asset.js: the generated apps/mobile/android/ tree is
// gitignored, so katex.min.js + katex.min.css + fonts/ (loaded by MathBlock's
// WebView via file:///android_asset/) must be injected at prebuild time from
// the katex dependency. A fresh clone that runs `expo prebuild` without this
// plugin would silently ship an APK whose math WebView can't find its runtime
// — every equation falls back to the source-code error card. Idempotent:
// re-runs overwrite the same assets.
const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyRecursive(from, to);
    else fs.copyFileSync(from, to);
  }
}

function withKatexAsset(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const dist = path.join(
        projectRoot,
        "node_modules",
        "katex",
        "dist",
      );
      if (!fs.existsSync(path.join(dist, "katex.min.js"))) {
        throw new Error(
          `Missing katex runtime: expected ${path.join(dist, "katex.min.js")} (pnpm install pulls it as a dependency).`,
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
      fs.copyFileSync(
        path.join(dist, "katex.min.js"),
        path.join(assetsDir, "katex.min.js"),
      );
      fs.copyFileSync(
        path.join(dist, "katex.min.css"),
        path.join(assetsDir, "katex.min.css"),
      );
      copyRecursive(
        path.join(dist, "fonts"),
        path.join(assetsDir, "fonts"),
      );
      return config;
    },
  ]);
}

module.exports = withKatexAsset;
