import { describe, expect, it, vi } from "vitest";

// Data-layer tests must mock `@/data/api` (vitest.config.ts note) so the native
// fetch chain never loads — this module only touches `api` inside its queryFn,
// which these tests never execute.
vi.mock("@/data/api", () => ({ api: {} }));

import {
  issueWakeupsOptions,
  issueSystemWakeupsOptions,
  issueWakeupRunsOptions,
} from "./issue-wakeups";
import { issueKeys } from "./issue-keys";

// Iteration 214 (MYS-2023). The query keys are the load-bearing part of this
// layer: the section and the header chip must read the SAME cache entry, or a
// screen with both mounted fires two requests for one rule list. They are also
// what a workspace switch must move — keys are workspace-scoped by construction
// (root CLAUDE.md "Workspace-scoped queries must key on wsId").

describe("issue wakeup query keys (MYS-2023)", () => {
  it("scopes every key to the workspace and the issue", () => {
    expect(issueWakeupsOptions("ws1", "i1").queryKey).toContain("ws1");
    expect(issueWakeupsOptions("ws1", "i1").queryKey).toContain("i1");
    expect(issueWakeupRunsOptions("ws1", "i1", "w1").queryKey).toContain("w1");
  });

  it("moves the key when the workspace changes", () => {
    expect(issueWakeupsOptions("ws1", "i1").queryKey).not.toEqual(
      issueWakeupsOptions("ws2", "i1").queryKey,
    );
  });

  it("hangs the rule keys off issueKeys so one invalidation reaches them", () => {
    // Prefix discipline: `issueKeys.all(wsId)` is what a workspace-wide
    // invalidation targets. A wakeup key outside that prefix would survive it.
    const prefix = issueKeys.all("ws1") as readonly unknown[];
    for (const key of [
      issueWakeupsOptions("ws1", "i1").queryKey,
      issueSystemWakeupsOptions("ws1", "i1").queryKey,
      issueWakeupRunsOptions("ws1", "i1", "w1").queryKey,
    ]) {
      expect(key.slice(0, prefix.length)).toEqual(prefix);
    }
  });

  it("keeps the three families distinct for one issue", () => {
    const keys = [
      issueWakeupsOptions("ws1", "i1").queryKey,
      issueSystemWakeupsOptions("ws1", "i1").queryKey,
    ].map((k) => JSON.stringify(k));
    expect(new Set(keys).size).toBe(2);
  });

  it("stays disabled until both ids are known", () => {
    expect(issueWakeupsOptions(null, "i1").enabled).toBe(false);
    expect(issueWakeupsOptions("ws1", "").enabled).toBe(false);
    expect(issueWakeupsOptions("ws1", "i1").enabled).toBe(true);
    expect(issueWakeupRunsOptions("ws1", "i1", "").enabled).toBe(false);
  });
});
