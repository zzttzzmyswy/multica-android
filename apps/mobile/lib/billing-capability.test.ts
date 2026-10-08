/**
 * Iteration 209 — the workspace-subscriptions capability gate.
 *
 * Web gates the Billing tab on `billing_workspace_subscriptions`
 * (`packages/views/settings/components/settings-page.tsx:141`): with the flag
 * off the tab leaves the visible list AND `?tab=billing` is redirected to
 * `workspace` (`:171`). The server is a hard gate too — with the flag off every
 * `/api/cloud-subscriptions/*` endpoint answers 503
 * (`server/internal/handler/cloud_billing.go:76`).
 *
 * Mobile had no gate at all, so on a deployment that reports the flag false
 * (the live one does) the Billing row stayed tappable and the screen rendered
 * its query failure as "temporarily unavailable" with a Retry that can never
 * succeed. The capability is not temporarily down; it is absent.
 *
 * The pure helper below is the whole decision surface, so it is tested here
 * rather than through a renderer the Node lane does not have.
 */
import { describe, expect, it } from "vitest";
import { BILLING_WORKSPACE_SUBSCRIPTIONS_FLAG } from "@multica/core/feature-flags";
import { billingScreenState } from "./billing-capability";

describe("the billing flag key comes from core, not a mobile literal", () => {
  it("is the key web and the server both read", () => {
    expect(BILLING_WORKSPACE_SUBSCRIPTIONS_FLAG).toBe(
      "billing_workspace_subscriptions",
    );
  });
});

describe("billingScreenState", () => {
  it("reports `disabled` while the flag is off — not a loading or error state", () => {
    expect(
      billingScreenState({ enabled: false, isPending: false, isError: false }),
    ).toBe("disabled");
  });

  it("stays `disabled` even while the gated query is still pending", () => {
    expect(
      billingScreenState({ enabled: false, isPending: true, isError: false }),
    ).toBe("disabled");
  });

  it("reports `loading` only once the capability is on and the read is in flight", () => {
    expect(
      billingScreenState({ enabled: true, isPending: true, isError: false }),
    ).toBe("loading");
  });

  it("reports `error` for a genuine read failure on an enabled deployment", () => {
    expect(
      billingScreenState({ enabled: true, isPending: false, isError: true }),
    ).toBe("error");
  });

  it("reports `ready` when the capability is on and the read settled", () => {
    expect(
      billingScreenState({ enabled: true, isPending: false, isError: false }),
    ).toBe("ready");
  });
});
