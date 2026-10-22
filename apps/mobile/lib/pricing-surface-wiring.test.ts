/**
 * Wiring ratchet for the token / cache-share figures on the three surfaces
 * that state them (iteration 268, MYS-2317).
 *
 * `lib/model-pricing.test.ts` proves the helpers are correct, and
 * `lib/issue-run-timeline.test.ts` proves the totals are summed right. Neither
 * can see the defect this round actually shipped: each surface computed its
 * own cache share inline, with its own denominator and its own rounding, so
 * one issue quoted two different hit rates depending on which screen you were
 * on — and the phone's runs header quoted none at all.
 *
 * So each surface is checked for the specific construct that went wrong:
 *
 *   - the per-issue usage sheet must call the shared helper, not inline math;
 *   - the runtime usage page must call it too, from the same buckets;
 *   - the runs header must read `timeline.tokens` (it did not exist before),
 *     and must not re-derive a share from raw buckets it does not have.
 *
 * Comments are stripped before matching, so a comment that merely *describes*
 * the right call cannot satisfy an assertion.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const DIALOG = "components/issue/usage-breakdown-dialog.tsx";
const RUNTIME_SECTION = "components/runtimes/runtime-usage-section.tsx";
const PANEL = "components/issue/run-timeline-panel.tsx";

/** The division both surfaces used to do by hand. */
const INLINE_SHARE = /cacheRead\s*\/\s*\(?\s*\w+\.input\s*\+\s*\w+\.cacheRead/;

describe("one cache share, computed once", () => {
  it("the per-issue usage sheet calls the shared helper", () => {
    const src = code(DIALOG);
    expect(src).toContain("cacheHitRatePercent(");
    expect(src, "must pass all three input-side buckets").toMatch(
      /cacheHitRatePercent\(\s*\w+\.input,\s*\w+\.cacheRead,\s*\w+\.cacheWrite,?\s*\)/,
    );
    expect(src, "must not divide by hand again").not.toMatch(INLINE_SHARE);
  });

  it("the runtime usage page calls the same helper", () => {
    const src = code(RUNTIME_SECTION);
    expect(src).toContain("cacheHitRatePercent(");
    expect(src).toMatch(
      /cacheHitRatePercent\(\s*\w+\.input,\s*\w+\.cacheRead,\s*\w+\.cacheWrite,?\s*\)/,
    );
    expect(src, "must not divide by hand again").not.toMatch(INLINE_SHARE);
  });

  it("neither surface invents its own rounding rule", () => {
    // The helper rounds-then-caps; a local `Math.round(... * 100)` is the
    // second rule that produced two answers for one issue.
    for (const rel of [DIALOG, RUNTIME_SECTION]) {
      const src = code(rel);
      expect(src, `${rel} must not re-round a share`).not.toMatch(
        /Math\.(round|floor)\(\s*\(?\s*\w+\.cacheRead/,
      );
    }
  });

  it("a null share renders as an em dash, never as 0%", () => {
    // "No input-side traffic" is not "0% hit". Web renders the em dash at
    // `usage-section.tsx:274`; both mobile surfaces have to match, and a
    // surface that only handles the number case silently prints "0%".
    for (const rel of [DIALOG, RUNTIME_SECTION]) {
      const src = code(rel);
      expect(src, `${rel} must branch on a null share`).toMatch(
        /cacheHitRate\s*==\s*null/,
      );
    }
  });
});

describe("the runs header states web's token figures", () => {
  it("reads the timeline's token totals", () => {
    const src = code(PANEL);
    // The field did not exist before this round: the header had no denominator
    // for a share, which is why it stated none.
    expect(src).toMatch(/timeline\.tokens\.total/);
    expect(src).toMatch(/timeline\.tokens\.output/);
  });

  it("states the cache share from the ratio helper, not a local percent", () => {
    const src = code(PANEL);
    expect(src).toContain("cacheHitRateRatio(timeline.tokens)");
    expect(src, "the panel must not price or divide buckets itself").not.toMatch(
      /timeline\.tokens\.cacheRead\s*\/\s*/,
    );
  });

  it("keeps the em dash for a timeline that reported no usage", () => {
    // Same rule as the spend slot: a run set with no usage has no figure, and
    // "0" would claim it did no work.
    const src = code(PANEL);
    const tokensStat = src.slice(src.indexOf("runsTimeline.statTokens"));
    expect(tokensStat).toContain("timeline.pricedCount > 0");
    expect(tokensStat).toContain('"—"');
  });
});
