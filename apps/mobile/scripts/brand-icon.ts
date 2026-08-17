/**
 * Multica brand-icon spec — single source of truth for the official starburst
 * mark used across the mobile app's launcher / adaptive / notification icons.
 *
 * The geometry is not free-drawn: it is parsed from the web favicon
 * (`apps/web/public/favicon.svg`), so every raster asset here is guaranteed
 * same-source as the official web mark. `lib/brand-assets.test.ts` enforces
 * that guarantee per-build: any drift between these assets and the favicon
 * fails the test suite.
 *
 * Drawn on the 100×100 favicon box and scaled around its center (50,50) into
 * the target canvas. "Scale" is the star's size as a fraction of the canvas;
 * e.g. 0.63 puts each beam tip at 18.5% in from the edge, the desktop icon's
 * footprint.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Point = [number, number];

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Repo path to the official favicon SVG — the geometry source of truth. */
export const FAVICON_SVG_PATH = path.resolve(HERE, "../../web/public/favicon.svg");

export function loadFaviconSvg(): string {
  return readFileSync(FAVICON_SVG_PATH, "utf8");
}

export const FAVICON_POINTS: Point[] = parseSvgPolygon(loadFaviconSvg());

/** Colors derived from the official desktop icon (apps/desktop/resources/icon.png). */
export const ICON_BG_GRADIENT_CENTER = "#3A3F4A"; // (58, 63, 74) — desktop bg bright center
export const ICON_BG_GRADIENT_EDGE = "#131824"; // (19, 24, 36) — desktop bg edge
export const STAR_FILL = "#CBCDD2"; // (203, 205, 210) — desktop star light gray
export const NOTIFICATION_STAR_FILL = "#FFFFFF"; // pure white for status-bar small icons

/** Star footprint as a fraction of the canvas, around the canvas center. */
export const ICON_SCALE = 0.63; // full-bleed icon.png — matches the desktop mark's footprint
export const FG_SCALE = 0.6; // adaptive foreground — keeps the mark inside the 66/108 safe zone
export const NOTIFICATION_SCALE = 0.75; // small icon — glyph large enough to read when shrunk

/** Notification small-icon glyph sizes per Android density bucket (24dp base). */
export const NOTIFICATION_DENSITIES = {
  mdpi: 24,
  hdpi: 36,
  xhdpi: 48,
  xxhdpi: 72,
  xxxhdpi: 96,
} as const;

export function parseSvgPolygon(svg: string): Point[] {
  const m = svg.match(/<polygon[^>]*points="([^"]+)"/s);
  if (!m) throw new Error("No <polygon points=...> found in favicon SVG");
  return m[1]
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      if (Number.isNaN(x) || Number.isNaN(y)) {
        throw new Error(`Bad polygon coordinate pair: ${pair}`);
      }
      return [x, y] as Point;
    });
}

/** Scale the favicon polygon (100-box, centered on 50/50) into an N×N canvas. */
export function polygonPointsForCanvas(
  points: Point[],
  size: number,
  scale: number,
): string {
  const half = size / 2;
  const unit = size / 100;
  return points
    .map(([x, y]) => {
      const px = half + (x - 50) * scale * unit;
      const py = half + (y - 50) * scale * unit;
      return `${px.toFixed(2)},${py.toFixed(2)}`;
    })
    .join(" ");
}

export interface IconSvgOptions {
  size: number;
  bgGradient: boolean;
  star?: { fill: string; scale: number };
}

/** Build an SVG string that sharp can render to the requested icon PNG. */
export function buildIconSvg({ size, bgGradient, star }: IconSvgOptions): string {
  const half = size / 2;
  // userSpaceOnUse radial gradient: radius = half-diagonal so the gradient's
  // edge colour lands exactly on the square corners (deterministic + testable).
  const gradient = bgGradient
    ? `<defs><radialGradient id="bg" gradientUnits="userSpaceOnUse" cx="${half}" cy="${half}" r="${(half * Math.SQRT2).toFixed(2)}">
    <stop offset="0%" stop-color="${ICON_BG_GRADIENT_CENTER}"/>
    <stop offset="100%" stop-color="${ICON_BG_GRADIENT_EDGE}"/>
  </radialGradient></defs>`
    : "";
  const bg = bgGradient
    ? `<rect width="${size}" height="${size}" fill="url(#bg)"/>`
    : "";
  const poly = star
    ? `<polygon fill="${star.fill}" points="${polygonPointsForCanvas(
        FAVICON_POINTS,
        size,
        star.scale,
      )}"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="geometricPrecision">${gradient}${bg}${poly}</svg>`;
}