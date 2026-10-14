/**
 * The two decisions behind the agent detail route's no-access face (MYS-2161).
 *
 * `isAgentAccessDenied` and `shouldProbeAgentAccess` are the whole of the new
 * behaviour that is not presentation, so this suite is where the acceptance
 * criteria's four named mutations land:
 *
 *   - the probe condition written always-true  → the common path regains an
 *     extra request per detail open (tested here; the wiring test proves the
 *     screen actually passes the gate through).
 *   - 403 and 404 collapsed into one branch   → a deleted agent claims the
 *     user lacks permission.
 *   - a network error reported as "no access" → an unreachable server sends
 *     the user to ask for a grant they already have.
 *   - the probe fired before the list settled → absent-from-an-arriving list
 *     is treated as evidence.
 *
 * Each case states WHY its answer is the right one, because the failure mode
 * this file guards against is not a crash — it is a sentence that is false
 * about a real state.
 */
import { describe, expect, it } from "vitest";
import {
  AGENT_ACCESS_DENIED_STATUS,
  isAgentAccessDenied,
  shouldProbeAgentAccess,
} from "./agent-detail-access";

describe("isAgentAccessDenied", () => {
  it("is true for the server's private-agent refusal", () => {
    // handler/agent.go:971 — `canAccessPrivateAgent` false → 403. This is the
    // one status that means "the agent is there and you may not open it".
    expect(AGENT_ACCESS_DENIED_STATUS).toBe(403);
    expect(isAgentAccessDenied({ status: 403 })).toBe(true);
  });

  it("is false for 404 — a missing agent is not a permission problem", () => {
    // Collapsing these two is the defect in the other direction: a genuinely
    // deleted agent would tell the user to go ask for access to nothing.
    expect(isAgentAccessDenied({ status: 404 })).toBe(false);
  });

  it("is false for the network-failure status", () => {
    // `ApiClient.fetch` normalises offline / DNS / TLS / timeout to status 0.
    // Nothing was refused — the request never arrived — so the user must not be
    // told they lack access.
    expect(isAgentAccessDenied({ status: 0 })).toBe(false);
  });

  it("is false for the neighbouring auth statuses", () => {
    // 401 and 403 are one typo apart in a comparison and mean different things:
    // a stale token is re-authenticated, not a workspace grant to request.
    expect(isAgentAccessDenied({ status: 401 })).toBe(false);
    expect(isAgentAccessDenied({ status: 500 })).toBe(false);
  });

  it("is false for anything that is not an error carrying a status", () => {
    // The hook hands `useQuery().error`, which is `null` on success and can be
    // any thrown value (`parseWithFallback` never throws, but a queryFn can).
    // A duck-typed read must not fault on them.
    expect(isAgentAccessDenied(null)).toBe(false);
    expect(isAgentAccessDenied(undefined)).toBe(false);
    expect(isAgentAccessDenied(new Error("boom"))).toBe(false);
    expect(isAgentAccessDenied("403")).toBe(false);
    expect(isAgentAccessDenied({ status: "403" })).toBe(false);
    // A non-null object without `status` — `typeof null === "object"`, so the
    // explicit null check is load-bearing, not defensive noise.
    expect(isAgentAccessDenied({})).toBe(false);
  });
});

describe("shouldProbeAgentAccess", () => {
  it("probes only when the list settled, the agent is absent, and there is an id", () => {
    expect(
      shouldProbeAgentAccess({
        listSettled: true,
        agentFound: false,
        agentId: "agent-1",
      }),
    ).toBe(true);
  });

  it("does NOT probe when the agent is already in the list (the common path)", () => {
    // This is the request count the acceptance criteria pin: an agent reached
    // from the agents list is resolved, and the probe must cost nothing.
    expect(
      shouldProbeAgentAccess({
        listSettled: true,
        agentFound: true,
        agentId: "agent-1",
      }),
    ).toBe(false);
  });

  it("does NOT probe while the list is still arriving", () => {
    // An agent merely absent from an in-flight list is not evidence of
    // anything; probing here fires a second request on every detail open.
    expect(
      shouldProbeAgentAccess({
        listSettled: false,
        agentFound: false,
        agentId: "agent-1",
      }),
    ).toBe(false);
  });

  it("does NOT probe without an id", () => {
    for (const agentId of [undefined, null, ""]) {
      expect(
        shouldProbeAgentAccess({
          listSettled: true,
          agentFound: false,
          agentId,
        }),
        `agentId=${String(agentId)}`,
      ).toBe(false);
    }
  });
});
