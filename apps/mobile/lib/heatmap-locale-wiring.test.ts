/**
 * Wiring ratchet for the activity heatmap's month labels (iteration 278).
 *
 * `lib/runtime-usage-analyze.test.ts` proves `computeHeatmapCells` localizes
 * its month labels *given* a locale. It cannot prove the component PASSES one:
 * the function is pure, so a call site that omits the argument (or hardcodes
 * "en") still satisfies every assertion in that file.
 *
 * That is not hypothetical — it is the defect this ratchet pins. The widget
 * draws two label sets in one frame: the weekday row labels, built in
 * `runtime-usage-section.tsx` from the app locale, and the month labels, built
 * by `computeHeatmapCells` from `opts.locale ?? "en"`. The call site omitted
 * the argument, so a Chinese screen read "周一 … 周日" with "Aug Sep Oct"
 * directly above it. The same failure mode `lib/format-date.ts` warns about.
 *
 * Two mechanisms, deliberately redundant:
 *   1. The `opts.locale` argument is now REQUIRED on `computeHeatmapCells`, so
 *      omitting it is a `tsc` error. That stops the "forgot to pass it" shape.
 *   2. This ratchet stops the "passed a constant instead" shape, which
 *      type-checks fine but reinstates the bug for every locale but one.
 *
 * Comments are stripped before matching so a comment that merely *describes*
 * the wiring cannot satisfy an assertion.
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

const SECTION = "components/runtimes/runtime-usage-section.tsx";

describe("heatmap labels resolve through the app locale", () => {
  it("passes the locale to computeHeatmapCells", () => {
    const src = code(SECTION);
    expect(src).toContain("computeHeatmapCells(usage, tz, { locale: intlLocale })");
  });

  it("does not hardcode a locale at the heatmap call site", () => {
    const src = code(SECTION);
    // Any string literal as the locale would re-break every other language.
    expect(src).not.toMatch(/computeHeatmapCells\([^)]*locale:\s*["'`]/);
  });

  it("reads the Intl tag from the shared hook, not a local ternary", () => {
    const src = code(SECTION);
    expect(src).toContain("useIntlLocale()");
    // The hand-written mapping that let the two label sets drift apart.
    expect(src).not.toMatch(/locale\s*===\s*["']zh["']\s*\?/);
  });

  it("carries the locale into the memo deps so a language switch repaints", () => {
    const src = code(SECTION);
    const call = src.slice(src.indexOf("computeHeatmapCells(usage, tz"));
    const deps = call.slice(call.indexOf("["), call.indexOf("]") + 1);
    expect(deps).toContain("intlLocale");
  });
});
