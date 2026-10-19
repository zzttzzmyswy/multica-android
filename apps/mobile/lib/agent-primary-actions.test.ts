import { describe, expect, it } from "vitest";
import {
  agentChatHref,
  agentPrimaryActionVisibility,
  decideAssignAction,
  decideChatAction,
  type AgentPrimaryActionInput,
} from "./agent-primary-actions";

/** A permitted, ready agent — the "everything works" baseline. */
const READY: AgentPrimaryActionInput = {
  agent: { runtime_id: "rt-1", runtime_bound: true },
  canAssign: true,
  permissionsLoading: false,
  runtimeBound: true,
};

describe("decideChatAction", () => {
  it("proceeds for a permitted agent with a bound runtime", () => {
    expect(decideChatAction(READY)).toEqual({ kind: "proceed" });
  });

  it("reports 'undetermined' (not a denial) while membership is loading", () => {
    // A real member must never be told "no permission" just because the member
    // list has not landed yet.
    expect(
      decideChatAction({ ...READY, permissionsLoading: true, canAssign: false }),
    ).toEqual({ kind: "blocked", reason: "permissions_loading" });
  });

  it("blocks with no_permission when the viewer may not invoke the agent", () => {
    expect(decideChatAction({ ...READY, canAssign: false })).toEqual({
      kind: "blocked",
      reason: "no_permission",
    });
  });

  it("blocks with runtime_required when the agent has no runtime", () => {
    // Chatting starts a run, so an unbound agent fails on send — web gates
    // chat on the runtime too.
    expect(decideChatAction({ ...READY, runtimeBound: false })).toEqual({
      kind: "blocked",
      reason: "runtime_required",
    });
  });

  it("puts the permission answer ahead of the runtime answer", () => {
    // Someone who can never use the agent should not first be told to go bind
    // a runtime they cannot use.
    expect(
      decideChatAction({ ...READY, canAssign: false, runtimeBound: false }),
    ).toEqual({ kind: "blocked", reason: "no_permission" });
  });
});

describe("decideAssignAction", () => {
  it("proceeds for a permitted agent with a bound runtime", () => {
    expect(decideAssignAction(READY)).toEqual({ kind: "proceed" });
  });

  it("reports 'undetermined' while membership is loading", () => {
    expect(
      decideAssignAction({ ...READY, permissionsLoading: true }),
    ).toEqual({ kind: "blocked", reason: "permissions_loading" });
  });

  it("blocks with no_permission when the viewer may not invoke the agent", () => {
    expect(decideAssignAction({ ...READY, canAssign: false })).toEqual({
      kind: "blocked",
      reason: "no_permission",
    });
  });

  it("blocks with runtime_required when the agent has no runtime", () => {
    expect(decideAssignAction({ ...READY, runtimeBound: false })).toEqual({
      kind: "blocked",
      reason: "runtime_required",
    });
  });
});

describe("agentPrimaryActionVisibility", () => {
  it("mounts both actions for an active agent the viewer may assign", () => {
    expect(
      agentPrimaryActionVisibility({ archived_at: null, status: "idle" }, true),
    ).toEqual({ chat: true, assign: true });
  });

  it("mounts chat but not assign when the viewer may not assign", () => {
    // Chat stays mounted on purpose: pressing it explains WHY it is denied.
    // Hiding it would tell the user the capability does not exist.
    expect(
      agentPrimaryActionVisibility({ archived_at: null, status: "idle" }, false),
    ).toEqual({ chat: true, assign: false });
  });

  it("mounts neither action for an archived agent", () => {
    expect(
      agentPrimaryActionVisibility({ archived_at: "2026-01-01T00:00:00Z", status: "idle" }, true),
    ).toEqual({ chat: false, assign: false });
  });

  it("treats an archived STATUS as archived even without archived_at", () => {
    expect(
      agentPrimaryActionVisibility({ archived_at: null, status: "archived" }, true),
    ).toEqual({ chat: false, assign: false });
  });
});

describe("agentChatHref", () => {
  it("builds the chat deep link with the agent query param", () => {
    expect(agentChatHref("acme", "agent-1")).toBe("/acme/chat?agent=agent-1");
  });

  it("url-encodes the id", () => {
    expect(agentChatHref("acme", "a/b c")).toBe("/acme/chat?agent=a%2Fb%20c");
  });
});
