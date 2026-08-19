import { describe, expect, it, vi } from "vitest";

// Data-layer tests must mock `@/data/api` (vitest.config.ts note) so the
// native fetch chain never loads — the query module only calls `api` inside
// the queryFn, which these tests never execute.
vi.mock("@/data/api", () => ({ api: {} }));

import { vcsConnectionsOptions, vcsKeys, vcsViewState } from "./vcs";

// Query-options + deployment-semantics tests for the VCS integration
// (iteration-59). The view-state helper is what the Settings → Integrations
// VCS section uses to gate visibility and the connect form; these cases pin
// the three web-vcs-tab client semantics on the parsed list response.
describe("vcsKeys + vcsConnectionsOptions", () => {
  it("scopes keys and the query under the workspace id", () => {
    expect(vcsKeys.all("ws-1")).toEqual(["vcs", "ws-1"]);
    expect(vcsKeys.connections("ws-1")).toEqual(["vcs", "ws-1", "connections"]);

    const opts = vcsConnectionsOptions("ws-1");
    expect(opts.queryKey).toEqual(["vcs", "ws-1", "connections"]);
    expect(opts.enabled).toBe(true);
  });

  it("disables the query when no workspace is selected", () => {
    expect(vcsConnectionsOptions(null).enabled).toBe(false);
  });
});

describe("vcsViewState — available / configured / can_manage semantics", () => {
  it("available=false hides the whole section", () => {
    const state = vcsViewState({
      connections: [],
      available: false,
      configured: false,
      can_manage: false,
    });
    expect(state.available).toBe(false);
  });

  it("available omitted (older backend) → renders, safe self-host default", () => {
    expect(vcsViewState({ connections: [] }).available).toBe(true);
    expect(vcsViewState(undefined).available).toBe(true);
  });

  it("configured true enables the connect form; false or omitted disables it", () => {
    expect(vcsViewState({ connections: [], configured: true }).configured).toBe(
      true,
    );
    expect(
      vcsViewState({ connections: [], configured: false }).configured,
    ).toBe(false);
    // omitted (older backend) → configured=false → form stays disabled
    expect(vcsViewState({ connections: [] }).configured).toBe(false);
  });

  it("can_manage true allows manage actions; false or omitted → read-only", () => {
    expect(vcsViewState({ connections: [], can_manage: true }).canManage).toBe(
      true,
    );
    expect(
      vcsViewState({ connections: [], can_manage: false }).canManage,
    ).toBe(false);
    // omitted (older backend) → can_manage=false → read-only list
    expect(vcsViewState({ connections: [] }).canManage).toBe(false);
  });
});