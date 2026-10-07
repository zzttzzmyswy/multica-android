/**
 * Wiring ratchet for the issue-side cost surfaces' custom-pricing subscription
 * (iteration 206).
 *
 * `lib/task-usage.test.ts` proves `estimateCost` / `collectUnmappedModels`
 * consult the override store *correctly*, but `estimateCost` reads the store
 * imperatively through `getCustomPricing` — zustand has no way to know a
 * component depended on it. A component that prices usage without subscribing
 * to `pricings` therefore renders a stale figure and never repaints, which no
 * assertion on the pure module can catch.
 *
 * Web hit this and says so at each site it fixed
 * (`packages/views/issues/components/issue-usage-dialog.tsx:52-58`,
 * `execution-log-section.tsx:247`): subscribe to the snapshot and carry it
 * into every memo that prices usage. This ratchet pins the same three places
 * on mobile, because dropping any one of them reintroduces the stale number on
 * exactly that surface.
 *
 * Comments are stripped before matching so a comment that merely *describes*
 * the subscription cannot satisfy an assertion.
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

/** The subscription every priced surface must hold. */
const SUBSCRIBE = "useCustomPricingStore((s) => s.pricings)";

describe("issue cost surfaces subscribe to the custom-pricing store", () => {
  it("runs sheet header total re-prices on a saved override", () => {
    const runs = code("app/(app)/[workspace]/issue/[id]/runs.tsx");
    expect(runs).toContain(SUBSCRIBE);
    // A subscription outside the memo's dependency list still leaves the
    // total stale — the array is what actually re-runs the pricing.
    expect(runs).toMatch(/summarizeTaskUsageAcross\([\s\S]*?\[allTasks, pricings\]/);
  });

  it("usage breakdown sheet re-prices its total and unmapped note", () => {
    const sheet = code("components/issue/usage-breakdown-dialog.tsx");
    expect(sheet).toContain(SUBSCRIBE);
    expect(sheet).toMatch(/summarizeTaskUsageAcross\([\s\S]*?\[priced, pricings\]/);
    expect(sheet).toMatch(/collectUnmappedModels\([\s\S]*?\[priced, pricings\]/);
  });

  it("per-agent and per-run rows re-price too", () => {
    const sheet = code("components/issue/usage-breakdown-dialog.tsx");
    // Two more subscriptions: one per sub-component that prices rows.
    const subs = sheet.split(SUBSCRIBE).length - 1;
    expect(subs).toBeGreaterThanOrEqual(3);
    expect(sheet).toMatch(/\.sort\([\s\S]*?\[agentIds, tasks, pricings\]/);
    expect(sheet).toMatch(/summarizeTaskUsage\(task\.usage\)[\s\S]*?\[task\.usage, pricings\]/);
  });

  it("the run transcript panel re-prices on a saved override", () => {
    const transcript = code("components/agent/run-transcript-dialog.tsx");
    expect(transcript).toContain(SUBSCRIBE);
    expect(transcript).toMatch(
      /transcriptUsageSummary\([\s\S]*?\[task\?\.usage, pricings\]/,
    );
  });

  it("the shared pricing module falls back to the store after the table", () => {
    const lib = code("lib/task-usage.ts");
    // Table candidates win first (web's order); the store is the second loop.
    const tableLoop = lib.indexOf("const hit = MODEL_PRICING[candidate];");
    const storeLoop = lib.indexOf("const hit = getCustomPricing(candidate);");
    expect(tableLoop).toBeGreaterThan(-1);
    expect(storeLoop).toBeGreaterThan(tableLoop);
  });
});
