import { describe, expect, it } from "vitest";
import { runNowBlockedKey, runNowToastKind } from "./autopilot-run-toast";

describe("runNowToastKind", () => {
  it("treats the explicit start statuses as success", () => {
    expect(runNowToastKind("issue_created")).toBe("success");
    expect(runNowToastKind("running")).toBe("success");
  });

  it("warns on skipped (admission blocked) — recoverable, not failure", () => {
    expect(runNowToastKind("skipped")).toBe("warning");
  });

  it("errors on failed", () => {
    expect(runNowToastKind("failed")).toBe("error");
  });

  it("never claims success for unknown / future statuses", () => {
    expect(runNowToastKind("deferred")).toBe("error");
    expect(runNowToastKind("blocked")).toBe("error");
    expect(runNowToastKind(undefined)).toBe("error");
  });
});

describe("runNowBlockedKey", () => {
  it("maps the stable server reason_code to a localized key", () => {
    expect(runNowBlockedKey("invocation_not_allowed")).toBe(
      "runBlockedInvocationNotAllowed",
    );
    expect(runNowBlockedKey("runtime_offline")).toBe(
      "runBlockedRuntimeOffline",
    );
    expect(runNowBlockedKey("agent_runtime_required")).toBe(
      "runBlockedAgentRuntimeRequired",
    );
    expect(runNowBlockedKey("target_unavailable")).toBe(
      "runBlockedTargetUnavailable",
    );
    expect(runNowBlockedKey("attribution_blocked")).toBe(
      "runBlockedAttribution",
    );
    expect(runNowBlockedKey("already_active")).toBe(
      "runBlockedAlreadyActive",
    );
  });

  it("degrades unknown/absent codes to the generic message", () => {
    expect(runNowBlockedKey("brand_new_reason")).toBe("runBlockedGeneric");
    expect(runNowBlockedKey(undefined)).toBe("runBlockedGeneric");
  });
});