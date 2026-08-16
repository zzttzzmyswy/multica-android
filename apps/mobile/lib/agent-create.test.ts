import { describe, expect, it } from "vitest";
import type { AgentDraft } from "@multica/core/agents";
import type { RuntimeDevice } from "@multica/core/types";
import {
  classifyAgentCreateError,
  agentCreateGate,
  usableRuntimes,
} from "./agent-create";

const EMPTY_DRAFT: AgentDraft = {
  name: "",
  description: "",
  instructions: "",
  avatarUrl: null,
  runtimeId: "",
  model: "",
  thinkingLevel: "",
  serviceTier: "",
  skillIds: new Set(),
  permissionScope: "private",
  memberIds: new Set(),
  teamIds: new Set(),
};

function runtime(
  id: string,
  overrides: Partial<RuntimeDevice> = {},
): RuntimeDevice {
  return {
    id,
    name: id,
    status: "online",
    owner_id: "u1",
    visibility: "public",
    runtime_mode: "local",
    provider: "codex",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    last_seen_at: "2026-08-16T00:00:00Z",
    ...overrides,
  } as RuntimeDevice;
}

function draft(overrides: Partial<AgentDraft> = {}): AgentDraft {
  return { ...EMPTY_DRAFT, ...overrides };
}

describe("usableRuntimes", () => {
  const list = [
    runtime("r-online-public"), // usable by anyone
    runtime("r-online-private", { visibility: "private", owner_id: "other" }), // not usable
    runtime("r-own-private", { visibility: "private", owner_id: "u1" }), // usable (own)
    runtime("r-offline-public", { status: "offline" }), // excluded — offline
    runtime("r-ownerless", { owner_id: null }), // excluded — ownerless
  ];

  it("keeps online runtimes the member may use, drops the rest", () => {
    const result = usableRuntimes(list, "u1");
    expect(result.map((r) => r.id)).toEqual(["r-online-public", "r-own-private"]);
  });

  it("treats an unknown member as allowed (auth still loading)", () => {
    const result = usableRuntimes([runtime("r-online-private", { visibility: "private", owner_id: "other" })], null);
    expect(result.map((r) => r.id)).toEqual(["r-online-private"]);
  });
});

describe("agentCreateGate", () => {
  const online = runtime("r-online-public");

  it("defaults to a clean gate with a name and a usable runtime", () => {
    const g = agentCreateGate(draft({ name: "  My Agent  " }), online, "u1");
    expect(g).toEqual({
      nameMissing: false,
      runtimeMissing: false,
      accessInvalid: false,
      descriptionOverLimit: false,
    });
  });

  it("flags a missing name", () => {
    const g = agentCreateGate(draft(), online, "u1");
    expect(g.nameMissing).toBe(true);
  });

  it("flags a missing/unusable runtime (null selection or not usable for user)", () => {
    expect(agentCreateGate(draft({ name: "x" }), null, "u1").runtimeMissing).toBe(true);
    const privateOther = runtime("r-p", { visibility: "private", owner_id: "other" });
    expect(agentCreateGate(draft({ name: "x" }), privateOther, "u1").runtimeMissing).toBe(true);
  });

  it("flags a members scope with no members picked", () => {
    const withScope = draft({
      name: "x",
      permissionScope: "members",
      memberIds: new Set(),
    });
    expect(agentCreateGate(withScope, online, "u1").accessInvalid).toBe(true);
    const withMember = draft({
      name: "x",
      permissionScope: "members",
      memberIds: new Set(["m1"]),
    });
    expect(agentCreateGate(withMember, online, "u1").accessInvalid).toBe(false);
  });

  it("flags a description over the 255-char server cap", () => {
    const overLimit = draft({ name: "x", description: "a".repeat(256) });
    expect(agentCreateGate(overLimit, online, "u1").descriptionOverLimit).toBe(true);
    const atLimit = draft({ name: "x", description: "a".repeat(255) });
    expect(agentCreateGate(atLimit, online, "u1").descriptionOverLimit).toBe(false);
  });
});

describe("classifyAgentCreateError", () => {
  it("maps a 409 conflict to the name field", () => {
    const result = classifyAgentCreateError(
      { status: 409, message: "duplicate" },
      "fallback",
      "conflict message",
    );
    expect(result).toEqual({ nameError: "conflict message", formError: null });
  });

  it("maps any other error to a form error, keeping the server message", () => {
    const result = classifyAgentCreateError(
      new Error("description too long"),
      "fallback",
      "conflict message",
    );
    expect(result).toEqual({ nameError: null, formError: "description too long" });
  });

  it("falls back to the given message on a non-Error failure", () => {
    const result = classifyAgentCreateError(undefined, "fallback", "conflict");
    expect(result.formError).toBe("fallback");
  });
});