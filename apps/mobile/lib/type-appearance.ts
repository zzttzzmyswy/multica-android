/**
 * Type appearance — the mobile side of web's Appearance > Interface text
 * (MYS-2931).
 *
 * Web exposes the interface font size as a slider over `FONT_SIZES`
 * (12–16, default 14) writing `--font-scale` = size/14 onto `<html>`; every
 * `--text-*` token in `packages/ui/styles/tokens.css` is
 * `calc(Npx * var(--font-scale, 1))`, so sizes AND line-heights scale while
 * spacing and layout stay put (that file says so and this module keeps the
 * same rule). Mobile had only light/dark/system and no size control at all,
 * so a phone reader could not adjust the text they read issues in.
 *
 * Three decisions are encoded here rather than at the call sites, because
 * each is easy to get subtly wrong in a way no screen reveals:
 *
 * 1. **"Follow system" is NOT a step.** React Native already scales every
 *    `fontSize` by the OS setting. Our factor MULTIPLIES on top of that, so
 *    "follow system" means "write no factor at all" (the CSS fallback `1`),
 *    not "write 14". Storing 14 instead would make switching the OS setting
 *    look like it worked while the stored preference silently pinned the
 *    scale, and there would be no way back to following the device. The two
 *    states are therefore different values (`"system"` vs a number), never
 *    the same number reached two ways.
 *
 * 2. **An invalid step is never stored.** Web's slider only writes when the
 *    value is in `FONT_SIZES`; anything else leaves the store alone. A
 *    persisted 14.7 (or a string from an older payload, or NaN) would
 *    otherwise survive a restart and render at a size the ladder has no rung
 *    for. `sanitizeFontSize` clamps to a real rung — it does not round to the
 *    nearest, because "nearest" invents a choice the user never made; the
 *    only values that survive are the ones on the ladder.
 *
 * 3. **Line-height moves with the size.** This is the iter-283 / MYS-2559
 *    lesson in its exact form: a px line-height does not follow a scaled
 *    fontSize, so the glyphs grow inside a line box that stayed behind and
 *    the block clips. Every consumer multiplies BOTH — see
 *    `lib/markdown/markdown-style.ts`, whose style object bypasses
 *    NativeWind entirely and must be scaled by hand.
 */

/**
 * The size ladder, transcribed from web `packages/core/appearance/index.ts`
 * (`FONT_SIZES`, `DEFAULT_FONT_SIZE`). Five rungs, 1px apart: the same
 * granularity the web slider offers, so a size picked on one surface is
 * expressible on the other.
 */
export const FONT_SIZES = [12, 13, 14, 15, 16] as const;
export type FontSize = (typeof FONT_SIZES)[number];

/** The rung the ladder is calibrated around — `--font-scale` is size/14. */
export const DEFAULT_FONT_SIZE: FontSize = 14;

/**
 * "Follow the device's font size" — a distinct state, deliberately not a
 * member of `FONT_SIZES` (decision 1 above). Persisted as this literal.
 */
export const FOLLOW_SYSTEM = "system";
export type FontSizeChoice = typeof FOLLOW_SYSTEM | FontSize;

/** A fresh install follows the device, which is what it did before this existed. */
export const DEFAULT_FONT_SIZE_CHOICE: FontSizeChoice = FOLLOW_SYSTEM;

export function isFontSize(value: unknown): value is FontSize {
  return (FONT_SIZES as readonly unknown[]).includes(value);
}

/**
 * Read a persisted size, falling back to "follow system" for anything the
 * ladder cannot express. Never returns a value outside `FONT_SIZES` ∪
 * `{FOLLOW_SYSTEM}` — that is the whole point (decision 2).
 */
export function sanitizeFontSize(value: unknown): FontSizeChoice {
  if (value === FOLLOW_SYSTEM) return FOLLOW_SYSTEM;
  if (isFontSize(value)) return value;
  return DEFAULT_FONT_SIZE_CHOICE;
}

/**
 * The `--font-scale` value for a choice, or `null` to leave the variable
 * unset so the CSS fallback (`1`) applies.
 *
 * `null` rather than the number `1` matters: writing `1` would still be
 * *correct* arithmetically but would leave a variable behind that reads as an
 * explicit choice, and the persisted-state and UI checks both treat "unset"
 * as the follow-system signal.
 */
export function fontScaleFor(choice: FontSizeChoice): number | null {
  if (choice === FOLLOW_SYSTEM) return null;
  return choice / DEFAULT_FONT_SIZE;
}

/**
 * Content line spacing, transcribed from web's `CONTENT_LEADINGS`
 * (`compact` / `default` / `relaxed`, default `default`).
 */
export const CONTENT_LEADINGS = ["compact", "default", "relaxed"] as const;
export type ContentLeading = (typeof CONTENT_LEADINGS)[number];
export const DEFAULT_CONTENT_LEADING: ContentLeading = "default";

export function isContentLeading(value: unknown): value is ContentLeading {
  return (CONTENT_LEADINGS as readonly unknown[]).includes(value);
}

export function sanitizeContentLeading(value: unknown): ContentLeading {
  return isContentLeading(value) ? value : DEFAULT_CONTENT_LEADING;
}

/**
 * Mobile's own body ratio — `MD_LINE.body / MD_FONT.body` in
 * `lib/markdown/markdown-style.ts`. The leading preference is expressed
 * RELATIVE to this, so choosing `default` reproduces the exact line box the
 * app already renders: a setting that changes nothing until it is touched is
 * the only way "default" can be trusted on a screen full of already-tuned
 * blocks (headings carry their own ratios — 1.4 for h1, 1.33 for h2 — and
 * must move in step, not be replaced by one global ratio).
 */
export const MOBILE_BODY_LINE_RATIO = 24 / 14;

/** Target body ratios for each step: 1.5 / 1.714 (current) / 1.95. */
const TARGET_LINE_RATIOS: Record<ContentLeading, number> = {
  compact: 1.5,
  default: MOBILE_BODY_LINE_RATIO,
  relaxed: 1.95,
};

/**
 * Multiply a block's existing line-height by this to honour the leading
 * choice. `default` is exactly 1, so no block moves (0.875 = 1.5/1.714 and
 * 1.1375 = 1.95/1.714 land on the same targets the ratios name).
 */
export function leadingMultiplier(leading: ContentLeading): number {
  return TARGET_LINE_RATIOS[leading] / MOBILE_BODY_LINE_RATIO;
}

/**
 * Scale a design value by the appearance choice. `null` (follow system)
 * leaves it untouched — the device's own scaling is applied downstream by
 * React Native, and applying a factor of 1 here would be indistinguishable
 * but would make "is the user overriding the size?" unanswerable from a
 * computed number.
 */
export function scaledByChoice(value: number, scale: number | null): number {
  return scale === null ? value : value * scale;
}

/**
 * Round a scaled font metric the way React Native will lay it out. Kept
 * separate so tests can pin the rounding without a renderer: fractional
 * `lineHeight` is legal but makes two adjacent blocks disagree about where a
 * line ends, so every scaled metric goes through here.
 */
export function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The two style keys that carry glyph metrics, and the only ones scaled. */
const FONT_METRIC_KEYS = new Set(["fontSize", "lineHeight"]);

/**
 * Return a copy of a style object with every `fontSize` / `lineHeight`
 * scaled — and nothing else.
 *
 * Exists because the markdown renderer cannot use className at all:
 * `react-native-enriched-markdown` takes an imperative style object (md4c →
 * Spannable), so it never sees the `--font-scale` variable that NativeWind
 * resolves for every `text-*` class. Without this, the interface would resize
 * with the setting and every issue description, comment and chat message
 * would not — the one place people actually read.
 *
 * Scaling is restricted to those two keys on purpose. Margins, paddings,
 * gaps, border widths and radii are intentionally left alone: web's
 * `--font-scale` multiplies sizes and line-heights only, "so a larger size
 * never changes spacing or layout" (tokens.css). Scaling a margin here would
 * make the reading column reflow every time the slider moved.
 *
 * Scaling BOTH keys together is the MYS-2558 rule: a scaled `fontSize` inside
 * an unscaled `lineHeight` draws glyphs taller than their line box, which is
 * how the last line of a code block used to be sheared off.
 */
export function scaleTextMetrics<T>(
  style: T,
  scale: number | null,
  leading: number = 1,
): T {
  if (scale === null && leading === 1) return style;
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (typeof value === "number" && FONT_METRIC_KEYS.has(key)) {
        // The leading preference applies to the line box only, never the
        // glyph size — tightening the leading must not shrink the type.
        const factor = key === "lineHeight" ? leading : 1;
        out[key] = roundMetric(scaledByChoice(value, scale) * factor);
      } else {
        out[key] = walk(value);
      }
    }
    return out;
  };
  return walk(style) as T;
}
