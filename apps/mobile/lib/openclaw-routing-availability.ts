/**
 * When the OpenClaw routing surface applies to an agent.
 *
 * Web gates its Routing tab on `runtime?.provider === "openclaw"`
 * (`packages/views/agents/components/agent-overview-pane.tsx:223`), where
 * `runtime` is the device the agent is bound to. Reproducing that comparison
 * literally on mobile would be wrong for a reason the phone makes sharper: the
 * runtime directory is a SEPARATE read from the agent list, so at first paint
 * `runtime` is `undefined` for every agent — and `undefined?.provider ===
 * "openclaw"` is `false`, which renders as "this agent is not an OpenClaw
 * agent". A slow or failed runtime read would then hide a configuration
 * surface the user is entitled to, with nothing on screen saying why.
 *
 * This is the "read not ready is not an answer" rule the project has applied
 * since MYS-1892/MYS-1907: a loading read and an empty result must not produce
 * the same claim. The gate therefore returns four states, and only `"shown"`
 * and `"hidden"` are conclusions:
 *
 *  - `"shown"`          — the bound runtime reported provider `openclaw`.
 *  - `"hidden"`         — a runtime was resolved and it is NOT openclaw, or the
 *                         agent has no runtime bound at all (there is no
 *                         provider to route), or the runtime read FAILED and
 *                         retrying is offered next to the surface.
 *  - `"pending"`        — the runtime read has not settled yet.
 *  - `"unbound"`        — no `runtime_id`, so no provider exists to configure.
 *
 * `"unbound"` and `"hidden"` are both "do not render", but keeping them apart
 * lets the detail screen say the right thing: an unbound agent is not an error,
 * whereas a failed runtime read is something the user can retry.
 */
import type { Agent, RuntimeDevice } from "@multica/core/types";
import { isAgentRuntimeBound } from "./is-agent-runtime-bound";

/** The provider string the OpenClaw routing config is meaningful for. */
export const OPENCLAW_PROVIDER = "openclaw";

export type OpenclawRoutingAvailability =
  | { state: "shown"; runtime: RuntimeDevice }
  | { state: "hidden"; reason: "other-provider" }
  | { state: "unbound" }
  | { state: "pending" }
  | { state: "failed" };

/**
 * Resolve whether the routing surface applies.
 *
 * `runtimesSettled` must be true only when the runtime list read actually
 * finished successfully — a failed read is `failed`, never `hidden`. Callers
 * pass the read's own state rather than `!isLoading`, exactly because
 * `isLoading` is false for a failed first attempt.
 */
export function openclawRoutingAvailability({
  agent,
  runtime,
  runtimesSettled,
  runtimesFailed,
}: {
  agent: Pick<Agent, "runtime_id" | "runtime_bound">;
  /** The runtime the agent is bound to, resolved from the runtime directory. */
  runtime: RuntimeDevice | null | undefined;
  /** The runtime list read finished (successfully or not). */
  runtimesSettled: boolean;
  /** The runtime list read failed — retryable, and NOT an answer. */
  runtimesFailed: boolean;
}): OpenclawRoutingAvailability {
  if (!isAgentRuntimeBound(agent)) return { state: "unbound" };
  if (!runtimesSettled) return { state: "pending" };
  // A settled-but-failed read still tells us nothing about the provider. Web
  // does not distinguish this case because its runtimes arrive with the page;
  // on mobile the read is independent, so it has to be its own outcome.
  if (runtimesFailed) return { state: "failed" };
  if (!runtime) return { state: "pending" };
  if (runtime.provider !== OPENCLAW_PROVIDER) {
    return { state: "hidden", reason: "other-provider" };
  }
  return { state: "shown", runtime };
}

/** Convenience for the one question most call sites ask. */
export function shouldShowOpenclawRouting(
  availability: OpenclawRoutingAvailability,
): boolean {
  return availability.state === "shown";
}
