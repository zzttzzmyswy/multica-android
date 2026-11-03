/**
 * Guard for the `react-native-enriched-markdown` spacer-line patch.
 *
 * The overlap bugs (MYS-2538 chat bubbles, MYS-2555 comment reaction bar) are
 * library bugs, fixed upstream but in no published release yet — see
 * `patches/README.md`. Until a release ships them, we carry the fixes as a pnpm
 * patch. The risk of a carried patch is that it silently outlives its reason:
 * the library gets fixed, the patch keeps applying, and the next reader has no
 * way to tell whether it is still load-bearing.
 *
 * Two assertions hold both ends:
 *
 *   - the installed copy really carries BOTH halves of the fix (if the patch
 *     stopped applying, the bugs are back and nothing else would say so);
 *   - the installed version is one we have NOT seen the upstream fix in, so the
 *     day a release includes it this fails and says "drop the patch" instead of
 *     the patch quietly rotting.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** `<app root>/node_modules/<pkg>` — this file lives at `lib/markdown/`, so the
 *  app root is two levels up. Resolved through `node_modules` rather than by
 *  import so the check reads the file that is actually on disk after pnpm has
 *  applied (or failed to apply) the patch. */
const APP_ROOT = path.resolve(__dirname, "..", "..");
const PKG = path.join(
  APP_ROOT,
  "node_modules/react-native-enriched-markdown",
);

/** Releases verified to predate the upstream fixes (2026-10-30). When a version
 *  outside this list is installed, check whether it contains both halves and
 *  then either extend this list or delete the patch. */
const KNOWN_UNFIXED = ["0.5.0"];

function read(rel: string): string {
  return readFileSync(path.join(PKG, rel), "utf8");
}

const SPAN =
  "android/src/main/java/com/swmansion/enriched/markdown/spans/LineHeightSpan.kt";
const LIST =
  "android/src/main/java/com/swmansion/enriched/markdown/renderer/ListRenderer.kt";
const FLAGS =
  "android/src/main/java/com/swmansion/enriched/markdown/utils/text/span/SpanFlags.kt";
const SETUP =
  "android/src/main/java/com/swmansion/enriched/markdown/utils/text/view/TextViewSetup.kt";
const MEASURE =
  "android/src/main/java/com/swmansion/enriched/markdown/MeasurementStore.kt";

describe("enriched-markdown spacer-line patch", () => {
  it("half 1 — paragraph line heights skip spacer lines", () => {
    const src = read(SPAN);
    // The behavioural assertion, not the comment: the span must decline to
    // resize a line that MarginBottomSpan owns.
    expect(src).toMatch(/if \(isSpacerLine\(text, start, end\)\) return/);
  });

  it("half 1 — keeps the MarginBottomSpan hand-off that makes it correct", () => {
    // The guard is only right because the other span sets those lines. If a
    // future patch removed that, skipping here would leave spacers unsized.
    expect(read(SPAN)).toMatch(
      /text\.getSpans\(start, end, MarginBottomSpan::class\.java\)\.isNotEmpty\(\)/,
    );
  });

  it("half 2 — the list-wide line height is set at max span priority", () => {
    // Skipping spacers does NOT fix a list: the list's span is set after its
    // items' margin spans, so priority is what decides which one wins — and
    // the two layouts disagree without it. This is the half that fixed the
    // last bullet drawing over the reaction bar.
    expect(read(LIST)).toMatch(
      /createLineHeightSpan\(style\.lineHeight\),\s*\n\s*start,\s*\n\s*builder\.length,\s*\n\s*SPAN_FLAGS_LINE_HEIGHT_PRIORITY,/,
    );
  });

  it("half 2 — the priority flag really carries SPAN_PRIORITY", () => {
    // A constant that quietly lost its priority bits would make the assertion
    // above pass while changing nothing at runtime.
    expect(read(FLAGS)).toMatch(
      /SPAN_FLAGS_LINE_HEIGHT_PRIORITY\s*=\s*\n?\s*Spanned\.SPAN_EXCLUSIVE_EXCLUSIVE or Spanned\.SPAN_PRIORITY/,
    );
  });

  it("half 3 — the drawing TextView breaks lines like the measuring one", () => {
    // The measuring StaticLayout sets BREAK_STRATEGY_HIGH_QUALITY; TextView
    // defaults to SIMPLE. For CJK the two pick different break points, so the
    // same text at the same width can render a different NUMBER of lines. Yoga
    // then sizes the block from the measuring pass while the TextView draws
    // taller, and the overflow lands past the block's bottom edge — on the
    // reaction bar under an issue comment.
    //
    // This asymmetry is why the bug looked content-dependent: it only appears
    // when the two strategies disagree, so most comments render fine.
    const src = read(SETUP);
    expect(src).toMatch(/breakStrategy = .*BREAK_STRATEGY_HIGH_QUALITY/);
    // The measuring side must still agree. If someone changes one without the
    // other, the disagreement is back and this whole family of bugs returns.
    expect(read(MEASURE)).toMatch(
      /setBreakStrategy\(LineBreaker\.BREAK_STRATEGY_HIGH_QUALITY\)/,
    );
  });

  it("is still needed — drop it once a release carries the upstream fix", () => {
    const version: string = JSON.parse(
      readFileSync(path.join(PKG, "package.json"), "utf8"),
    ).version;
    expect(
      KNOWN_UNFIXED,
      `react-native-enriched-markdown ${version} was upgraded. Check whether ` +
        `spans/LineHeightSpan.kt still needs isSpacerLine AND ` +
        `renderer/ListRenderer.kt still needs SPAN_FLAGS_LINE_HEIGHT_PRIORITY ` +
        `(see patches/README.md); if upstream now ships both, delete the patch ` +
        `and this test.`,
    ).toContain(version);
  });
});
