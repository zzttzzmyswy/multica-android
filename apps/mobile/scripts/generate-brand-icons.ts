/**
 * Regenerate the Multica-brand icon assets from the web favicon polygon.
 *
 *   node scripts/generate-brand-icons.ts
 *
 * Writes (relative to apps/mobile/):
 *   assets/icon.png                  – 1024×1024 RGBA, full-bleed gradient + star (legacy/launcher master)
 *   assets/adaptive-bg.png           – 1024×1024 RGB, gradient only (adaptive background)
 *   assets/adaptive-fg.png           – 1024×1024 RGBA, star on transparent (adaptive foreground)
 *   assets/android-notification/*.png – white star small icons per density (notification glyphs)
 *
 * Geometry and colors come from scripts/brand-icon.ts, which parses the
 * polygon directly from apps/web/public/favicon.svg — so regenerating always
 * tracks the official mark.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  FAVICON_POINTS,
  ICON_SCALE,
  FG_SCALE,
  STAR_FILL,
  NOTIFICATION_STAR_FILL,
  NOTIFICATION_SCALE,
  NOTIFICATION_DENSITIES,
  buildIconSvg,
} from "./brand-icon.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(HERE, "../assets");

function writePng(svg: string, file: string, removeAlpha: boolean) {
  let pipeline = sharp(Buffer.from(svg)).png();
  // CSS rgba is not allowed in SVG polygon fill here; keep everything opaque,
  // and strip the alpha channel only for RGB-mode assets (adaptive background).
  if (removeAlpha) pipeline = pipeline.removeAlpha();
  return pipeline.toFile(file);
}

async function main() {
  mkdirSync(path.join(ASSETS, "android-notification"), { recursive: true });
  const size = 1024;

  // icon.png — legacy launcher master: opaque square, radial gradient + star.
  await writePng(buildIconSvg({ size, bgGradient: true, star: { fill: STAR_FILL, scale: ICON_SCALE } }), path.join(ASSETS, "icon.png"), false);

  // adaptive-bg.png — adaptive background, RGB (no alpha), gradient only.
  await writePng(buildIconSvg({ size, bgGradient: true }), path.join(ASSETS, "adaptive-bg.png"), true);

  // adaptive-fg.png — adaptive foreground, RGBA star centered, corners transparent.
  await writePng(buildIconSvg({ size, bgGradient: false, star: { fill: STAR_FILL, scale: FG_SCALE } }), path.join(ASSETS, "adaptive-fg.png"), false);

  // Notification small icons — white star per Android density bucket.
  for (const [density, px] of Object.entries(NOTIFICATION_DENSITIES)) {
    const svg = buildIconSvg({ size: px, bgGradient: false, star: { fill: NOTIFICATION_STAR_FILL, scale: NOTIFICATION_SCALE } });
    await writePng(svg, path.join(ASSETS, "android-notification", `ic_notification_${density}.png`), false);
  }

  console.log(
    `Regenerated ${Object.values(NOTIFICATION_DENSITIES).length + 3} icons from ${FAVICON_POINTS.length} favicon polygon points.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});