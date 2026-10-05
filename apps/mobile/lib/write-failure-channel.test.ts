import { MutationCache, MutationObserver, QueryClient } from "@tanstack/query-core";
import { describe, expect, it, vi } from "vitest";
import {
  WRITE_FAILURE_TITLE_KEY,
  reportWriteFailure,
  type WriteFailureAlerter,
} from "./write-failure";

/**
 * The end-to-end test for the channel iteration 195 actually ships.
 *
 * The scenario the fix exists for: a picker fires a write and the screen
 * unmounts on the next frame (`router.back()`), while the request only fails
 * later — up to FETCH_TIMEOUT_MS = 30s (api.ts). A per-call `onError` passes the
 * obvious review (it is right there next to `mutate`) but never runs in that
 * case: `mutationObserver.js:77` gates the per-call options on
 * `hasListeners()`, and unmounting unsubscribes the observer.
 *
 * These tests drive the real @tanstack/query-core, so they fail if the wiring
 * ever regresses to a component-lifetime channel — which a helper-level test
 * cannot detect.
 */

const FAILING = () => Promise.reject(new Error("boom"));
const translate = (id: string) => `t:${id}`;
const REPORTED = { [WRITE_FAILURE_TITLE_KEY]: "issueRelation.updateFailed" };

function makeClient(alert: WriteFailureAlerter) {
  return new QueryClient({
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) =>
        reportWriteFailure(error, mutation, translate, alert),
    }),
    defaultOptions: { mutations: { retry: false } },
  });
}

/** Fires a mutation through a real observer, optionally unsubscribing (which is
 *  what a component unmount does) before the rejection lands. */
async function fire(
  client: QueryClient,
  { unmount, meta }: { unmount: boolean; meta?: Record<string, unknown> },
) {
  const observer = new MutationObserver(client, {
    mutationFn: FAILING,
    ...(meta ? { meta } : {}),
  });
  const unsubscribe = observer.subscribe(() => {});
  const promise = observer.mutate();
  if (unmount) unsubscribe();
  await promise.catch(() => {});
  await new Promise((r) => setTimeout(r, 10));
}

describe("the write-failure channel survives unmount", () => {
  it("reports a failed write whose screen already unmounted", async () => {
    // The whole point: this is the shape of all 15 picker writes.
    const alert = vi.fn<WriteFailureAlerter>();
    await fire(makeClient(alert), { unmount: true, meta: REPORTED });

    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0]?.[0]).toBe("t:issueRelation.updateFailed");
    expect(alert.mock.calls[0]?.[1]).toBe("boom");
  });

  it("reports a failed write that stayed mounted", async () => {
    const alert = vi.fn<WriteFailureAlerter>();
    await fire(makeClient(alert), { unmount: false, meta: REPORTED });

    expect(alert).toHaveBeenCalledTimes(1);
  });

  it("stays silent for a write that opted out of reporting", async () => {
    // Background bookkeeping (mark-read calls) must not start alerting.
    const alert = vi.fn<WriteFailureAlerter>();
    await fire(makeClient(alert), { unmount: true });

    expect(alert).not.toHaveBeenCalled();
  });

  it("a per-call onError would NOT have survived the unmount", async () => {
    // Pins the reason the channel is at the cache level. If a future
    // @tanstack upgrade makes per-call handlers lifecycle-independent, this
    // test fails and the extra indirection can be revisited deliberately.
    const perCall = vi.fn<(err: unknown) => void>();
    const client = makeClient(vi.fn<WriteFailureAlerter>());

    const observer = new MutationObserver(client, { mutationFn: FAILING });
    const unsubscribe = observer.subscribe(() => {});
    const promise = observer.mutate(undefined, { onError: perCall });
    unsubscribe();
    await promise.catch(() => {});
    await new Promise((r) => setTimeout(r, 10));

    expect(perCall).not.toHaveBeenCalled();
  });
});
