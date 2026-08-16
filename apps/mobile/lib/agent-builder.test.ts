import { describe, expect, it } from "vitest";
import type { AgentDraft } from "@multica/core/agents";
import {
  buildBuilderCreateRequest,
  builderDisplayContent,
  builderDraftPreview,
  builderDraftTitle,
  encodeBuilderTurn,
  latestDraftPayload,
  mergeDraftFromAssistant,
} from "./agent-builder";

const draft = (): AgentDraft => ({
  name: "Release manager",
  description: "Owns releases",
  instructions: "Tag + ship",
  avatarUrl: null,
  runtimeId: "runtime-1",
  model: "gpt-5.5",
  thinkingLevel: "",
  serviceTier: "",
  skillIds: new Set(["skill-1"]),
  permissionScope: "private",
  memberIds: new Set(),
  teamIds: new Set(),
});

const context = {
  draft: draft(),
  skills: [
    { id: "skill-1", name: "Release", description: "Ship builds" },
    { id: "skill-2", name: "Notifier", description: "Post updates" },
  ],
  members: [
    { user_id: "member-1", name: "Ada" },
    { user_id: "member-2", name: "Alan" },
  ],
  runtime: { id: "runtime-1", name: "Codex", provider: "codex" },
};

describe("agent builder pure helpers", () => {
  it("encodes a turn with the full decision context", () => {
    const encoded = encodeBuilderTurn("Make it a workspace agent", context);
    const payload = JSON.parse(encoded.slice(encoded.indexOf("\n") + 1));

    expect(payload.user_request).toBe("Make it a workspace agent");
    expect(payload.current_draft).toMatchObject({
      name: "Release manager",
      skill_ids: ["skill-1"],
    });
    expect(payload.selected_runtime).toEqual({
      id: "runtime-1",
      name: "Codex",
      provider: "codex",
    });
    expect(payload.available_workspace_skills).toHaveLength(2);
    expect(payload.available_workspace_members).toHaveLength(2);
    // Mobile never runs live model discovery: the builder may preserve the
    // user's model, never invent one.
    expect(payload.available_runtime_models).toBeNull();
  });

  it("round-trips display content per role", () => {
    const encoded = encodeBuilderTurn("Hi", context);
    expect(builderDisplayContent("user", encoded)).toBe("Hi");
    const reply =
      'Here is a first draft.\n<agent_draft>{"name":"Researcher"}</agent_draft>';
    expect(builderDisplayContent("assistant", reply)).toBe(
      "Here is a first draft.",
    );
    expect(builderDisplayContent("user", "ordinary text")).toBe("ordinary text");
  });

  it("merges an assistant draft, filtering ids to the workspace catalog", () => {
    const next = mergeDraftFromAssistant(
      draft(),
      {
        name: "Researcher",
        description: "Deep dives",
        permission_scope: "members",
        skill_ids: ["skill-2", "skill-unknown"],
        member_ids: ["member-1", "nobody-here"],
      },
      {
        skills: new Set(["skill-1", "skill-2"]),
        members: new Set(["member-1", "member-2"]),
      },
    );

    expect(next.name).toBe("Researcher");
    expect(next.permissionScope).toBe("members");
    expect([...next.skillIds]).toEqual(["skill-2"]);
    expect([...next.memberIds]).toEqual(["member-1"]);
  });

  it("builds the create request with template agent_builder", () => {
    const request = buildBuilderCreateRequest({
      draft: draft(),
      runtimeId: "runtime-1",
    });

    expect(request).toMatchObject({
      name: "Release manager",
      runtime_id: "runtime-1",
      model: "gpt-5.5",
      skill_ids: ["skill-1"],
      template: "agent_builder",
    });
    expect(request.permission_mode).toBe("private");
  });

  it("picks the newest assistant message that carries a parseable draft", () => {
    const messages = [
      { id: "m1", role: "user", content: "hi" },
      {
        id: "m2",
        role: "assistant",
        content: 'plain\n<agent_draft>not json</agent_draft>',
      },
      {
        id: "m3",
        role: "assistant",
        content: '<agent_draft>{"name":"First"}</agent_draft>',
      },
      {
        id: "m4",
        role: "assistant",
        content: '<agent_draft>{"name":"Second"}</agent_draft>',
      },
    ];

    const ref = latestDraftPayload(messages);
    expect(ref?.messageId).toBe("m4");
    expect(ref?.payload).toEqual({ name: "Second" });
    expect(latestDraftPayload([messages[0], messages[1]])).toBeNull();
  });

  it("trusts only catalog ids when the model catalog is unknown", () => {
    // A foreign id must not reach the draft — the builder cannot introduce
    // a model the runtime never advertised.
    const next = mergeDraftFromAssistant(
      { ...draft(), model: "gpt-5.5" },
      { model: "claude-some-invented-model" },
      { skills: new Set(), members: new Set() },
    );
    expect(next.model).toBe("gpt-5.5");
    // With the catalog unavailable even the empty-string "clear" signal is not
    // trusted — core only honours it when discovery succeeded (validModelIds
    // non-null and non-empty). The user clears the field by hand if they want
    // the runtime default back.
    const cleared = mergeDraftFromAssistant(
      { ...draft(), model: "gpt-5.5" },
      { model: "" },
      { skills: new Set(), members: new Set() },
    );
    expect(cleared.model).toBe("gpt-5.5");
  });

  it("extracts a draft row title and preview for the drafts list", () => {
    const encoded = encodeBuilderTurn("Make it ghost mode", context);
    const stored = (name: string) => ({
      name,
      description: "",
      instructions: "",
      avatar_url: null,
      model: "",
      thinking_level: "",
      service_tier: "",
      skill_ids: [],
      permission_scope: "private" as const,
      member_ids: [],
      team_ids: [],
      applied_message_id: null,
    });

    expect(
      builderDraftTitle({
        draft: stored("  Ghost  "),
        last_message_role: "user",
        last_message_content: encoded,
      }),
    ).toBe("Ghost");
    expect(
      builderDraftTitle({ draft: null, last_message_role: "", last_message_content: "" }),
    ).toBe("");
    expect(
      builderDraftPreview({
        last_message_role: "user",
        last_message_content: encoded,
        draft: null,
      }),
    ).toBe("Make it ghost mode");
    expect(
      builderDraftPreview({
        last_message_role: "assistant",
        last_message_content:
          'Here it is.\n<agent_draft>{"name":"Ghost"}</agent_draft>',
        draft: null,
      }),
    ).toBe("Here it is.");
    expect(
      builderDraftPreview({
        last_message_role: "assistant",
        last_message_content: "",
        draft: null,
      }),
    ).toBe("");
  });
});