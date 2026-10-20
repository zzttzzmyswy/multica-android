import { describe, expect, it } from "vitest";
import type { Agent, RuntimeDevice } from "@multica/core/types";
import { EMPTY_RUNTIME_LIST } from "@/data/schemas";
import {
  OPENCLAW_PROVIDER,
  openclawRoutingAvailability,
  shouldShowOpenclawRouting,
} from "./openclaw-routing-availability";

const runtime = (provider: string): RuntimeDevice => ({
  ...(EMPTY_RUNTIME_LIST[0] ?? ({} as RuntimeDevice)),
  id: "rt-1",
  workspace_id: "ws-1",
  daemon_id: "d-1",
  name: "build-box",
  runtime_mode: "daemon" as RuntimeDevice["runtime_mode"],
  provider,
  launch_header: "",
  status: "online",
  device_info: "",
  metadata: {},
  owner_id: null,
  visibility: "private",
  last_seen_at: null,
  created_at: "",
  updated_at: "",
});

const agent = (overrides: Partial<Agent> = {}): Agent =>
  ({
    id: "a-1",
    runtime_id: "rt-1",
    ...overrides,
  }) as Agent;

const bound = { runtimesSettled: true, runtimesFailed: false };

describe("openclawRoutingAvailability", () => {
  it("shows the surface for an openclaw runtime", () => {
    const got = openclawRoutingAvailability({
      agent: agent(),
      runtime: runtime(OPENCLAW_PROVIDER),
      ...bound,
    });
    expect(got.state).toBe("shown");
    expect(shouldShowOpenclawRouting(got)).toBe(true);
  });

  it("hides it for a different provider", () => {
    // Rendering an OpenClaw routing form over a Claude Code agent offers a
    // configuration that means nothing to its runtime.
    const got = openclawRoutingAvailability({
      agent: agent(),
      runtime: runtime("claude-code"),
      ...bound,
    });
    expect(got.state).toBe("hidden");
    expect(shouldShowOpenclawRouting(got)).toBe(false);
  });

  it("reports unbound rather than hiding when the agent has no runtime", () => {
    // "No runtime bound" is a fact worth telling the user; "not OpenClaw"
    // would be an assertion about a provider that does not exist yet.
    const got = openclawRoutingAvailability({
      agent: agent({ runtime_id: "" }),
      runtime: null,
      ...bound,
    });
    expect(got.state).toBe("unbound");
    expect(shouldShowOpenclawRouting(got)).toBe(false);
  });

  it("treats runtime_bound === false as unbound even with a runtime_id", () => {
    // Newer servers state the binding explicitly; the id alone is not proof.
    const got = openclawRoutingAvailability({
      agent: agent({ runtime_bound: false }),
      runtime: runtime(OPENCLAW_PROVIDER),
      ...bound,
    });
    expect(got.state).toBe("unbound");
  });

  it("is pending — not hidden — while the runtime read is in flight", () => {
    // The defect this closes: `undefined?.provider === "openclaw"` is false,
    // so a loading runtime read used to read as "not an OpenClaw agent" and
    // remove a surface the user was entitled to, with no explanation.
    const got = openclawRoutingAvailability({
      agent: agent(),
      runtime: undefined,
      runtimesSettled: false,
      runtimesFailed: false,
    });
    expect(got.state).toBe("pending");
    expect(shouldShowOpenclawRouting(got)).toBe(false);
  });

  it("is pending when settled but the row has not resolved", () => {
    const got = openclawRoutingAvailability({
      agent: agent(),
      runtime: null,
      ...bound,
    });
    expect(got.state).toBe("pending");
  });

  it("reports failed — not hidden — when the runtime read errored", () => {
    // A failed read is retryable. Folding it into "hidden" would tell the user
    // this agent needs no routing configuration, which nothing established.
    const got = openclawRoutingAvailability({
      agent: agent(),
      runtime: null,
      runtimesSettled: true,
      runtimesFailed: true,
    });
    expect(got.state).toBe("failed");
    expect(shouldShowOpenclawRouting(got)).toBe(false);
  });

  it("checks the binding before it consults the read state", () => {
    // An unbound agent's answer does not depend on the runtime directory, so
    // it must not wait on it (and must not spin on a pending read forever).
    const got = openclawRoutingAvailability({
      agent: agent({ runtime_id: "" }),
      runtime: undefined,
      runtimesSettled: false,
      runtimesFailed: true,
    });
    expect(got.state).toBe("unbound");
  });
});
