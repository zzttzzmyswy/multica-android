import { describe, expect, it, vi } from "vitest";

// Data-layer tests must mock `@/data/api` (vitest.config.ts note) so the
// native fetch chain never loads — the query module only calls `api` inside
// the queryFn, which these tests never execute.
vi.mock("@/data/api", () => ({ api: {} }));

import {
  larkKeys,
  larkInstallationsOptions,
  slackKeys,
  slackInstallationsOptions,
  dingtalkKeys,
  dingtalkInstallationsOptions,
  wecomKeys,
  wecomInstallationsOptions,
  channelState,
} from "./integrations";

// Query keys/options + per-agent channel state helper for the four external
// channels (iteration-98 A14). `channelState` is the pure derivation the agent
// Integrations page uses to pick copy per channel: configured / install_supported
// / per-agent active-install filter — mirroring web's integrations-tab.tsx
// branch order and packages/views/settings/components/*-tab.tsx flags.
describe("channel query keys + options", () => {
  it("scopes keys and the query under the workspace id per channel", () => {
    expect(larkKeys.installations("ws-1")).toEqual(["lark", "ws-1", "installations"]);
    expect(slackKeys.installations("ws-1")).toEqual(["slack", "ws-1", "installations"]);
    expect(dingtalkKeys.installations("ws-1")).toEqual([
      "dingtalk",
      "ws-1",
      "installations",
    ]);
    expect(wecomKeys.installations("ws-1")).toEqual(["wecom", "ws-1", "installations"]);

    expect(larkInstallationsOptions("ws-1").queryKey).toEqual([
      "lark",
      "ws-1",
      "installations",
    ]);
    expect(slackInstallationsOptions("ws-1").enabled).toBe(true);
    expect(dingtalkInstallationsOptions("ws-1").enabled).toBe(true);
    expect(wecomInstallationsOptions("ws-1").enabled).toBe(true);
  });

  it("disables the query when no workspace is selected", () => {
    expect(larkInstallationsOptions(null).enabled).toBe(false);
  });
});

describe("channelState — configured / install_supported / per-agent filter", () => {
  it("configured false → channel not available for binding", () => {
    const state = channelState({ installations: [], configured: false }, "a-1");
    expect(state.configured).toBe(false);
  });

  it("configured omitted (older backend) → treated as not configured", () => {
    expect(channelState({ installations: [] }, "a-1").configured).toBe(false);
  });

  it("install_supported gates the bind CTA (false by default)", () => {
    expect(
      channelState({ installations: [], configured: true }, "a-1").installSupported,
    ).toBe(false);
    expect(
      channelState(
        { installations: [], configured: true, install_supported: false },
        "a-1",
      ).installSupported,
    ).toBe(false);
    expect(
      channelState(
        { installations: [], configured: true, install_supported: true },
        "a-1",
      ).installSupported,
    ).toBe(true);
  });

  it("filters installations down to the current agent's active one", () => {
    const state = channelState(
      {
        configured: true,
        install_supported: true,
        installations: [
          { id: "i-other", agent_id: "other-agent", status: "active" },
          { id: "i-mine", agent_id: "a-1", status: "active" },
          { id: "i-revoked", agent_id: "a-1", status: "revoked" },
        ],
      },
      "a-1",
    );
    expect(state.activeInstall?.id).toBe("i-mine");
  });

  it("no active install for the agent → null even with other agents bound", () => {
    const state = channelState(
      {
        configured: true,
        install_supported: true,
        installations: [{ id: "i-other", agent_id: "other-agent", status: "active" }],
      },
      "a-1",
    );
    expect(state.activeInstall).toBeNull();
  });

  it("a revoked install for the agent is not treated as active", () => {
    const state = channelState(
      {
        configured: true,
        installations: [{ id: "i-revoked", agent_id: "a-1", status: "revoked" }],
      },
      "a-1",
    );
    expect(state.activeInstall).toBeNull();
  });

  it("undefined listing → safe fallback state (all read-only)", () => {
    const state = channelState(undefined, "a-1");
    expect(state).toEqual({
      configured: false,
      installSupported: false,
      activeInstall: null,
    });
  });
});