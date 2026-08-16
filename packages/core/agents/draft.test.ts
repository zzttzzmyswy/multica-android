import { describe, expect, it } from "vitest";
import type { Agent, RuntimeDevice } from "../types";
import {
  applyDraftModelChange,
  applyDraftRuntimeChange,
  buildCreateAgentRequest,
  buildDuplicateDraft,
  buildInvocationTargets,
  buildUpdateAgentRequest,
  deriveDuplicateAccess,
  isDraftDescriptionWithinLimit,
  seedDraftFromAgent,
  type AgentDraft,
} from "./draft";

const draft = (): AgentDraft => ({
  name: "Old name",
  description: "Old description",
  instructions: "Old instructions",
  avatarUrl: null,
  runtimeId: "runtime-1",
  model: "model-1",
  thinkingLevel: "",
  serviceTier: "",
  skillIds: new Set(["skill-1"]),
  permissionScope: "private",
  memberIds: new Set(),
  teamIds: new Set(),
});

const CODEX_RUNTIME: RuntimeDevice = {
  id: "runtime-1",
  workspace_id: "ws-1",
  name: "Codex laptop",
  provider: "codex",
  status: "online",
  owner_id: "user-1",
  visibility: "private",
} as RuntimeDevice;

const OTHER_RUNTIME: RuntimeDevice = {
  ...CODEX_RUNTIME,
  id: "runtime-2",
  name: "Spare laptop",
} as RuntimeDevice;

const sourceAgent = (overrides: Partial<Agent> = {}): Agent =>
  ({
    id: "agent-1",
    workspace_id: "ws-1",
    runtime_id: "runtime-1",
    name: "Fast Codex",
    description: "Ships quickly",
    instructions: "Be quick",
    avatar_url: null,
    runtime_mode: "managed",
    runtime_config: {},
    custom_args: ["--verbose"],
    visibility: "private",
    permission_mode: "private",
    invocation_targets: [],
    status: "idle",
    max_concurrent_tasks: 9,
    model: "gpt-5.6-sol",
    thinking_level: "high",
    service_tier: "priority",
    owner_id: "user-1",
    skills: [{ id: "skill-1", name: "Review", description: "" }],
    created_at: "2026-07-28T00:00:00Z",
    updated_at: "2026-07-28T00:00:00Z",
    archived_at: null,
    archived_by: null,
    ...overrides,
  }) as Agent;

describe("duplicate access", () => {
  it("preserves scoped member and team grants when duplicating an agent", () => {
    const access = deriveDuplicateAccess({
      permission_mode: "public_to",
      invocation_targets: [
        { target_type: "member", target_id: "member-1" },
        { target_type: "team", target_id: "team-1" },
      ],
    });
    const duplicateDraft = {
      ...draft(),
      ...access,
    };

    expect(access.permissionScope).toBe("members");
    expect(buildInvocationTargets(duplicateDraft)).toEqual([
      { target_type: "member", target_id: "member-1" },
      { target_type: "team", target_id: "team-1" },
    ]);
  });

  it("keeps workspace-wide duplicate access workspace-wide", () => {
    expect(
      deriveDuplicateAccess({
        permission_mode: "public_to",
        invocation_targets: [{ target_type: "workspace", target_id: null }],
      }).permissionScope,
    ).toBe("workspace");
  });
});

// MUL-5390: thinking_level / service_tier are runtime + model scoped. The create
// flow never exposed them, so a Fast Codex agent could only be configured after
// the fact and a Duplicate silently dropped the setting.
describe("agent draft execution overrides", () => {
  it("sends the selected thinking level and service tier", () => {
    const request = buildCreateAgentRequest({
      draft: {
        ...draft(),
        model: "gpt-5.6-sol",
        thinkingLevel: "high",
        serviceTier: "priority",
      },
      runtimeId: "runtime-1",
    });

    expect(request).toMatchObject({
      runtime_id: "runtime-1",
      model: "gpt-5.6-sol",
      thinking_level: "high",
      service_tier: "priority",
    });
  });

  it("omits empty overrides instead of sending an empty string", () => {
    const request = buildCreateAgentRequest({
      draft: { ...draft(), model: "" },
      runtimeId: "runtime-1",
    });

    expect(request.model).toBeUndefined();
    expect(request.thinking_level).toBeUndefined();
    expect(request.service_tier).toBeUndefined();
    expect("thinking_level" in request).toBe(true);
    expect(JSON.parse(JSON.stringify(request))).not.toHaveProperty(
      "thinking_level",
    );
  });

  it("carries the runtime-independent duplicate config", () => {
    const request = buildCreateAgentRequest({
      draft: { ...draft(), thinkingLevel: "high", serviceTier: "priority" },
      runtimeId: "runtime-1",
      duplicateSource: sourceAgent(),
    });

    expect(request.custom_args).toEqual(["--verbose"]);
    expect(request.max_concurrent_tasks).toBe(9);
    expect(request.thinking_level).toBe("high");
  });

  it.each([0, -1, 51])(
    "omits an invalid historical duplicate concurrency of %i",
    (maxConcurrentTasks) => {
      const request = buildCreateAgentRequest({
        draft: draft(),
        runtimeId: "runtime-1",
        duplicateSource: sourceAgent({
          max_concurrent_tasks: maxConcurrentTasks,
        }),
      });

      expect(request.max_concurrent_tasks).toBeUndefined();
      expect(request).not.toHaveProperty("max_concurrent_tasks");
    },
  );

  it("clears model, thinking level and service tier on a runtime change", () => {
    const current = {
      ...draft(),
      thinkingLevel: "high",
      serviceTier: "priority",
    };

    expect(applyDraftRuntimeChange(current, "runtime-2")).toMatchObject({
      runtimeId: "runtime-2",
      model: "",
      thinkingLevel: "",
      serviceTier: "",
    });
  });

  it("clears only the per-model overrides on a model change", () => {
    const current = {
      ...draft(),
      thinkingLevel: "high",
      serviceTier: "priority",
    };
    const next = applyDraftModelChange(current, "gpt-5.4-mini");

    expect(next).toMatchObject({
      runtimeId: "runtime-1",
      model: "gpt-5.4-mini",
      thinkingLevel: "",
      serviceTier: "",
    });
    // Re-selecting the same model must not wipe a choice the user just made.
    expect(applyDraftModelChange(current, "model-1")).toBe(current);
  });

  it("copies the execution config when the duplicate stays on its runtime", () => {
    const duplicate = buildDuplicateDraft(sourceAgent(), {
      runtimes: [CODEX_RUNTIME],
      currentUserId: "user-1",
      fallbackRuntimeId: "runtime-1",
      nameSuffix: " copy",
    });

    expect(duplicate).toMatchObject({
      name: "Fast Codex copy",
      runtimeId: "runtime-1",
      model: "gpt-5.6-sol",
      thinkingLevel: "high",
      serviceTier: "priority",
    });
    expect([...duplicate.skillIds]).toEqual(["skill-1"]);
  });

  it("drops the execution config when the duplicate falls back to another runtime", () => {
    // Source runtime is gone from the list (deleted, or private to someone
    // else), so the draft lands on the fallback. Keeping the source model here
    // is what persisted a cross-provider model before MUL-5390.
    const duplicate = buildDuplicateDraft(sourceAgent(), {
      runtimes: [OTHER_RUNTIME],
      currentUserId: "user-1",
      fallbackRuntimeId: "runtime-2",
      nameSuffix: " copy",
    });

    expect(duplicate).toMatchObject({
      runtimeId: "runtime-2",
      model: "",
      thinkingLevel: "",
      serviceTier: "",
    });
  });

  it("drops the execution config when the source runtime is private to someone else", () => {
    const duplicate = buildDuplicateDraft(sourceAgent(), {
      runtimes: [
        { ...CODEX_RUNTIME, owner_id: "user-2" } as RuntimeDevice,
        { ...OTHER_RUNTIME, owner_id: "user-1" } as RuntimeDevice,
      ],
      currentUserId: "user-1",
      fallbackRuntimeId: "runtime-2",
      nameSuffix: " copy",
    });

    expect(duplicate).toMatchObject({
      runtimeId: "runtime-2",
      model: "",
      thinkingLevel: "",
      serviceTier: "",
    });
  });

  it("enforces the 255-rune description limit the create API applies", () => {
    expect(isDraftDescriptionWithinLimit("a".repeat(255))).toBe(true);
    expect(isDraftDescriptionWithinLimit("a".repeat(256))).toBe(false);
    // Runes, not UTF-16 units: 255 CJK characters are exactly at the limit.
    expect(isDraftDescriptionWithinLimit("汉".repeat(255))).toBe(true);
    expect(isDraftDescriptionWithinLimit("汉".repeat(256))).toBe(false);
  });
});

describe("seedDraftFromAgent", () => {
  it("round-trips an agent's fields plus its derived grants", () => {
    const seeded = seedDraftFromAgent(
      sourceAgent({
        permission_mode: "public_to",
        invocation_targets: [{ target_type: "member", target_id: "member-1" }],
      }),
    );

    expect(seeded).toMatchObject({
      name: "Fast Codex",
      description: "Ships quickly",
      instructions: "Be quick",
      runtimeId: "runtime-1",
      model: "gpt-5.6-sol",
      thinkingLevel: "high",
      serviceTier: "priority",
      permissionScope: "members",
    });
    expect([...seeded.memberIds]).toEqual(["member-1"]);
    expect([...seeded.skillIds]).toEqual(["skill-1"]);
  });

  it("keeps the agent's own runtime even when it is offline — an edit must not force a rebind", () => {
    const seeded = seedDraftFromAgent(
      sourceAgent({ runtime_id: "runtime-2" }),
    );
    expect(seeded.runtimeId).toBe("runtime-2");
  });
});

describe("buildUpdateAgentRequest", () => {
  it("assembles the PUT body from a draft, clearing overrides explicitly", () => {
    const request = buildUpdateAgentRequest({
      draft: {
        ...draft(),
        name: "  Renamed ",
        description: "  New desc  ",
        model: "",
        thinkingLevel: "",
        serviceTier: "",
      },
      runtimeId: "runtime-1",
    });

    expect(request).toMatchObject({
      name: "Renamed",
      description: "New desc",
      runtime_id: "runtime-1",
      // Tri-state semantics: "" is the explicit "clear / fall back to runtime
      // default" signal on UPDATE, where an omitted field would preserve the
      // saved override.
      model: "",
      thinking_level: "",
    });
    // Instructions ride along (an edit form is a full editor); an empty
    // avatar_url is omitted so a null avatar preserves the current one.
    expect(request.instructions).toBe("Old instructions");
    expect(request.avatar_url).toBeUndefined();
  });

  it("maps a members scope to public_to grants", () => {
    const request = buildUpdateAgentRequest({
      draft: {
        ...draft(),
        permissionScope: "members",
        memberIds: new Set(["member-1"]),
        teamIds: new Set(["team-1"]),
      },
      runtimeId: "runtime-1",
    });

    expect(request.permission_mode).toBe("public_to");
    expect(request.invocation_targets).toEqual([
      { target_type: "member", target_id: "member-1" },
      { target_type: "team", target_id: "team-1" },
    ]);
  });

  it("omits access fields for a non-owner admin edit (owner-only writes)", () => {
    const request = buildUpdateAgentRequest({
      draft: { ...draft(), permissionScope: "workspace" },
      runtimeId: "runtime-1",
      includeAccess: false,
    });

    expect(request.permission_mode).toBeUndefined();
    expect(request.invocation_targets).toBeUndefined();
    expect(request.name).toBe("Old name");
  });
});
