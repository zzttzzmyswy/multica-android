import { describe, expect, it, vi } from "vitest";

// Data-layer tests must mock `@/data/api` (vitest.config.ts note) so the
// native fetch chain never loads — the query module only calls `api` inside
// the queryFn, which these tests never execute.
vi.mock("@/data/api", () => ({ api: {} }));

import {
  autopilotKeys,
  autopilotRunOptions,
  autopilotRunsOptions,
} from "./autopilots";

// Query-options tests for the iteration-111 single-run fetch. The run-list
// endpoint omits trigger_payload; autopilotRunOptions fetches a full run on
// demand (webhook payload preview), mirroring web
// packages/core/autopilots/queries.ts autopilotRunOptions.
describe("autopilotRunOptions (iteration-111)", () => {
  it("scopes the run key under runs/<autopilotId>", () => {
    expect(autopilotKeys.runs("ws-1", "ap-1")).toEqual([
      "autopilots",
      "ws-1",
      "runs",
      "ap-1",
    ]);
    expect(autopilotKeys.run("ws-1", "ap-1", "run-1")).toEqual([
      "autopilots",
      "ws-1",
      "runs",
      "ap-1",
      "run",
      "run-1",
    ]);
  });

  it("enables the query only with workspace + both ids", () => {
    expect(autopilotRunOptions("ws-1", "ap-1", "run-1").enabled).toBe(true);
    expect(autopilotRunOptions(null, "ap-1", "run-1").enabled).toBe(false);
    expect(
      autopilotRunOptions("ws-1", "ap-1", "run-1", { enabled: false }).enabled,
    ).toBe(false);
  });

  it("keeps a distinct cache slot from the run list", () => {
    expect(autopilotRunsOptions("ws-1", "ap-1").queryKey).toEqual([
      "autopilots",
      "ws-1",
      "runs",
      "ap-1",
    ]);
    expect(autopilotRunOptions("ws-1", "ap-1", "run-1").queryKey).not.toEqual(
      autopilotRunsOptions("ws-1", "ap-1").queryKey,
    );
  });
});