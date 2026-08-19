import { describe, expect, it } from "vitest";
import {
  formatStripeMinorAmount,
  planBadgeClass,
  statusBadgeClass,
} from "./billing-format";

describe("formatStripeMinorAmount", () => {
  it("formats two-decimal USD minor units", () => {
    expect(formatStripeMinorAmount(2000, "usd", "en")).toBe("$20.00");
    expect(formatStripeMinorAmount(20000, "usd", "en")).toBe("$200.00");
  });

  it("uses the workspace's estimated total (unitAmount × seats)", () => {
    expect(formatStripeMinorAmount(2000 * 3, "USD", "en")).toBe("$60.00");
  });

  it("drops the trailing zeros for whole major amounts", () => {
    expect(formatStripeMinorAmount(2500, "USD", "en")).toBe("$25.00");
    expect(formatStripeMinorAmount(250, "USD", "en")).toBe("$2.50");
  });

  it("handles zero-decimal currencies (JPY) without the divisor", () => {
    expect(formatStripeMinorAmount(2000, "JPY", "en")).toBe("¥2,000");
  });

  it("returns null for unsafe/negative input or unknown currency", () => {
    expect(formatStripeMinorAmount(Number.NaN, "USD", "en")).toBeNull();
    expect(formatStripeMinorAmount(-1, "USD", "en")).toBeNull();
    expect(formatStripeMinorAmount(100, "NOT_A_CURRENCY", "en")).toBeNull();
  });

  it("localizes with the zh locale", () => {
    expect(formatStripeMinorAmount(2000, "USD", "zh")).toBe("US$20.00");
  });
});

describe("planBadgeClass", () => {
  it("maps known plans and defaults unknown plans to neutral", () => {
    expect(planBadgeClass("pro")).toBe("bg-primary");
    expect(planBadgeClass("free")).toBe("bg-secondary");
    expect(planBadgeClass("enterprise")).toBe("bg-muted");
  });
});

describe("statusBadgeClass", () => {
  it("maps every listed status and defaults unknown", () => {
    expect(statusBadgeClass("active")).toBe("bg-primary");
    expect(statusBadgeClass("trialing")).toBe("bg-primary");
    expect(statusBadgeClass("past_due")).toBe("bg-destructive");
    expect(statusBadgeClass("inactive")).toBe("bg-secondary");
    expect(statusBadgeClass("canceled")).toBe("bg-secondary");
    expect(statusBadgeClass("weird")).toBe("bg-muted");
  });
});