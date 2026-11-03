/**
 * Wiring ratchet for the cloud runtime dialog's node timestamps (iteration 284,
 * MYS-2580).
 *
 * `lib/cloud-runtime-format.test.ts` proves the formatter localizes its output
 * *given* a locale. It cannot prove the component PASSES one: the helper is
 * pure, so a call site that omits the argument still satisfies every assertion
 * in that file — the default parameter silently reads the i18n store, which is
 * correct only if the component also subscribes to locale changes. Screens
 * mounted before a language switch would otherwise keep the old language.
 *
 * That is the same failure mode iteration 278 pinned for the heatmap, and the
 * same one `lib/format-date.ts` documents. Two mechanisms, deliberately
 * redundant:
 *   1. This ratchet stops a call site that hardcodes a tag or omits the
 *      argument entirely.
 *   2. The "no local locale mapping" assertion stops the hand-written
 *      `locale === "zh" ? "zh-CN" : "en-US"` ternary, which is the drift
 *      `getIntlLocale()` exists to prevent.
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

const DIALOG = "components/runtimes/cloud-runtime-dialog.tsx";

describe("cloud runtime dialog timestamps resolve through the app locale", () => {
  it("passes the Intl locale to the formatter at the call site", () => {
    const src = code(DIALOG);
    expect(src).toContain(
      "formatCloudRuntimeNodeCreatedAt(node.created_at, intlLocale)",
    );
  });

  it("reads the Intl tag from the shared hook, not a local ternary", () => {
    const src = code(DIALOG);
    expect(src).toContain("useIntlLocale()");
    expect(src).not.toMatch(/locale\s*===\s*["']zh["']\s*\?/);
  });

  it("does not hardcode a locale tag at the call site", () => {
    const src = code(DIALOG);
    expect(src).not.toMatch(
      /formatCloudRuntimeNodeCreatedAt\([^)]*,\s*["'`]/,
    );
  });

  it("leaves no bare Intl formatter falling back to the device locale", () => {
    const src = code(DIALOG);
    // `Intl.DateTimeFormat(undefined, …)` is exactly the defect: undefined is
    // "the device's language", not the app's.
    expect(src).not.toMatch(/DateTimeFormat\(\s*undefined/);
  });
});
