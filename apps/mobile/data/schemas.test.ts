import { describe, expect, it } from "vitest";
import { AppConfigSchema, ChatLastMessageSchema, ChatMessageSchema } from "@/data/schemas";
import { commentDeleteKeepsReplies } from "@/lib/comment-deletion";

/**
 * Chat message-kind parsing (iteration 174).
 *
 * The regression this pins is the same shape as `pin-schema.test.ts`: an enum
 * narrower than the server's vocabulary, plus a `.catch()` that rewrites the
 * unknown value instead of preserving it. `message_kind` listed only
 * `message` / `no_response`, so the server's `onboarding_opening` parsed as an
 * ordinary reply. `chat-message-list.tsx` keys the starter cards off that
 * exact string, so the branch could never run on a device — the opening
 * rendered with no cards at all, which is the blank first screen the cards
 * exist to prevent.
 *
 * The server's vocabulary is `normalizeMessageKind`
 * (server/internal/handler/chat.go): message, no_response, onboarding_kickoff,
 * onboarding_opening.
 */
const messageBase = {
  id: "msg-1",
  chat_session_id: "session-1",
  role: "assistant",
  content: "Welcome to the workspace.",
  task_id: null,
  created_at: "2026-09-22T00:00:00Z",
};

describe("ChatMessageSchema message_kind", () => {
  it("keeps an onboarding opening an onboarding opening", () => {
    const parsed = ChatMessageSchema.parse({
      ...messageBase,
      message_kind: "onboarding_opening",
      quick_actions: [],
    });
    expect(parsed.message_kind).toBe("onboarding_opening");
  });

  it("keeps the hidden kickoff kind rather than promoting it to a reply", () => {
    const parsed = ChatMessageSchema.parse({
      ...messageBase,
      message_kind: "onboarding_kickoff",
    });
    expect(parsed.message_kind).toBe("onboarding_kickoff");
  });

  it("keeps the two long-standing kinds unchanged", () => {
    for (const kind of ["message", "no_response"] as const) {
      expect(
        ChatMessageSchema.parse({ ...messageBase, message_kind: kind })
          .message_kind,
      ).toBe(kind);
    }
  });

  it("still degrades a genuinely unknown kind to message", () => {
    // Enum drift defense (root CLAUDE.md): a kind a future server invents must
    // render as an ordinary reply, not crash the list.
    expect(
      ChatMessageSchema.parse({ ...messageBase, message_kind: "telepathy" })
        .message_kind,
    ).toBe("message");
  });

  it("accepts a message with no kind at all", () => {
    expect(ChatMessageSchema.parse(messageBase).message_kind).toBeUndefined();
  });
});

describe("ChatLastMessageSchema message_kind", () => {
  // The session-list preview and the message row read the same server
  // vocabulary; they drifted apart once and this holds them together.
  it("accepts every kind the message row accepts", () => {
    for (const kind of [
      "message",
      "no_response",
      "onboarding_kickoff",
      "onboarding_opening",
    ] as const) {
      expect(
        ChatLastMessageSchema.parse({ content: "hi", message_kind: kind })
          .message_kind,
      ).toBe(kind);
    }
  });
});

describe("AppConfigSchema comment-delete capability (iteration 210)", () => {
  // A real /api/config body from the deployment this client talks to
  // (https://muapi.zztweb.top/api/config), field for field. The capability
  // ends up in AppConfigResponse and is read by lib/comment-deletion.ts; a
  // schema that silently dropped it would leave the delete promising the
  // pre-#8296 cascade on a server that keeps replies.
  const liveConfig = {
    cdn_domain: "",
    allow_signup: false,
    daemon_server_url: "https://muapi.zztweb.top",
    daemon_app_url: "https://mu.zztweb.top",
    vcs_integration_available: true,
    posthog_key: "",
    posthog_host: "",
    analytics_environment: "production",
    feature_flags: {
      agents_agent_builder: true,
      agents_skill_toggles: true,
      billing_workspace_subscriptions: false,
      composio_mcp_apps: false,
      plugins_v1: false,
      settings_resource_labels: true,
    },
    local_worktree_supported: true,
    agent_conversation_starters_supported: true,
    issue_create_properties_supported: true,
    comment_delete_keep_replies_supported: true,
    server_version: "v0.6.1",
  };

  it("keeps the capability when the deployment declares it", () => {
    const parsed = AppConfigSchema.parse(liveConfig);
    expect(parsed.comment_delete_keep_replies_supported).toBe(true);
    expect(commentDeleteKeepsReplies(parsed)).toBe(true);
  });

  it("defaults to false when an older server omits it", () => {
    const { comment_delete_keep_replies_supported: _omitted, ...older } =
      liveConfig;
    const parsed = AppConfigSchema.parse(older);
    expect(parsed.comment_delete_keep_replies_supported).toBe(false);
    expect(commentDeleteKeepsReplies(parsed)).toBe(false);
  });
});
