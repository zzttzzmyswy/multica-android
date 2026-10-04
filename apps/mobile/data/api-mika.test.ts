/**
 * createMikaAgent / startMikaOnboarding API tests (iteration 178).
 *
 * Both endpoints are drift-defended with `parseWithFallback`, and both
 * fallbacks are load-bearing:
 *   - a malformed bootstrap response must not look like a created session
 *     (the caller throws and retries instead of navigating to nowhere);
 *   - a malformed kickoff must report `started: false` rather than claiming
 *     the opening landed.
 * Also pins that `system_key` survives the bootstrap parse — the card's
 * "is this Mika" check reads it (lib/mika.ts), so a schema that dropped it
 * would silently break the entrypoint's own gating.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.EXPO_PUBLIC_API_URL = "https://api.test";

vi.mock("expo-file-system", () => ({
  File: class {
    uri = "file:///mock";
    exists = false;
  },
  Paths: { document: { uri: "file:///doc" } },
}));

vi.mock("expo-file-system/legacy", () => ({
  createDownloadResumable: vi.fn(),
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

type ApiClient = typeof import("./api").api;
let api: ApiClient;

const fetchSpy = () =>
  vi.spyOn(api as unknown as { fetch: () => Promise<unknown> }, "fetch");

beforeAll(async () => {
  ({ api } = await import("./api"));
});

beforeEach(() => {
  vi.restoreAllMocks();
});

const MIKA_ROW = {
  id: "agent-mika",
  workspace_id: "ws-1",
  name: "Mika",
  system_key: "mika",
  created_at: "2026-09-25T00:00:00Z",
  updated_at: "2026-09-25T00:00:00Z",
};

const SESSION_ROW = {
  id: "session-1",
  workspace_id: "ws-1",
  agent_id: "agent-mika",
  creator_id: "u1",
  title: "Getting started with Mika",
  status: "active",
  created_at: "2026-09-25T00:00:00Z",
  updated_at: "2026-09-25T00:00:00Z",
};

describe("createMikaAgent", () => {
  it("POSTs only the runtime, language, model and session title", async () => {
    const spy = fetchSpy().mockResolvedValue({
      ...MIKA_ROW,
      onboarding_session: SESSION_ROW,
    });

    await api.createMikaAgent(
      {
        runtime_id: "rt-1",
        language: "zh",
        model: "claude-sonnet-5",
        session_title: "和 Mika 开始",
      },
      "acme",
    );

    expect(spy).toHaveBeenCalledWith(
      "/api/agents/mika",
      expect.objectContaining({
        method: "POST",
        headers: { "X-Workspace-Slug": "acme" },
        body: JSON.stringify({
          runtime_id: "rt-1",
          language: "zh",
          model: "claude-sonnet-5",
          session_title: "和 Mika 开始",
        }),
      }),
    );
  });

  it("parses the returned agent and its onboarding session", async () => {
    fetchSpy().mockResolvedValue({
      ...MIKA_ROW,
      onboarding_session: SESSION_ROW,
    });
    const result = await api.createMikaAgent({
      runtime_id: "rt-1",
      language: "en",
    });
    expect(result.id).toBe("agent-mika");
    expect(result.onboarding_session?.id).toBe("session-1");
  });

  it("keeps system_key — the card's identity check reads it", async () => {
    // A schema that stripped this would make isMikaAgent() false forever and
    // the entrypoint would offer to create a second Mika on every visit.
    fetchSpy().mockResolvedValue({
      ...MIKA_ROW,
      onboarding_session: SESSION_ROW,
    });
    const result = await api.createMikaAgent({
      runtime_id: "rt-1",
      language: "en",
    });
    expect(result.system_key).toBe("mika");
  });

  it("drops a malformed onboarding session rather than fabricating one", async () => {
    // The caller treats "no session" as "retry". A response with a session
    // whose id is missing must not become a navigable session.
    fetchSpy().mockResolvedValue({
      ...MIKA_ROW,
      onboarding_session: { title: "no id here" },
    });
    const result = await api.createMikaAgent({
      runtime_id: "rt-1",
      language: "en",
    });
    // The whole response fails validation, so the fallback (no session) is
    // what the caller sees.
    expect(result.onboarding_session).toBeUndefined();
  });

  it("falls back to an agent with no session on a non-object body", async () => {
    fetchSpy().mockResolvedValue("nope");
    const result = await api.createMikaAgent({
      runtime_id: "rt-1",
      language: "en",
    });
    expect(result.onboarding_session).toBeUndefined();
  });

  it("omits the workspace header when no slug is given", async () => {
    const spy = fetchSpy().mockResolvedValue({ ...MIKA_ROW });
    await api.createMikaAgent({ runtime_id: "rt-1", language: "en" });
    const [, init] = spy.mock.calls[0] as unknown as [
      string,
      { headers?: unknown },
    ];
    expect(init.headers).toBeUndefined();
  });
});

describe("startMikaOnboarding", () => {
  it("POSTs the language to the session's onboarding endpoint", async () => {
    const spy = fetchSpy().mockResolvedValue({ started: true, message_id: "m1" });
    await api.startMikaOnboarding("session-1", { language: "zh" }, "acme");
    expect(spy).toHaveBeenCalledWith(
      "/api/chat/sessions/session-1/onboarding",
      expect.objectContaining({
        method: "POST",
        headers: { "X-Workspace-Slug": "acme" },
        body: JSON.stringify({ language: "zh" }),
      }),
    );
  });

  it("parses started plus the optional message id", async () => {
    fetchSpy().mockResolvedValue({
      started: true,
      message_id: "m1",
      created_at: "2026-09-25T00:00:00Z",
    });
    const result = await api.startMikaOnboarding("session-1", { language: "en" });
    expect(result).toEqual({
      started: true,
      message_id: "m1",
      created_at: "2026-09-25T00:00:00Z",
    });
  });

  it("reports started: false on a malformed response", async () => {
    // Claiming the opening landed would leave the member staring at an empty
    // conversation with no retry path.
    fetchSpy().mockResolvedValue({ ok: true });
    const result = await api.startMikaOnboarding("session-1", { language: "en" });
    expect(result.started).toBe(false);
  });

  it("passes through the idempotent started: false from the server", async () => {
    fetchSpy().mockResolvedValue({ started: false });
    const result = await api.startMikaOnboarding("session-1", { language: "en" });
    expect(result.started).toBe(false);
  });
});
