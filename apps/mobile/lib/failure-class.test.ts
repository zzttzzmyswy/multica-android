import { describe, expect, it } from "vitest";

import { FAILURE_CLASSES, classForReason } from "./failure-class";

describe("classForReason", () => {
  it("maps the 22 reasons an operator acts on to distinct classes", () => {
    expect(classForReason("agent_error.provider_auth_or_access")).toBe("auth");
    expect(classForReason("agent_error.missing_config")).toBe("auth");
    expect(classForReason("agent_error.provider_capacity_or_rate_limit")).toBe(
      "rate_limit",
    );
    // Billing quota shares the rate-limit class: same operator response.
    expect(classForReason("agent_error.provider_quota_limit")).toBe("rate_limit");
    expect(classForReason("timeout")).toBe("timeout");
    expect(classForReason("agent_error.agent_timeout")).toBe("timeout");
    expect(classForReason("codex_semantic_inactivity")).toBe("timeout");
    expect(classForReason("agent_error.provider_server_error")).toBe("provider");
    expect(classForReason("agent_error.provider_network")).toBe("provider");
    expect(classForReason("agent_error.model_not_found_or_unavailable")).toBe("provider");
    expect(classForReason("api_invalid_request")).toBe("provider");
    expect(classForReason("runtime_offline")).toBe("runtime");
    expect(classForReason("runtime_recovery")).toBe("runtime");
    expect(classForReason("queued_expired")).toBe("runtime");
    expect(classForReason("agent_error.runtime_missing_executable")).toBe("runtime");
    expect(classForReason("agent_error.runtime_version_unsupported")).toBe("runtime");
    expect(classForReason("skill_bundle_unavailable")).toBe("runtime");
    expect(classForReason("agent_error.process_failure")).toBe("agent");
    expect(classForReason("codex_resume_oversized")).toBe("agent");
    expect(classForReason("agent_error.empty_or_unparseable_output")).toBe("agent");
    expect(classForReason("agent_error.context_overflow")).toBe("agent");
    expect(classForReason("iteration_limit")).toBe("agent");
    expect(classForReason("agent_blocked")).toBe("agent");
  });

  it("keeps pre-MUL-1949 coarse reasons countable", () => {
    expect(classForReason("agent_error")).toBe("other");
    expect(classForReason("manual")).toBe("other");
  });

  it("files a reason from a newer backend under 'other'", () => {
    expect(classForReason("agent_error.some_future_reason")).toBe("other");
    expect(classForReason("unclassified")).toBe("other");
  });

  it("never treats the empty string as a failure class that inflates totals", () => {
    // The succeeded bucket resolves under the catchall, but callers never
    // pass it — the aggregators filter it out before classing.
    expect(classForReason("")).toBe("other");
  });

  it("reaches every FAILURE_CLASSES member", () => {
    const reachable = new Set(
      [
        "agent_error.provider_auth_or_access",
        "agent_error.provider_quota_limit",
        "timeout",
        "agent_error.provider_network",
        "runtime_offline",
        "agent_error.process_failure",
        "agent_error.unknown",
      ].map(classForReason),
    );
    const sorted = (xs: string[]) => [...xs].sort();
    expect(sorted([...reachable])).toEqual(sorted([...FAILURE_CLASSES]));
  });
});