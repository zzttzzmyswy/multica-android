import { describe, expect, it } from "vitest";
import {
  LARK_POLL_FLOOR_MS,
  byoFieldErrors,
  byoRequestBody,
  disconnectTarget,
  isByoSubmittable,
  larkInstallErrorKey,
  larkPollHttpErrorKey,
  larkPollIntervalMs,
  larkPollOutcome,
} from "./integration-bind";

// The decision logic behind the agent channel-bind screen (iteration 170).
// Everything here is pure so the Node-only vitest lane can pin it: the RN
// side only renders what these return.

describe("larkPollIntervalMs", () => {
  // The server suggests a cadence, but a server (or a stale session object)
  // that suggests something absurd must not turn into a hot loop against the
  // device-flow endpoint.
  it("clamps the server cadence to the 2s floor", () => {
    expect(larkPollIntervalMs(0)).toBe(LARK_POLL_FLOOR_MS);
    expect(larkPollIntervalMs(1)).toBe(LARK_POLL_FLOOR_MS);
    expect(larkPollIntervalMs(1.9)).toBe(LARK_POLL_FLOOR_MS);
    expect(larkPollIntervalMs(-5)).toBe(LARK_POLL_FLOOR_MS);
  });

  it("passes a sane cadence through, in ms", () => {
    expect(larkPollIntervalMs(2)).toBe(2000);
    expect(larkPollIntervalMs(5)).toBe(5000);
  });

  it("falls back to the floor for a missing or unusable value", () => {
    expect(larkPollIntervalMs(undefined)).toBe(LARK_POLL_FLOOR_MS);
    expect(larkPollIntervalMs(null)).toBe(LARK_POLL_FLOOR_MS);
    expect(larkPollIntervalMs(Number.NaN)).toBe(LARK_POLL_FLOOR_MS);
    expect(larkPollIntervalMs(Number.POSITIVE_INFINITY)).toBe(LARK_POLL_FLOOR_MS);
  });
});

describe("larkPollOutcome", () => {
  it("keeps polling while pending, and treats an unknown status as pending", () => {
    expect(larkPollOutcome("pending", undefined)).toEqual({ kind: "pending" });
    // A lifecycle value this build has never heard of must not strand the
    // user on a stale QR with no way forward.
    expect(larkPollOutcome("weird_new_state", undefined)).toEqual({ kind: "pending" });
    expect(larkPollOutcome(undefined, undefined)).toEqual({ kind: "pending" });
  });

  it("reports success", () => {
    expect(larkPollOutcome("success", undefined)).toEqual({ kind: "success" });
  });

  it("reports a terminal error keyed off error_reason, not error_message", () => {
    expect(larkPollOutcome("error", "expired")).toEqual({
      kind: "error",
      errorKey: "agents.integrations.larkErrorExpired",
    });
    expect(larkPollOutcome("error", "installation_conflict")).toEqual({
      kind: "error",
      errorKey: "agents.integrations.larkErrorConflict",
    });
  });

  it("falls back to the generic error when the server sends no reason", () => {
    expect(larkPollOutcome("error", undefined)).toEqual({
      kind: "error",
      errorKey: "agents.integrations.larkErrorGeneric",
    });
    expect(larkPollOutcome("error", "")).toEqual({
      kind: "error",
      errorKey: "agents.integrations.larkErrorGeneric",
    });
  });
});

describe("larkInstallErrorKey", () => {
  it("maps every reason the server documents to its own copy", () => {
    expect(larkInstallErrorKey("expired")).toBe("agents.integrations.larkErrorExpired");
    expect(larkInstallErrorKey("access_denied")).toBe(
      "agents.integrations.larkErrorAccessDenied",
    );
    expect(larkInstallErrorKey("lark_protocol_error")).toBe(
      "agents.integrations.larkErrorProtocol",
    );
    expect(larkInstallErrorKey("bot_info_failed")).toBe(
      "agents.integrations.larkErrorBotInfo",
    );
    expect(larkInstallErrorKey("installation_conflict")).toBe(
      "agents.integrations.larkErrorConflict",
    );
    expect(larkInstallErrorKey("installer_bind_failed")).toBe(
      "agents.integrations.larkErrorInstallerBind",
    );
    expect(larkInstallErrorKey("internal_error")).toBe(
      "agents.integrations.larkErrorGeneric",
    );
  });

  it("gives the two client-side session failures their own copy", () => {
    // Not server reasons — the client raises these when a poll itself fails
    // terminally (web's lark-tab.tsx:776-803).
    expect(larkInstallErrorKey("session_lost")).toBe(
      "agents.integrations.larkErrorSessionLost",
    );
    expect(larkInstallErrorKey("forbidden")).toBe("agents.integrations.larkErrorForbidden");
  });

  it("never returns a key for an unknown reason", () => {
    expect(larkInstallErrorKey("brand_new_reason")).toBe(
      "agents.integrations.larkErrorGeneric",
    );
    expect(larkInstallErrorKey(null)).toBe("agents.integrations.larkErrorGeneric");
    expect(larkInstallErrorKey(undefined)).toBe("agents.integrations.larkErrorGeneric");
  });
});

describe("larkPollHttpErrorKey", () => {
  // Terminal HTTP states must NOT be retried: polling forever would trap the
  // user on a stale QR with no error feedback.
  it("is terminal for a lost session or lost permission", () => {
    expect(larkPollHttpErrorKey(404)).toBe("agents.integrations.larkErrorSessionLost");
    expect(larkPollHttpErrorKey(403)).toBe("agents.integrations.larkErrorForbidden");
    expect(larkPollHttpErrorKey(401)).toBe("agents.integrations.larkErrorForbidden");
  });

  it("returns null (retry) for a transient failure", () => {
    expect(larkPollHttpErrorKey(500)).toBeNull();
    expect(larkPollHttpErrorKey(502)).toBeNull();
    expect(larkPollHttpErrorKey(503)).toBeNull();
    expect(larkPollHttpErrorKey(429)).toBeNull();
    expect(larkPollHttpErrorKey(0)).toBeNull();
  });
});

describe("byoFieldErrors", () => {
  it("requires both Slack tokens and their documented prefixes", () => {
    const errs = byoFieldErrors("slack", { bot_token: "", app_token: "" });
    expect(errs.bot_token).toBe("agents.integrations.byoRequired");
    expect(errs.app_token).toBe("agents.integrations.byoRequired");

    // The server rejects these with 400 (slack/byo_install.go:61,182), so
    // catching them here saves a round-trip and says which field is wrong.
    expect(
      byoFieldErrors("slack", { bot_token: "nope", app_token: "xapp-1-A1-2-3" }).bot_token,
    ).toBe("agents.integrations.byoSlackBotPrefix");
    expect(
      byoFieldErrors("slack", { bot_token: "xoxb-1", app_token: "nope" }).app_token,
    ).toBe("agents.integrations.byoSlackAppPrefix");
  });

  it("accepts a well-formed Slack pair", () => {
    expect(
      byoFieldErrors("slack", {
        bot_token: "xoxb-1234567890-abcdef",
        app_token: "xapp-1-A0BCXGVCS7R-123-abcdef",
      }),
    ).toEqual({});
  });

  it("treats a whitespace-only field as missing", () => {
    // Web trims before both validating and sending (slack-tab.tsx:329-330).
    expect(byoFieldErrors("slack", { bot_token: "   ", app_token: "  " })).toEqual({
      bot_token: "agents.integrations.byoRequired",
      app_token: "agents.integrations.byoRequired",
    });
  });

  it("requires DingTalk's AppKey and AppSecret", () => {
    const errs = byoFieldErrors("dingtalk", { client_id: "", client_secret: "" });
    expect(errs.client_id).toBe("agents.integrations.byoRequired");
    expect(errs.client_secret).toBe("agents.integrations.byoRequired");
    expect(
      byoFieldErrors("dingtalk", { client_id: "ding123", client_secret: "s3cret" }),
    ).toEqual({});
  });

  it("requires WeCom's bot id and secret but not its optional name", () => {
    const errs = byoFieldErrors("wecom", { bot_id: "", secret: "" });
    expect(errs.bot_id).toBe("agents.integrations.byoRequired");
    expect(errs.secret).toBe("agents.integrations.byoRequired");
    expect(byoFieldErrors("wecom", { bot_id: "bot", secret: "sec" })).toEqual({});
    expect(
      byoFieldErrors("wecom", { bot_id: "bot", secret: "sec", bot_name: "" }),
    ).toEqual({});
  });
});

describe("isByoSubmittable", () => {
  it("mirrors byoFieldErrors", () => {
    expect(isByoSubmittable("slack", { bot_token: "", app_token: "" })).toBe(false);
    expect(
      isByoSubmittable("slack", {
        bot_token: "xoxb-1",
        app_token: "xapp-1-A1-2-3",
      }),
    ).toBe(true);
    expect(isByoSubmittable("dingtalk", { client_id: "a", client_secret: "b" })).toBe(true);
    expect(isByoSubmittable("wecom", { bot_id: "a", secret: "" })).toBe(false);
  });
});

describe("byoRequestBody", () => {
  it("trims what the admin pasted", () => {
    expect(
      byoRequestBody("slack", {
        bot_token: "  xoxb-1  ",
        app_token: " xapp-1-A1-2-3 ",
      }),
    ).toEqual({ bot_token: "xoxb-1", app_token: "xapp-1-A1-2-3" });
  });

  it("omits WeCom's bot_name when blank rather than sending an empty string", () => {
    // Omitting keeps the name already stored on a re-install of the same bot
    // (wecom.ts:35-45); an empty string would clear it.
    expect(byoRequestBody("wecom", { bot_id: "b", secret: "s", bot_name: "   " })).toEqual({
      bot_id: "b",
      secret: "s",
    });
    expect(byoRequestBody("wecom", { bot_id: "b", secret: "s", bot_name: " Multica " })).toEqual({
      bot_id: "b",
      secret: "s",
      bot_name: "Multica",
    });
  });

  it("sends only the two fields DingTalk's wire shape carries", () => {
    expect(byoRequestBody("dingtalk", { client_id: " k ", client_secret: " v " })).toEqual({
      client_id: "k",
      client_secret: "v",
    });
  });
});

describe("disconnectTarget", () => {
  const installs = [
    { id: "a1", agent_id: "agent-1", status: "revoked" },
    { id: "a2", agent_id: "agent-1", status: "active" },
    { id: "b1", agent_id: "agent-2", status: "active" },
  ];

  it("picks this agent's live installation, ignoring other agents'", () => {
    expect(disconnectTarget(installs, "agent-1")?.id).toBe("a2");
    expect(disconnectTarget(installs, "agent-2")?.id).toBe("b1");
  });

  it("returns null when this agent has nothing live to disconnect", () => {
    // A revoked row is audit history, not a connection — offering to
    // disconnect it would be a no-op the user cannot explain.
    expect(disconnectTarget(installs, "agent-3")).toBeNull();
    expect(
      disconnectTarget([{ id: "r", agent_id: "agent-1", status: "revoked" }], "agent-1"),
    ).toBeNull();
  });

  it("returns null for a missing listing", () => {
    expect(disconnectTarget(undefined, "agent-1")).toBeNull();
    expect(disconnectTarget([], "agent-1")).toBeNull();
  });
});
