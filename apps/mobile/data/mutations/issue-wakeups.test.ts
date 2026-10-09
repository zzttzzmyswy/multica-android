import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/data/api", () => ({ api: {} }));
// The mutation module binds to the workspace store, which loads
// expo-secure-store at import time (no-op in the Node lane).
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import { issueKeys } from "@/data/queries/issue-keys";
import { invalidateIssueWakeups } from "./issue-wakeups";

/**
 * Iteration 215 (MYS-2031) — the cache set a wakeup write must clear.
 *
 * This is the round's second must-agree point with web. A rule's row is drawn
 * from FOUR caches at once: the rule list, the platform's system rules, the
 * rule's own run history, and the issue's task list (which carries
 * `wakeup_id`, the only link from a rule to the run it started). Writing the
 * rule without clearing the last one is exactly how a page keeps showing
 * "Running" after the user stopped the rule — the row's state came from a
 * task cache nobody invalidated.
 *
 * Web's `invalidateIssueWakeups` (packages/core/issues/wakeups.ts:120-129)
 * names six keys; three of them (`workspace-wakeups`,
 * `issue-wakeup-summaries`, `issue-wakeup-paused`) are workspace-wide caches
 * mobile does not have — this fork ships no workspace wakeup table. The three
 * that DO exist here are all asserted below, so an omission fails rather than
 * silently inheriting web's list.
 */

/** Seed every wakeup-related cache for one issue so invalidation is
 *  observable: `invalidateQueries` marks a query stale only if it exists. */
function seed(qc: QueryClient, wsId: string, issueId: string) {
  const keys = [
    issueKeys.wakeups(wsId, issueId),
    issueKeys.systemWakeups(wsId, issueId),
    issueKeys.wakeupRuns(wsId, issueId, "w-1"),
    issueKeys.tasks(wsId, issueId),
    issueKeys.detail(wsId, issueId),
    issueKeys.timeline(wsId, issueId),
  ];
  for (const key of keys) qc.setQueryData(key, []);
  return keys;
}

describe("invalidateIssueWakeups", () => {
  it("clears the rule list, the system rules, the runs and the task list", async () => {
    const qc = new QueryClient();
    const wsId = "ws-1";
    const issueId = "i-1";
    const [rules, system, runs, tasks] = seed(qc, wsId, issueId);
    await invalidateIssueWakeups(qc, wsId, issueId);
    for (const key of [rules, system, runs, tasks]) {
      expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });

  it("reaches the runs cache through the prefix, not a direct write", async () => {
    // Asserted separately because it is the one key the caller never names:
    // TanStack matches by key PREFIX, so invalidating `wakeups` must reach a
    // child key that carries a third id. If the runs key ever stops hanging
    // off `wakeups`, the history of a rule the user just edited goes stale.
    const qc = new QueryClient();
    const runs = issueKeys.wakeupRuns("ws-1", "i-1", "w-9");
    qc.setQueryData(runs, []);
    await invalidateIssueWakeups(qc, "ws-1", "i-1");
    expect(qc.getQueryState(runs)?.isInvalidated).toBe(true);
  });

  it("leaves caches the write cannot have changed alone", async () => {
    // Over-invalidating is the cheap mistake that looks harmless and is not:
    // this runs after every toggle, and the issue detail plus the timeline are
    // the two most expensive reads on the screen.
    const qc = new QueryClient();
    const [, , , , detail, timeline] = seed(qc, "ws-1", "i-1");
    await invalidateIssueWakeups(qc, "ws-1", "i-1");
    expect(qc.getQueryState(detail)?.isInvalidated).toBe(false);
    expect(qc.getQueryState(timeline)?.isInvalidated).toBe(false);
  });

  it("does not touch another issue's wakeup caches", async () => {
    // The mutation is bound to one issue (`useEnableIssueWakeup(issueId)`),
    // and a workspace-wide sweep would refetch every open issue's rules.
    const qc = new QueryClient();
    const other = issueKeys.wakeups("ws-1", "i-2");
    qc.setQueryData(other, []);
    await invalidateIssueWakeups(qc, "ws-1", "i-1");
    expect(qc.getQueryState(other)?.isInvalidated).toBe(false);
  });

  it("does nothing without a workspace id rather than guessing one", async () => {
    // `useWorkspaceStore` yields null before the workspace loads. Query keys
    // are workspace-scoped, so a null id would address the key `["issues",
    // null, …]` — a real key that belongs to no workspace, and invalidating it
    // would clear a cache nobody reads while leaving the visible one stale.
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    await invalidateIssueWakeups(qc, null, "i-1");
    expect(spy).not.toHaveBeenCalled();
  });
});
