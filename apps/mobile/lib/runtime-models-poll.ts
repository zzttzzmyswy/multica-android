/**
 * Runtime model discovery state machine (iteration 121, MYS-1032). Mobile
 * mirror of packages/core/runtimes/models.ts resolveRuntimeModels, with the
 * transport injected so the poll rules are unit-testable and the caller (the
 * React Query wrapper in data/queries/runtimes.ts) supplies the real api.
 *
 * Semantics carried over verbatim from core:
 *  - POST initiates, GET /:requestId polls while status is pending/running.
 *  - Only an explicit `completed` is a catalog. failed, timeout and any status
 *    this client does not know (a newer server, or a response that fell back
 *    to the malformed record) reject — an unrecognised status must not render
 *    an empty dropdown that looks authoritative.
 *  - `supported` defaults true: a server old enough to omit it keeps the
 *    picker enabled.
 *  - A client-side timeout rejects so the form degrades to manual entry
 *    instead of spinning.
 */
import type { RuntimeModelsResult } from "@multica/core/types";

export const RUNTIME_MODELS_POLL_INTERVAL_MS = 500;
export const RUNTIME_MODELS_POLL_TIMEOUT_MS = 30_000;

export interface RuntimeModelsTransport {
  initiate: () => Promise<RuntimeModelListRequestRecord>;
  /** Next poll against the request id returned by `initiate` — the machine
   *  threads `initial.id` through so the caller never juggles both. */
  poll: (requestId: string) => Promise<RuntimeModelListRequestRecord>;
}

/** Structural subset of RuntimeModelListRequest the machine reads. */
export interface RuntimeModelListRequestRecord {
  id: string;
  runtime_id: string;
  status: string;
  models?: RuntimeModelsResult["models"];
  supported?: boolean;
  error?: string;
}

export async function resolveRuntimeModelsMobile(
  runtimeId: string,
  transport: RuntimeModelsTransport,
  timeoutMs: number = RUNTIME_MODELS_POLL_TIMEOUT_MS,
  intervalMs: number = RUNTIME_MODELS_POLL_INTERVAL_MS,
): Promise<RuntimeModelsResult> {
  const initial = await transport.initiate();
  const start = Date.now();
  let current = initial;
  while (current.status === "pending" || current.status === "running") {
    if (Date.now() - start > timeoutMs) {
      throw new Error("model discovery timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    current = await transport.poll(initial.id);
  }
  if (current.status !== "completed") {
    throw new Error(
      current.error || `model discovery failed (status: ${current.status})`,
    );
  }
  return {
    models: current.models ?? [],
    supported: current.supported !== false,
  };
}
