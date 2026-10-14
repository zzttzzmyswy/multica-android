/**
 * Wiring ratchet for the agent detail route's no-access face (MYS-2161).
 *
 * `lib/agent-detail-access.test.ts` proves the two decisions answer correctly, and
 * `data/api-agent-access.test.ts` proves the endpoint and its 403 survive the
 * wire. Neither reaches a user unless the ROUTE consults them: the helper could
 * exist unused while the page kept rendering 「该智能体不存在或已被删除」 for a
 * private agent, which is exactly the state this iteration starts from (the
 * route had one `!agent` branch and no probe at all).
 *
 * The assertion that matters most is the GATE. Web's probe carries
 * `enabled: !agentsLoading && !agent && !!agentId`; dropping any one conjunct
 * looks harmless in review and one of them is not: `!agent` is what keeps the
 * common path — an agent opened from the agents list — at zero extra requests.
 * So this suite pins the gate as an argument the screen computes from its own
 * read state, rather than a condition buried in the query options where
 * flipping it would not show up in this file.
 *
 * Mobile's vitest lane is Node-only, so this is asserted against source rather
 * than rendered markup. Comments are stripped so a comment describing the
 * wiring cannot satisfy it.
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

const DETAIL = "app/(app)/[workspace]/more/agents/[id].tsx";
const QUERIES = "data/queries/agents.ts";
const NO_ACCESS = "components/agent/agent-no-access.tsx";

describe("the agent detail route probes for a 403 before claiming 'not found'", () => {
  const src = code(DETAIL);

  it("sends the probe through the shared decision helper", () => {
    expect(src).toContain("shouldProbeAgentAccess({");
    expect(src).toContain("agentAccessProbeOptions(");
  });

  it("derives the gate from its own read state, so the common path is silent", () => {
    // All three conjuncts travel as arguments. `agentFound` is the one that
    // keeps an agent opened from the list at zero extra requests.
    expect(src).toContain("listSettled: read.isResolved");
    expect(src).toContain("agentFound: agent != null");
    expect(src).toContain("agentId: id");
  });

  it("classifies the failure with the shared 403 predicate", () => {
    // Not an inline `=== 403`: the predicate is where "status 0 is not a
    // refusal" is decided and tested. An inline comparison here would bypass
    // that and re-open the network-error-looks-like-no-access hole.
    expect(src).toContain("isAgentAccessDenied(accessProbe.error)");
    expect(src).not.toContain("=== 403");
  });

  it("renders the no-access face BEFORE the not-found branch", () => {
    // Order is the behaviour: the not-found branch must not be reachable while
    // a 403 is in hand. Asserted positionally, because both branches start with
    // the same `if (!agent …` shape.
    const deniedAt = src.indexOf("<AgentNoAccess");
    const notFoundAt = src.indexOf('emptyMessage={t("agents.notFound")}');
    expect(deniedAt, "no-access face is not rendered").toBeGreaterThan(-1);
    expect(notFoundAt, "not-found branch is gone").toBeGreaterThan(-1);
    expect(deniedAt).toBeLessThan(notFoundAt);
  });

  it("keeps the not-found branch as the fallback for everything else", () => {
    // A 404 and a network error must still land on 「不存在或已被删除」 (the
    // pre-existing copy) rather than on the permission face.
    expect(src).toContain('emptyMessage={t("agents.notFound")}');
  });

  it("does not assert either sentence while the probe is still answering", () => {
    // The probe is a second round-trip, so there is a real window where the
    // route knows the agent is absent from the list but not WHICH absence it
    // is. Falling through to the not-found branch there re-states the defect
    // for that window. Gated on `isFetching` rather than `isPending`: a
    // disabled query is `pending` in TanStack v5, so `isPending` would spin
    // forever on the no-id path where no probe was ever issued.
    //
    // Asserted as the WHOLE condition, not the presence of `isFetching`:
    // `false && accessProbe.isFetching` still contains the identifier while
    // disabling the gate — mutations 14 and 15 of
    // `scripts/falsify-iter243-agent-403.py` are exactly those two edits.
    const gateAt = src.indexOf("if (!agent && accessProbe.isFetching)");
    expect(gateAt, "in-flight gate missing or weakened").toBeGreaterThan(-1);
    expect(src).not.toContain("accessProbe.isPending");
    expect(gateAt).toBeLessThan(
      src.indexOf('emptyMessage={t("agents.notFound")}'),
    );
  });

  it("gives the face a way out to the agents list", () => {
    // The reachable entry is a deep link with no history to pop, so the face
    // needs its own destination — and it must be the workspace-scoped list, not
    // the router's `back()`.
    //
    // Asserted on the NAVIGATION, not on the prop: `onBackToAgents={() => {}}`
    // satisfies "the prop is passed" while leaving the user with a dead button,
    // which is the one thing this face must not be. Mutation 12 of
    // `scripts/falsify-iter243-agent-403.py` is exactly that edit.
    expect(src).toContain("onBackToAgents={() => router.replace(agentsListHref)}");
    expect(src).toContain("more/agents");
    expect(src).not.toContain("router.back()");
  });
});

describe("the probe query is inert by default", () => {
  const src = code(QUERIES);

  it("passes `enabled` through from the caller instead of deciding it", () => {
    expect(src).toContain("enabled: enabled && !!agentId");
  });

  it("does not retry a permission verdict", () => {
    // Web's probe sets `retry: false`; a retry pass only delays the face the
    // user is owed, and a 403 is not a flaky read.
    expect(src).toContain("retry: false");
  });

  it("hits the single-agent endpoint", () => {
    expect(src).toContain("api.getAgent(agentId as string");
  });
});

describe("the no-access face makes the opposite claim from 'not found'", () => {
  const src = code(NO_ACCESS);

  it("uses its own copy, not the not-found sentence", () => {
    for (const key of [
      "agents.detail.noAccessTitle",
      "agents.detail.noAccessHint",
      "agents.detail.noAccessBackToAgents",
    ]) {
      expect(src, `face does not render ${key}`).toContain(key);
    }
    expect(src).not.toContain("agents.notFound");
  });

  it("marks the state with the lock icon the app already uses for 'private'", () => {
    expect(src).toContain("lock-closed-outline");
  });
});
