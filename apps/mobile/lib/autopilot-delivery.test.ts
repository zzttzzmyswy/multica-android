import { describe, expect, it } from "vitest";
import {
  buildDeliveryMetaRows,
  canReplay,
  truncateForDisplay,
} from "./autopilot-delivery";
import type { WebhookDelivery } from "@multica/core/types";

function delivery(overrides: Partial<WebhookDelivery> = {}): WebhookDelivery {
  return {
    id: "dlv_1",
    workspace_id: "ws_1",
    autopilot_id: "ap_1",
    trigger_id: "trg_1",
    provider: "github",
    event: "workflow_run",
    dedupe_key: null,
    dedupe_source: null,
    signature_status: "valid",
    status: "dispatched",
    attempt_count: 1,
    dispatch_attempts: 1,
    available_at: "",
    content_type: null,
    response_status: 200,
    autopilot_run_id: null,
    replayed_from_delivery_id: null,
    error: null,
    received_at: "2026-08-25T08:00:00Z",
    last_attempt_at: "2026-08-25T08:00:01Z",
    created_at: "2026-08-25T08:00:00Z",
    ...overrides,
  };
}

const fmt = (id: string) => `L<${id}>`;
const fmtDate = (iso: string | null | undefined) =>
  iso ? `D(${iso})` : "EMPTY";
const P = "autopilots.deliveries.";

describe("canReplay", () => {
  it("allows a healthy dispatched delivery", () => {
    expect(canReplay(delivery())).toBe(true);
  });

  it("blocks signature-invalid deliveries even when otherwise fine", () => {
    expect(
      canReplay(delivery({ signature_status: "invalid" })),
    ).toBe(false);
  });

  it("blocks rejected deliveries", () => {
    expect(canReplay(delivery({ status: "rejected" }))).toBe(false);
  });

  it("blocks still-queued deliveries (mid-flight on the server)", () => {
    expect(canReplay(delivery({ status: "queued" }))).toBe(false);
  });

  it("allows a missing signature on an otherwise healthy delivery", () => {
    expect(canReplay(delivery({ signature_status: "missing" }))).toBe(true);
  });

  it("defaults unknown statuses to replayable (server is the real gate)", () => {
    const unknown = delivery() as WebhookDelivery;
    (unknown as { status: string }).status = "deferred_future";
    expect(canReplay(unknown)).toBe(true);
  });
});

describe("truncateForDisplay", () => {
  it("passes short values through untouched", () => {
    expect(truncateForDisplay("hello")).toEqual({
      display: "hello",
      truncated: false,
    });
  });

  it("treats a value at exactly the limit as not truncated", () => {
    const value = "x".repeat(4096);
    expect(truncateForDisplay(value)).toEqual({
      display: value,
      truncated: false,
    });
  });

  it("truncates past the default 4 KiB limit and marks it", () => {
    const value = "x".repeat(5000);
    const result = truncateForDisplay(value);
    expect(result.truncated).toBe(true);
    expect(result.display).toBe("x".repeat(4096));
    expect(result.display.length).toBe(4096);
  });

  it("honours a custom limit", () => {
    expect(truncateForDisplay("abcdefghij", 4)).toEqual({
      display: "abcd",
      truncated: true,
    });
  });

  it("handles the empty string", () => {
    expect(truncateForDisplay("")).toEqual({ display: "", truncated: false });
  });
});

describe("buildDeliveryMetaRows", () => {
  it("emits the base grid in web order with localized labels", () => {
    const rows = buildDeliveryMetaRows(delivery(), fmt, fmtDate);
    expect(rows.map((r) => r.key)).toEqual([
      "receivedAt",
      "lastAttemptAt",
      "attempts",
      "dispatchAttempts",
      "response",
      "dedupeKey",
      "dedupeSource",
    ]);
    expect(rows[0]).toEqual({
      key: "receivedAt",
      label: `L<${P}receivedAt>`,
      value: "D(2026-08-25T08:00:00Z)",
    });
    expect(rows[3]).toEqual({
      key: "dispatchAttempts",
      label: `L<${P}dispatchAttempts>`,
      value: "1",
    });
  });

  it("adds available_at only for queued deliveries, right after dispatch attempts", () => {
    const queued = delivery({ status: "queued", available_at: "2026-08-25T08:05:00Z" });
    const rows = buildDeliveryMetaRows(queued, fmt, fmtDate);
    expect(rows.map((r) => r.key)).toEqual([
      "receivedAt",
      "lastAttemptAt",
      "attempts",
      "dispatchAttempts",
      "availableAt",
      "response",
      "dedupeKey",
      "dedupeSource",
    ]);
    expect(rows[4]).toEqual({
      key: "availableAt",
      label: `L<${P}availableAt>`,
      value: "D(2026-08-25T08:05:00Z)",
    });
  });

  it("omits content_type / replayed_from rows when absent", () => {
    const rows = buildDeliveryMetaRows(delivery(), fmt, fmtDate);
    expect(rows.filter((r) => r.key === "contentType")).toHaveLength(0);
    expect(rows.filter((r) => r.key === "replayedFrom")).toHaveLength(0);
  });

  it("includes content_type / replayed_from rows when present, marked mono", () => {
    const rows = buildDeliveryMetaRows(
      delivery({
        content_type: "application/json",
        replayed_from_delivery_id: "dlv_0",
      }),
      fmt,
      fmtDate,
    );
    expect(rows.map((r) => r.key)).toEqual([
      "receivedAt",
      "lastAttemptAt",
      "attempts",
      "dispatchAttempts",
      "response",
      "dedupeKey",
      "dedupeSource",
      "contentType",
      "replayedFrom",
    ]);
    expect(rows[7]).toEqual({
      key: "contentType",
      label: `L<${P}contentType>`,
      value: "application/json",
      mono: true,
    });
    expect(rows[8]).toEqual({
      key: "replayedFrom",
      label: `L<${P}replayedFrom>`,
      value: "dlv_0",
      mono: true,
    });
  });

  it("falls back to em-dashes for null dedupe fields and response status", () => {
    const rows = buildDeliveryMetaRows(
      delivery({ dedupe_key: null, dedupe_source: null, response_status: null }),
      fmt,
      fmtDate,
    );
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.dedupeKey.value).toBe("—");
    expect(byKey.dedupeKey.mono).toBe(true);
    expect(byKey.dedupeSource.value).toBe("—");
    expect(byKey.response.value).toBe("—");
  });

  it("keeps dedupe rows readable when the server sends empty strings, not nulls", () => {
    const rows = buildDeliveryMetaRows(
      delivery({ dedupe_key: "", dedupe_source: "" }),
      fmt,
      fmtDate,
    );
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.dedupeKey.value).toBe("");
    expect(byKey.dedupeSource.value).toBe("");
  });

  it("does not crash on an unknown status (API Response Compatibility)", () => {
    const unknown = delivery() as WebhookDelivery;
    (unknown as { status: string }).status = "deferred_future";
    const rows = buildDeliveryMetaRows(unknown, fmt, fmtDate);
    expect(rows.map((r) => r.key)).not.toContain("availableAt");
    expect(rows.length).toBeGreaterThanOrEqual(5);
  });
});