import { describe, expect, it, vi } from "vitest";

vi.mock("@/data/api", () => ({ api: {} }));
// The mutation module binds to the workspace store, which loads
// expo-secure-store at import time (no-op in the Node lane).
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import type { WorkspaceWakeup } from "@multica/core/types";
import { disableWorkspaceWakeupsSequentially } from "./workspace-wakeups";

/**
 * Iteration 217 (MYS-2043) — the workspace batch write's loop.
 *
 * The decision layer (`lib/workspace-wakeups.test.ts`) covers what a batch
 * RESULT means once it exists; this covers what the loop DOES — that a refusal
 * in the middle neither aborts the run nor disappears, that the counts are
 * right, and that a partial failure is RETURNED rather than thrown.
 *
 * That last point is the one a user can be misled by, and it is a must-agree
 * point with web (`packages/core/issues/wakeups.ts:180-203`). Web returns
 * `{failed, succeeded}` from a successful mutation; the screen then prints
 * "12 turned off, 3 failed, the 3 stay selected". A mobile port that threw on
 * the first refusal would show "operation failed" while twelve rules were in
 * fact turned off — the opposite of what happened.
 *
 * The loop is exercised through its `disable` callback rather than through a
 * hook: the Node lane has no renderer, so `useMutation`'s `mutationFn` cannot
 * be reached from here at all. That is why the loop was extracted.
 */

function row(id: string, issueId: string): WorkspaceWakeup {
  // Only the two fields the loop reads. A full row needs thirty; building one
  // here would be a fixture that drifts from the server's shape without
  // testing anything the loop touches.
  return { id, issue_id: issueId } as WorkspaceWakeup;
}

describe("disableWorkspaceWakeupsSequentially", () => {
  it("reports every rule as succeeded when none refuse", async () => {
    const rows = [row("w1", "i1"), row("w2", "i2"), row("w3", "i3")];
    const disable = vi.fn().mockResolvedValue(undefined);
    const result = await disableWorkspaceWakeupsSequentially(rows, disable);
    expect(result).toEqual({ failed: [], succeeded: 3 });
    expect(disable).toHaveBeenCalledTimes(3);
  });

  it("targets each rule's OWN issue, not the first row's", async () => {
    // The one bug a batch over many issues can have that a single-rule write
    // cannot: a loop that hoists `rows[0].issue_id` would send every disable to
    // the first issue and the server would answer 404 for rules that are not
    // on it — or worse, disable an unrelated rule that happens to share an id.
    const rows = [row("w1", "iA"), row("w2", "iB")];
    const disable = vi.fn().mockResolvedValue(undefined);
    await disableWorkspaceWakeupsSequentially(rows, disable);
    expect(disable.mock.calls).toEqual([
      ["iA", "w1"],
      ["iB", "w2"],
    ]);
  });

  it("keeps going after a refusal and records exactly which rule failed", async () => {
    const rows = [row("w1", "i1"), row("w2", "i2"), row("w3", "i3")];
    const disable = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("403 forbidden"))
      .mockResolvedValueOnce(undefined);
    const result = await disableWorkspaceWakeupsSequentially(rows, disable);
    expect(result).toEqual({ failed: ["w2"], succeeded: 2 });
    // The third call is the assertion that matters: a loop that returned or
    // threw on the refusal would leave it at two, and the third rule — which
    // the user asked to stop — would silently stay on.
    expect(disable).toHaveBeenCalledTimes(3);
  });

  it("returns a result rather than throwing when every rule refuses", async () => {
    // Even a total failure is a payload, not an exception: the ids are what the
    // screen re-selects for a retry, and an exception would carry only the last
    // error and lose the other ids.
    const rows = [row("w1", "i1"), row("w2", "i2")];
    const disable = vi.fn().mockRejectedValue(new Error("network"));
    const result = await disableWorkspaceWakeupsSequentially(rows, disable);
    expect(result).toEqual({ failed: ["w1", "w2"], succeeded: 0 });
  });

  it("writes sequentially, never in parallel", async () => {
    // Load-bounding is the stated reason for the loop shape, and it is not
    // visible from the result — a `Promise.all` over the same rows returns the
    // same counts. Asserted by ordering: each call starts only after the
    // previous one settled.
    const order: string[] = [];
    const rows = [row("w1", "i1"), row("w2", "i2"), row("w3", "i3")];
    const disable = vi.fn(async (_issueId: string, wakeupId: string) => {
      order.push(`start:${wakeupId}`);
      await Promise.resolve();
      order.push(`end:${wakeupId}`);
    });
    await disableWorkspaceWakeupsSequentially(rows, disable);
    expect(order).toEqual([
      "start:w1",
      "end:w1",
      "start:w2",
      "end:w2",
      "start:w3",
      "end:w3",
    ]);
  });

  it("is a successful no-op for an empty selection", async () => {
    const disable = vi.fn();
    const result = await disableWorkspaceWakeupsSequentially([], disable);
    expect(result).toEqual({ failed: [], succeeded: 0 });
    expect(disable).not.toHaveBeenCalled();
  });
});
