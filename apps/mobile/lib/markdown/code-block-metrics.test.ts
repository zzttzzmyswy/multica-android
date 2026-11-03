/**
 * Pins that fenced code blocks scale their LINE HEIGHT with the system font
 * size (MYS-2558).
 *
 * The defect: at a raised system font scale the last line of a code block was
 * clipped by the block's bottom edge — text drawn below the container, exactly
 * what the reaction-bar overlap looked like one block up.
 *
 * Cause: the code runs are styled with a Tailwind `leading-*` step, which is an
 * ABSOLUTE px line height. React Native scales `fontSize` with the system font
 * scale by default (`allowFontScaling`), but it does NOT scale a px
 * `lineHeight`. So at font_scale > 1 the glyphs grew while the line box stayed
 * put, and every line below the first (plus the block's own bottom padding) ate
 * into the last line's box.
 *
 * Why this is asserted at the source level: mobile's vitest lane is Node-only
 * (see vitest.config.ts), so there is no RN renderer to measure a real Text.
 * What can be pinned is the invariant that made it fail — the code text style
 * must not carry a fixed-px line height, and must derive it from the same
 * scale factor the font size uses.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..", "..");

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const TOKENS = "lib/markdown/tokens.ts";

describe("code block text metrics", () => {
  it("does not pin the line height to a fixed px step", () => {
    // `leading-5` / `leading-[20px]` are absolute; they do not follow the
    // system font scale, so they desync from a scaling fontSize.
    const src = code(TOKENS);
    const cls = src.match(/CODE_BLOCK_TEXT_CLASS\s*=\s*([\s\S]*?);/)?.[1] ?? "";
    expect(cls).not.toMatch(/\bleading-\d/);
    expect(cls).not.toMatch(/leading-\[[^\]]*px\]/);
  });

  it("scales the line height from the same factor as the font size", () => {
    // A ratio form (`leading-relaxed`) or an explicit scaled value both work;
    // what matters is that the line box is not a constant.
    const src = code(TOKENS);
    const cls = src.match(/CODE_BLOCK_TEXT_CLASS\s*=\s*([\s\S]*?);/)?.[1] ?? "";
    expect(cls).toMatch(/leading-(relaxed|normal|snug|tight|loose)|lineHeight/);
  });
});
