/**
 * Design tokens for the in-house code block component. Prose markdown
 * styling lives in `markdown-style.ts` (passed to enriched-markdown).
 *
 * All values stick to Tailwind's built-in scale — no arbitrary `text-[Npx]`.
 */

/** Block code (fenced ``` blocks). */
// 13px (not text-sm/14) + leading-5 (20) matches GitHub Mobile / Linear iOS /
// Notion iOS code-block sizing. Mono glyphs are visually denser than PingFang
// at the same point size, so 14 reads as "louder than body" inside a card —
// 13 brings the block in line with surrounding prose without sacrificing
// readability. `MD_FONT.codeBlock` in markdown-style.ts mirrors this value
// for list-nested code that renders through enriched-markdown.
// `leading-relaxed` (ratio 1.625), NOT a fixed `leading-5`.
//
// A px `leading-*` step is an ABSOLUTE line box: React Native scales `fontSize`
// with the system font scale (`allowFontScaling` defaults true) but leaves a px
// `lineHeight` alone, so at font_scale > 1 the glyphs grew while the line box
// stayed — the last line of every code block was clipped by the block's bottom
// edge (MYS-2558). A ratio keeps the two locked together at every scale.
//
// 1.625 on 13pt gives ~21pt, one point above the old fixed 20 — the same
// rhythm at 1.0x, with enough room for mono glyphs that sit taller than
// PingFang at the same point size.
export const CODE_BLOCK_TEXT_CLASS =
  "text-label leading-relaxed font-mono text-foreground";
// `px-3 py-2` (was `p-3`): horizontal breathing room kept (short one-liners
// like `pnpm install` still don't crowd the border) while vertical chrome
// drops 4px top + 4px bottom, taking ~12% off the block height.
// Vertical breathing room outside the block is handled by the parent
// `<View className="gap-3">` in `markdown.tsx`, not per-child margin.
export const CODE_BLOCK_CONTAINER_CLASS =
  "bg-code-surface border border-border rounded-lg px-3 py-2";
// No `uppercase tracking-wide` — those turn "ts" into "T S" which reads as
// a label-strip / advertising banner and competes with the code itself for
// attention. Lowercase muted text is the GitHub Mobile / Notion iOS pattern.
export const CODE_BLOCK_LANG_LABEL_CLASS =
  "text-caption text-muted-foreground mb-1";
