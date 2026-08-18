import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ApiClient pulls in native modules at module scope; the Node vitest lane
// stubs them so the import chain resolves (same pattern as
// api-issue-views.test.ts). The env var satisfies api.ts's load-time guard.
process.env.EXPO_PUBLIC_API_URL = "https://api.test";

vi.mock("expo-file-system", () => ({
  File: class {
    uri = "file:///mock";
    exists = false;
  },
  Paths: { document: { uri: "file:///doc" } },
}));

vi.mock("expo-file-system/legacy", () => ({
  createDownloadResumable: vi.fn(),
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

type ApiClient = typeof import("./api").api;
let api: ApiClient;

const fetchSpy = () =>
  vi.spyOn(api as unknown as { fetch: () => Promise<unknown> }, "fetch");

beforeAll(async () => {
  ({ api } = await import("./api"));
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("workspace subscription api methods (iteration-67)", () => {
  const ENTITLEMENTS = {
    workspace_id: "ws-1",
    plan: "free",
    status: "inactive",
    seats: 3,
    issue_window: 200,
    autopilot_runs: 10,
    current_period_end: "2026-09-01T00:00:00Z",
    snapshot_expires_at: null,
    version: 1,
  };

  it("getWorkspaceSubscriptionEntitlements GETs /api/cloud-subscriptions/entitlements and maps snake_case", async () => {
    const spy = fetchSpy().mockResolvedValue(ENTITLEMENTS);
    const res = await api.getWorkspaceSubscriptionEntitlements();
    expect(spy).toHaveBeenCalledWith("/api/cloud-subscriptions/entitlements");
    expect(res).toEqual({
      workspaceId: "ws-1",
      plan: "free",
      status: "inactive",
      seats: 3,
      issueWindow: 200,
      autopilotRuns: 10,
      currentPeriodEnd: "2026-09-01T00:00:00Z",
      snapshotExpiresAt: null,
      version: 1,
    });
  });

  it("entitlements defaults to null on unparsable body (never looks like Free)", async () => {
    fetchSpy().mockResolvedValue({ plan: "pro" }); // missing required fields
    const res = await api.getWorkspaceSubscriptionEntitlements();
    expect(res).toBeNull();
  });

  it("getWorkspaceSubscriptionSummary GETs /api/cloud-subscriptions/summary", async () => {
    const spy = fetchSpy().mockResolvedValue({
      entitlement: ENTITLEMENTS,
      billing_interval: "month",
      actual_seats: 3,
      billed_seats: 3,
      pending_seat_quantity: null,
      cancel_at_period_end: false,
      grace_until: null,
      has_stripe_customer: false,
    });
    const res = await api.getWorkspaceSubscriptionSummary();
    expect(spy).toHaveBeenCalledWith("/api/cloud-subscriptions/summary");
    expect(res).toEqual({
      entitlement: {
        workspaceId: "ws-1",
        plan: "free",
        status: "inactive",
        seats: 3,
        issueWindow: 200,
        autopilotRuns: 10,
        currentPeriodEnd: "2026-09-01T00:00:00Z",
        snapshotExpiresAt: null,
        version: 1,
      },
      billingInterval: "month",
      actualSeats: 3,
      billedSeats: 3,
      pendingSeatQuantity: null,
      cancelAtPeriodEnd: false,
      graceUntil: null,
      hasStripeCustomer: false,
    });
  });

  it("prices degrade to null on a malformed body (never a real backed amount)", async () => {
    fetchSpy().mockResolvedValue({ nope: true });
    const res = await api.getWorkspaceSubscriptionPrices();
    expect(res).toBeNull();
  });

  it("getWorkspaceSubscriptionPrices maps month/year slots", async () => {
    const spy = fetchSpy().mockResolvedValue({
      month: { currency: "USD", unit_amount: 2000, interval: "month", interval_count: 1 },
      year: { currency: "USD", unit_amount: 20000, interval: "year", interval_count: 1 },
    });
    const res = await api.getWorkspaceSubscriptionPrices();
    expect(spy).toHaveBeenCalledWith("/api/cloud-subscriptions/prices");
    expect(res?.month.unitAmount).toBe(2000);
    expect(res?.year.unitAmount).toBe(20000);
    expect(res?.month.interval).toBe("month");
  });

  it("prices rejects a Price pinned to the wrong interval slot", async () => {
    fetchSpy().mockResolvedValue({
      month: { currency: "USD", unit_amount: 2000, interval: "year", interval_count: 1 },
      year: { currency: "USD", unit_amount: 20000, interval: "year", interval_count: 1 },
    });
    const res = await api.getWorkspaceSubscriptionPrices();
    expect(res).toBeNull();
  });

  it("createWorkspaceSubscriptionCheckout POSTs interval + idempotency_key with Idempotency-Key header", async () => {
    const spy = fetchSpy().mockResolvedValue({
      request_id: "req-1",
      session_id: "cs_1",
      url: "https://checkout.stripe.com/c/pay/cs_1",
    });
    const res = await api.createWorkspaceSubscriptionCheckout({
      interval: "month",
      idempotencyKey: "workspace-checkout-key",
      customerEmail: "a@b.c",
    });
    expect(spy).toHaveBeenCalledWith(
      "/api/cloud-subscriptions/checkout-sessions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          interval: "month",
          idempotency_key: "workspace-checkout-key",
          customer_email: "a@b.c",
        }),
        headers: expect.objectContaining({
          "Idempotency-Key": "workspace-checkout-key",
        }),
      }),
    );
    expect(res?.url).toBe("https://checkout.stripe.com/c/pay/cs_1");
  });

  it("checkout omits customer_email when absent", async () => {
    const spy = fetchSpy().mockResolvedValue({
      request_id: "req-1",
      session_id: "cs_1",
      url: "https://checkout.stripe.com/c/pay/cs_1",
    });
    await api.createWorkspaceSubscriptionCheckout({
      interval: "year",
      idempotencyKey: "key",
    });
    type CalledWith = (string | Record<string, unknown>)[];
    const [, init] = spy.mock.calls[0] as CalledWith;
    expect((init as Record<string, unknown>).body).toBe(
      JSON.stringify({ interval: "year", idempotency_key: "key" }),
    );
  });

  it("reconcileWorkspaceSubscriptionSeats POSTs /api/cloud-subscriptions/seats/reconcile", async () => {
    const spy = fetchSpy().mockResolvedValue({
      workspace_id: "ws-1",
      billed_seats: 5,
      actual_seats: 4,
      action: "downsizing",
    });
    const res = await api.reconcileWorkspaceSubscriptionSeats();
    expect(spy).toHaveBeenCalledWith(
      "/api/cloud-subscriptions/seats/reconcile",
      expect.objectContaining({ method: "POST" }),
    );
    expect(res?.billedSeats).toBe(5);
    expect(res?.action).toBe("downsizing");
  });

  it("createWorkspaceSubscriptionPortal POSTs with Idempotency-Key header only", async () => {
    const spy = fetchSpy().mockResolvedValue({
      url: "https://billing.stripe.com/p/session/key",
    });
    const res = await api.createWorkspaceSubscriptionPortal("portal-key");
    expect(spy).toHaveBeenCalledWith(
      "/api/cloud-subscriptions/portal-sessions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Idempotency-Key": "portal-key" }),
      }),
    );
    expect(res?.url).toBe("https://billing.stripe.com/p/session/key");
  });

  it("malformed portal/checkout/reconcile success bodies degrade to null", async () => {
    fetchSpy().mockResolvedValue({ bizarre: true });
    await expect(
      api.createWorkspaceSubscriptionPortal("k"),
    ).resolves.toBeNull();
    await expect(
      api.createWorkspaceSubscriptionCheckout({
        interval: "month",
        idempotencyKey: "k",
      }),
    ).resolves.toBeNull();
    await expect(api.reconcileWorkspaceSubscriptionSeats()).resolves.toBeNull();
  });
});