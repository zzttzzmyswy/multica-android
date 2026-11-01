/**
 * Guard for the `react-native-enriched-markdown` spacer-line patch.
 *
 * The chat overlap bug (MYS-2538) is a library bug, fixed upstream but in no
 * published release yet — see `patches/README.md`. Until a release ships it, we
 * carry the fix as a pnpm patch. The risk of a carried patch is that it silently
 * outlives its reason: the library gets fixed, the patch keeps applying, and the
 * next reader has no way to tell whether it is still load-bearing.
 *
 * Two assertions hold both ends:
 *
 *   - the installed copy really carries the fix (if the patch stopped applying,
 *     the bug is back and nothing else would say so);
 *   - the installed version is one we have NOT seen the upstream fix in, so the
 *     day a release includes `isSpacerLine` this fails and says "drop the
 *     patch" instead of the patch quietly rotting.
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

/** Releases verified to predate the upstream fix (2026-10-30). When a version
 *  outside this list is installed, check whether it contains `isSpacerLine` and
 *  then either extend this list or delete the patch. */
const KNOWN_UNFIXED = ["0.5.0"];

function read(rel: string): string {
  return readFileSync(path.join(PKG, rel), "utf8");
}

const SPAN =
  "android/src/main/java/com/swmansion/enriched/markdown/spans/LineHeightSpan.kt";

describe("enriched-markdown spacer-line patch", () => {
  it("is applied to the installed package", () => {
    const src = read(SPAN);
    // The behavioural assertion, not the comment: the span must decline to
    // resize a line that MarginBottomSpan owns.
    expect(src).toMatch(/if \(isSpacerLine\(text, start, end\)\) return/);
  });

  it("keeps the MarginBottomSpan hand-off that makes the fix correct", () => {
    // The guard is only right because the other span sets those lines. If a
    // future patch removed that, skipping here would leave spacers unsized.
    expect(read(SPAN)).toMatch(
      /text\.getSpans\(start, end, MarginBottomSpan::class\.java\)\.isNotEmpty\(\)/,
    );
  });

  it("is still needed — drop it once a release carries the upstream fix", () => {
    const version: string = JSON.parse(
      readFileSync(path.join(PKG, "package.json"), "utf8"),
    ).version;
    expect(
      KNOWN_UNFIXED,
      `react-native-enriched-markdown ${version} was upgraded. Check whether ` +
        `spans/LineHeightSpan.kt still needs the isSpacerLine guard from ` +
        `patches/README.md; if upstream now ships it, delete the patch and ` +
        `this test.`,
    ).toContain(version);
  });
});
