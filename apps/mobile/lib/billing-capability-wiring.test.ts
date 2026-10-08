/**
 * Iteration 209 — wiring ratchet for the billing capability gate.
 *
 * The mobile vitest lane is Node-only: no RN renderer, so a green
 * `billingScreenState` proves nothing about whether any screen consults it.
 * That is exactly where this class of defect hides — the helper can be perfect
 * while `more/settings.tsx` still renders the row unconditionally.
 *
 * Each assertion corresponds to one surface web gates on
 * `billing_workspace_subscriptions`. Dropping any one of them puts that surface
 * back to offering a capability the deployment has turned off.
 *
 * Comments are stripped before matching so a comment that merely describes a
 * branch cannot satisfy an assertion.
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

describe("the Settings row for Billing is capability-gated", () => {
  const settings = code("app/(app)/[workspace]/more/settings.tsx");

  it("reads the workspace-subscriptions flag", () => {
    expect(settings).toContain("BILLING_WORKSPACE_SUBSCRIPTIONS_FLAG");
    expect(settings).toMatch(/useFeatureEnabled\(\s*BILLING_WORKSPACE_SUBSCRIPTIONS_FLAG/);
  });

  it("renders the Billing row behind that flag, not unconditionally", () => {
    const row = settings.indexOf('t("screen.billing")');
    expect(row).toBeGreaterThan(-1);
    const before = settings.slice(Math.max(0, row - 400), row);
    expect(before).toMatch(/billingEnabled\s*\?/);
  });
});

describe("the Billing screen does not report an absent capability as a failure", () => {
  const screen = code("app/(app)/[workspace]/more/settings/billing.tsx");

  it("derives its state through billingScreenState", () => {
    expect(screen).toContain("billingScreenState");
  });

  it("keeps the entitlements read disabled while the capability is off", () => {
    // Anchor on the entitlements query itself. `enabled: billingEnabled` also
    // appears inside the `billingScreenState({ enabled: billingEnabled })`
    // call, so a bare `/enabled:\s*billingEnabled/` would still pass with the
    // query gate removed. Slice the query's own options object instead.
    const start = screen.indexOf("workspaceSubscriptionEntitlementsOptions(");
    expect(start).toBeGreaterThan(-1);
    const queryOptionsObject = screen.slice(start, start + 200);
    expect(queryOptionsObject).toMatch(/enabled:\s*!!wsId\s*&&\s*billingEnabled/);
  });

  it("has a dedicated disabled branch that does not offer a retry", () => {
    const branch = screen.indexOf('screenState === "disabled"');
    expect(branch).toBeGreaterThan(-1);
    // The branch ends where the next state check begins.
    const next = screen.indexOf('screenState === "loading"', branch);
    expect(next).toBeGreaterThan(branch);
    const body = screen.slice(branch, next);
    // Retrying an absent capability can never succeed, so the branch must not
    // render the retry the error branch uses.
    expect(body).not.toContain("refetch()");
    expect(body).not.toContain("billing.actionRetry");
  });
});
