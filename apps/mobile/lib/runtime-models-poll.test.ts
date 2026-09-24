/**
 * Polling state-machine tests for resolveRuntimeModelsMobile (iteration 121,
 * MYS-1032). The transport is injected, so these exercise the exact rules
 * mirrored from packages/core/runtimes/models.ts without a fetch mock:
 *  - pending/running keep polling; only an explicit `completed` resolves.
 *  - failed / timeout / unknown status reject with the record's error.
 *  - `supported` defaults true when a legacy server omits it.
 *  - client-side poll timeout surfaces as a rejection (manual entry survives).
 */
import { describe, expect, it } from "vitest";
import type { RuntimeModelListRequest } from "@multica/core/types";
import { resolveRuntimeModelsMobile } from "./runtime-models-poll";

function record(
  overrides: Partial<RuntimeModelListRequest>,
): RuntimeModelListRequest {
  return {
    id: "req-1",
    runtime_id: "rt-1",
    status: "completed",
    models: [
      { id: "m-1", label: "Model One", provider: "openai", supported_default: undefined } as never,
    ],
    supported: true,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function transport(
  responses: RuntimeModelListRequest[],
  opts: { failAfter?: number } = {},
) {
  let post = 0;
  let get = 0;
  return {
    postCalls: () => post,
    getCalls: () => get,
    initiate: async (): Promise<RuntimeModelListRequest> => {
      post += 1;
      if (opts.failAfter !== undefined && post >= opts.failAfter) {
        throw new Error("network down");
      }
      return responses[0];
    },
    poll: async (_requestId: string): Promise<RuntimeModelListRequest> => {
      get += 1;
      if (opts.failAfter !== undefined && post + get > opts.failAfter) {
        throw new Error("network down");
      }
      return responses[Math.min(get, responses.length - 1)];
    },
  };
}

describe("resolveRuntimeModelsMobile", () => {
  it("resolves a completed catalog after polling", async () => {
    const t = transport([
      record({ status: "pending", models: undefined }),
      record({ status: "running", models: undefined }),
      record({ status: "completed" }),
    ]);
    const result = await resolveRuntimeModelsMobile("rt-1", t, 5_000);
    expect(t.postCalls()).toBe(1);
    expect(t.getCalls()).toBe(2);
    expect(result.models).toHaveLength(1);
    expect(result.supported).toBe(true);
  });

  it("rejects on an explicit failed status with the record error", async () => {
    const t = transport([
      record({ status: "failed", error: "daemon offline", models: undefined }),
    ]);
    await expect(resolveRuntimeModelsMobile("rt-1", t, 5_000)).rejects.toThrow(
      "daemon offline",
    );
  });

  it("treats an unknown status as failure, not an empty catalog", async () => {
    const t = transport([
      record({ status: "quantum-syncing" as never }),
    ]);
    await expect(resolveRuntimeModelsMobile("rt-1", t, 5_000)).rejects.toThrow(
      /model discovery failed/,
    );
  });

  it("defaults supported=true when a legacy server omits it", async () => {
    const t = transport([
      record({ supported: undefined as never }),
    ]);
    const result = await resolveRuntimeModelsMobile("rt-1", t, 5_000);
    expect(result.supported).toBe(true);
  });

  it("reports supported=false for a model-less runtime", async () => {
    const t = transport([
      record({ supported: false, models: [] }),
    ]);
    const result = await resolveRuntimeModelsMobile("rt-1", t, 5_000);
    expect(result.supported).toBe(false);
  });

  it("times out when the daemon never answers", async () => {
    const t = transport([record({ status: "pending", models: undefined })]);
    await expect(
      resolveRuntimeModelsMobile("rt-1", t, 30),
    ).rejects.toThrow(/timed out/);
  });

  it("propagates transport failures as rejections", async () => {
    const t = transport([record({})], { failAfter: 1 });
    await expect(resolveRuntimeModelsMobile("rt-1", t, 5_000)).rejects.toThrow(
      "network down",
    );
  });
});
