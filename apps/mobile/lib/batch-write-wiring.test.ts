/**
 * Iteration 272 — wiring ratchet for the batch write's success claim.
 *
 * `lib/batch-write-outcome.test.ts` proves the DECISIONS (what a short count
 * means, whether the selection survives). The mobile vitest lane is Node-only
 * (`vitest.config.ts`: no RN renderer), so that says nothing about whether the
 * bar asks the server at all. The defect this round fixes lived exactly in that
 * gap: the outcome layer could be perfect while `batch-action-bar.tsx` still
 * announced the size of the SELECTION as if it were the committed count — and
 * every unit test would stay green.
 *
 * Same shape and same comment-stripping rule as
 * `lib/wakeup-write-wiring.test.ts`: an assertion must match real code, so a
 * comment that merely describes the wiring cannot satisfy it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");

/** Source with comments removed — an assertion must match real code. */
function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("the batch bar settles against the server's committed count", () => {
  const bar = code("components/issue/batch-action-bar.tsx");

  it("asks the decision layer instead of deciding inline", () => {
    // The must-agree point with web. A hand-rolled comparison here would drift
    // silently, and the null-vs-zero distinction is load-bearing.
    expect(bar).toContain("batchWriteOutcome(");
    expect(bar).toContain("batchSelectionAfter(");
    expect(bar).toContain("batchToastKind(");
  });

  it("reads the count off the mutation result rather than the selection size", () => {
    // The defect itself: `t("batch.updateSuccess", { count })` where `count`
    // was `selectedIssues.length`. The success sentence now gets the count the
    // server committed, and the update/delete callbacks destructure it.
    expect(bar).toMatch(/onSuccess:\s*\(result\)\s*=>/);
    expect(bar).toContain("result.updated");
    expect(bar).toContain("result.deleted");
  });

  it("has a partial sentence per write kind, in both locales", () => {
    expect(bar).toContain("batch.updatePartial");
    expect(bar).toContain("batch.deletePartial");
    for (const locale of ["en", "zh"]) {
      const dict = JSON.parse(
        readFileSync(
          path.join(APP_ROOT, `lib/i18n/locales/${locale}.json`),
          "utf8",
        ),
      ) as Record<string, string>;
      expect(dict["batch.updatePartial"]).toBeTruthy();
      expect(dict["batch.deletePartial"]).toBeTruthy();
    }
  });

  it("keeps the selection on a short write (the skipped rows are the retry handle)", () => {
    // Guard against a regression to "always clear": the exit must be gated on
    // the decision layer's verdict, never called unconditionally.
    expect(bar).not.toMatch(/onSuccess:\s*\(\)\s*=>\s*\{\s*clear\(\)/);
    expect(bar).toContain('batchSelectionAfter(outcome, oneShotSurface) === "exit"');
  });

  it("wires the one-shot flag from the sub-issue call site only", () => {
    // Web's `clearSelectionOnApply` is on for the inline sub-issue toolbar and
    // off for full-screen lists. Mobile must not set it everywhere.
    const detail = code("app/(app)/[workspace]/issue/[id].tsx");
    expect(detail).toContain("<BatchActionBar issues={children.data ?? []} oneShot />");

    for (const rel of [
      "app/(app)/[workspace]/(tabs)/my-issues.tsx",
      "app/(app)/[workspace]/more/issues.tsx",
      "components/project/project-issue-surface.tsx",
    ]) {
      const src = code(rel);
      const call = src.match(/<BatchActionBar[^>]*\/>/)?.[0] ?? "";
      expect(call).toBeTruthy();
      expect(call).not.toContain("oneShot");
    }
  });
});
