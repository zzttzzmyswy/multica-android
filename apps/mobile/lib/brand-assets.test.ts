/**
 * Brand-assets consistency test — locks the Multica official icon invariants.
 *
 * Enforces that the rasterised launcher / adaptive / notification icons:
 *   1. use the SAME starburst geometry as the web favicon
 *      (apps/web/public/favicon.svg — the geometry is parsed, not duplicated);
 *   2. carry the specified size / PNG colour-type / alpha layout;
 *   3. use the official desktop-sampled palette (dark blue-gray gradient bg,
 *      light gray star fill, pure-white notification glyph).
 *
 * Any future hand-edit of assets/ that drifts from the spec fails here.
 * Rebake the icons with `node scripts/generate-brand-icons.ts`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import {
  FAVICON_POINTS,
  FAVICON_SVG_PATH,
  FG_SCALE,
  ICON_BG_GRADIENT_CENTER,
  ICON_BG_GRADIENT_EDGE,
  ICON_SCALE,
  NOTIFICATION_DENSITIES,
  NOTIFICATION_SCALE,
  NOTIFICATION_STAR_FILL,
  STAR_FILL,
  loadFaviconSvg,
  parseSvgPolygon,
  type Point,
} from "../scripts/brand-icon";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(HERE, "../assets");

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

const STAR_RGB = hexRgb(STAR_FILL);
const WHITE_RGB = hexRgb(NOTIFICATION_STAR_FILL);
const BG_EDGE_RGB = hexRgb(ICON_BG_GRADIENT_EDGE);
const BG_CENTER_RGB = hexRgb(ICON_BG_GRADIENT_CENTER);

interface Decoded {
  width: number;
  height: number;
  data: Buffer;
  colorType: number; // 2 = RGB, 6 = RGBA
}

function decodePng(rel: string): Decoded {
  const bytes = readFileSync(path.join(ASSETS, rel));
  const png = PNG.sync.read(bytes);
  return {
    width: png.width,
    height: png.height,
    data: png.data,
    colorType: bytes[25],
  };
}

function rgbaAt(img: Decoded, x: number, y: number): [number, number, number, number] {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

function near(
  got: [number, number, number],
  want: readonly [number, number, number],
  tol: number,
): boolean {
  return got.every((c, k) => Math.abs(c - want[k]) <= tol);
}

function pointInPolygon(px: number, py: number, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const edgesCross =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (edgesCross) inside = !inside;
  }
  return inside;
}

/** Final canvas coordinates for the favicon polygon at the given scale. */
function project(points: Point[], size: number, scale: number): Point[] {
  const half = size / 2;
  const unit = size / 100;
  return points.map(([x, y]) => [half + (x - 50) * scale * unit, half + (y - 50) * scale * unit]);
}

/**
 * Verify the icon's starburst (classified by alpha for transparent-bg assets,
 * by star color for the opaque full-bleed launcher master) matches the
 * favicon polygon. Antialiased edge pixels may straddle the boundary, so
 * allow a small mismatch budget.
 */
function expectShapeMatchesFavicon(
  rel: string,
  scale: number,
  maxMismatchRate: number,
  classify: "alpha" | "color" = "alpha",
) {
  const img = decodePng(rel);
  const poly = project(FAVICON_POINTS, img.width, scale);
  let total = 0;
  let mismatch = 0;
  const stride = img.width >= 1024 ? 8 : 2;
  for (let y = 0; y < img.height; y += stride) {
    for (let x = 0; x < img.width; x += stride) {
      const inside = pointInPolygon(x + 0.5, y + 0.5, poly);
      const px = rgbaAt(img, x, y);
      let isStar: boolean;
      if (classify === "alpha") {
        isStar = px[3] > 120;
      } else {
        // opaque full-bleed: the star is the light-gray fill, background is
        // the dark gradient — classify by proximity to the star color.
        isStar = near([px[0], px[1], px[2]], STAR_RGB, 30);
      }
      total += 1;
      if (inside !== isStar) mismatch += 1;
    }
  }
  expect(mismatch / total).toBeLessThan(maxMismatchRate);
}

describe("brand icon geometry source", () => {
  it("parses the SAME 24-vertex starburst polygon as the web favicon", () => {
    const fresh = parseSvgPolygon(loadFaviconSvg());
    expect(FAVICON_POINTS).toEqual(fresh);
    expect(FAVICON_POINTS).toHaveLength(24);
    expect(FAVICON_SVG_PATH).toContain("apps/web/public/favicon.svg");
  });
});

describe("launcher master icon (asset icon.png)", () => {
  it("is 1024×1024 RGBA, opaque corners, gradient bg and light-gray star", () => {
    const img = decodePng("icon.png");
    expect(img.width).toBe(1024);
    expect(img.height).toBe(1024);
    expect(img.colorType).toBe(6);

    const [cr, cg, cb, ca] = rgbaAt(img, 8, 8);
    expect(ca).toBe(255); // square full-bleed — no transparency under launcher masks
    expect(near([cr, cg, cb], BG_EDGE_RGB, 10)).toBe(true); // radial gradient reaches the corner

    const [sr, sg, sb] = rgbaAt(img, 512, 300); // deep inside the vertical beam
    expect(near([sr, sg, sb], STAR_RGB, 10)).toBe(true); // official light-gray star fill

    const [mr, mg, mb] = rgbaAt(img, 512, 512); // star center — must NOT be the old red node
    expect(near([mr, mg, mb], STAR_RGB, 30)).toBe(true);
    expect(Math.max(mr, mg, mb) - Math.min(mr, mg, mb)).toBeLessThan(30); // neutral gray, no color cast
  });

  it("carves exactly the favicon starburst shape (light-gray star on gradient)", () => {
    expectShapeMatchesFavicon("icon.png", ICON_SCALE, 0.005, "color");
  });
});

describe("adaptive background (asset adaptive-bg.png)", () => {
  it("is 1024×1024 RGB (no alpha) with the dark blue-gray radial gradient", () => {
    const img = decodePng("adaptive-bg.png");
    expect(img.width).toBe(1024);
    expect(img.height).toBe(1024);
    expect(img.colorType).toBe(2);

    const [cr, cg, cb] = rgbaAt(img, 8, 8);
    expect(near([cr, cg, cb], BG_EDGE_RGB, 10)).toBe(true);

    const [sr, sg, sb] = rgbaAt(img, 512, 512);
    expect(near([sr, sg, sb], BG_CENTER_RGB, 6)).toBe(true);
  });
});

describe("adaptive foreground (asset adaptive-fg.png)", () => {
  it("is 1024×1024 RGBA with transparent corners and a centered light-gray star", () => {
    const img = decodePng("adaptive-fg.png");
    expect(img.width).toBe(1024);
    expect(img.height).toBe(1024);
    expect(img.colorType).toBe(6);

    expect(rgbaAt(img, 8, 8)[3]).toBe(0); // four corners transparent
    expect(rgbaAt(img, 8, 1015)[3]).toBe(0);
    expect(rgbaAt(img, 1015, 8)[3]).toBe(0);
    expect(rgbaAt(img, 1015, 1015)[3]).toBe(0);

    const [, , , centerA] = rgbaAt(img, 512, 512);
    expect(centerA).toBe(255);
  });

  it("keeps the favicon starburst inside the adaptive safe zone", () => {
    expectShapeMatchesFavicon("adaptive-fg.png", FG_SCALE, 0.005);
    // safe zone = central 66/108 (61%) — star scale 0.60 keeps beams inside it
    expect(FG_SCALE).toBeLessThan(0.61);
  });
});

describe("notification small icons (white star glyphs)", () => {
  it.each(Object.entries(NOTIFICATION_DENSITIES))(
    "ic_notification_%s.png is %s×%s RGBA, transparent corners, white star",
    (_density, size) => {
      const rel = `android-notification/ic_notification_${_density}.png`;
      const img = decodePng(rel);
      expect(img.width).toBe(Number(size));
      expect(img.height).toBe(Number(size));
      expect(img.colorType).toBe(6);

      expect(rgbaAt(img, 1, 1)[3]).toBe(0);
      expect(rgbaAt(img, 1, Number(size) - 2)[3]).toBe(0);
      expect(rgbaAt(img, Number(size) - 2, 1)[3]).toBe(0);
      expect(rgbaAt(img, Number(size) - 2, Number(size) - 2)[3]).toBe(0);

      const center = img.width / 2;
      const [r, g, b, a] = rgbaAt(img, center, center);
      expect(a).toBe(255);
      expect(near([r, g, b], WHITE_RGB, 25)).toBe(true); // pure white, status-bar legible
    },
  );

  it.each(Object.entries(NOTIFICATION_DENSITIES))(
    "ic_notification_%s.png carves the favicon starburst",
    (_density, size) => {
      expectShapeMatchesFavicon(
        `android-notification/ic_notification_${_density}.png`,
        NOTIFICATION_SCALE,
        0.02,
      );
    },
  );
});