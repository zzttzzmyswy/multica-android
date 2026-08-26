import { describe, expect, it } from "vitest";
import type { AgentDraft } from "@multica/core/agents";
import type { Agent, RuntimeDevice } from "@multica/core/types";
import {
  classifyAgentCreateError,
  agentCreateGate,
  resolveDuplicateSeed,
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

function sourceAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    workspace_id: "ws-1",
    name: "Core Research",
    description: "Find the answer",
    instructions: "Be thorough.",
    avatar_url: "emoji:🤖",
    runtime_id: "r-src",
    runtime_mode: "local",
    runtime_config: {},
    custom_args: ["--foo"],
    visibility: "private",
    permission_mode: "private",
    invocation_targets: [],
    status: "active",
    max_concurrent_tasks: 2,
    model: "gpt-5.2",
    thinking_level: "high",
    service_tier: "standard",
    owner_id: "u1",
    skills: [{ id: "skill-1", name: "Duck", description: "Fetch things" }],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    archived_at: null,
    archived_by: null,
    ...overrides,
  } as unknown as Agent;
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

describe("resolveDuplicateSeed", () => {
  // Same-runtime fixture: `r-src` public + online, so `u1` may use it.
  const SRC = sourceAgent();
  const onlineSrc = runtime("r-src");
  const fallback = runtime("r-fallback");

  const opts = (
    overrides: Partial<{
      source: Agent | null;
      runtimesSettled: boolean;
      runtimes: RuntimeDevice[];
      currentUserId: string | null;
      fallbackRuntimeId: string;
      nameSuffix: string;
    }>,
  ) => ({
    source: SRC,
    runtimesSettled: true,
    runtimes: [onlineSrc, fallback] as RuntimeDevice[],
    currentUserId: "u1",
    fallbackRuntimeId: "r-fallback",
    nameSuffix: " (Copy)",
    ...overrides,
  });

  it("returns null while the runtime query is still pending", () => {
    expect(
      resolveDuplicateSeed(opts({ runtimesSettled: false, runtimes: [] })),
    ).toBeNull();
  });

  it("returns null when there is no source (blank create / unresolved duplicate id)", () => {
    expect(resolveDuplicateSeed(opts({ source: null }))).toBeNull();
  });

  it("copies the source onto the same usable runtime — model/thinking/speed ride along", () => {
    const result = resolveDuplicateSeed(opts({}));
    expect(result).not.toBeNull();
    expect(result!.runtimeReset).toBe(false);
    expect(result!.draft).toMatchObject({
      name: "Core Research (Copy)",
      description: "Find the answer",
      instructions: "Be thorough.",
      avatarUrl: "emoji:🤖",
      runtimeId: "r-src",
      model: "gpt-5.2",
      thinkingLevel: "high",
      serviceTier: "standard",
      permissionScope: "private",
    });
    expect([...result!.draft.skillIds]).toEqual(["skill-1"]);
  });

  it("keeps an offline source runtime when it is still usable for the member", () => {
    const result = resolveDuplicateSeed(
      opts({ runtimes: [runtime("r-src", { status: "offline" }), fallback] }),
    );
    expect(result!.runtimeReset).toBe(false);
    expect(result!.draft.runtimeId).toBe("r-src");
    expect(result!.draft.model).toBe("gpt-5.2");
  });

  it("falls back to another runtime when the source runtime is gone, resetting the copy", () => {
    const result = resolveDuplicateSeed(
      opts({ runtimes: [fallback] }),
    );
    expect(result!.runtimeReset).toBe(true);
    expect(result!.draft.runtimeId).toBe("r-fallback");
    expect(result!.draft.model).toBe("");
    expect(result!.draft.thinkingLevel).toBe("");
    expect(result!.draft.serviceTier).toBe("");
  });

  it("falls back when the source runtime is private to somebody else", () => {
    const privateOther = runtime("r-src", {
      visibility: "private",
      owner_id: "someone-else",
    });
    const result = resolveDuplicateSeed(opts({ runtimes: [privateOther, fallback] }));
    expect(result!.runtimeReset).toBe(true);
    expect(result!.draft.runtimeId).toBe("r-fallback");
  });

  it("falls back when the source runtime is ownerless (usable by nobody)", () => {
    const ownerless = runtime("r-src", { owner_id: null });
    const result = resolveDuplicateSeed(opts({ runtimes: [ownerless, fallback] }));
    expect(result!.runtimeReset).toBe(true);
    expect(result!.draft.runtimeId).toBe("r-fallback");
  });

  it("keeps an empty runtimeId when no source runtime and no fallback exist", () => {
    const unbound = sourceAgent({ runtime_id: "" });
    const result = resolveDuplicateSeed(
      opts({ source: unbound, runtimes: [], fallbackRuntimeId: "" }),
    );
    // Nothing was reset: the source was unbound already and the draft stays
    // unbound — the submit gate blocks until the user picks a runtime.
    expect(result!.runtimeReset).toBe(false);
    expect(result!.draft.runtimeId).toBe("");
  });

  it("derives a members scope from the source's invocation targets", () => {
    const shared = sourceAgent({
      permission_mode: "public_to",
      invocation_targets: [
        { target_type: "member", target_id: "m1" },
        { target_type: "team", target_id: "t1" },
      ],
    });
    const result = resolveDuplicateSeed(opts({ source: shared }));
    expect(result!.draft.permissionScope).toBe("members");
    expect([...result!.draft.memberIds]).toEqual(["m1"]);
    expect([...result!.draft.teamIds]).toEqual(["t1"]);
  });
});