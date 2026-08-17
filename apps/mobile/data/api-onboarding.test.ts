/**
 * createWorkspace + markOnboardingComplete API tests (MYS-371).
 *
 * createWorkspace follows the write-endpoint rule used by the adjacent
 * workspace writes (updateWorkspace/leaveWorkspace/deleteWorkspace): raw
 * fetch, no parseWithFallback — a malformed response surfaces naturally so
 * the caller's error path owns the feedback. markOnboardingComplete mirrors
 * web client.ts:692 and parses the returned User through UserSchema.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Same stub chain as api-invitations.test.ts — ApiClient pulls native
// modules in at module scope; the Node vitest lane stubs them so the
// import chain resolves. `api` is brought in via dynamic import because
// static ESM imports are hoisted.
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

const WORKSPACE_ROW = {
  id: "ws-1",
  name: "Acme",
  slug: "acme",
  description: null,
  context: null,
  settings: {},
  repos: [],
  issue_prefix: "ACME",
  avatar_url: null,
  created_at: "2026-08-17T00:00:00Z",
  updated_at: "2026-08-17T00:00:00Z",
};

const USER_ROW = {
  id: "u1",
  name: "Ada",
  email: "ada@example.com",
  avatar_url: null,
  onboarded_at: null,
  onboarding_questionnaire: {},
  starter_content_state: null,
  language: null,
  profile_description: "",
  timezone: null,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
};

describe("createWorkspace", () => {
  it("POSTs /api/workspaces with name/slug/description and returns the workspace", async () => {
    const spy = fetchSpy().mockResolvedValue(WORKSPACE_ROW);
    const res = await api.createWorkspace({
      name: "Acme",
      slug: "acme",
      description: "Acme corp",
    });
    expect(spy).toHaveBeenCalledWith(
      "/api/workspaces",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "Acme",
          slug: "acme",
          description: "Acme corp",
        }),
      }),
    );
    expect(res).toMatchObject({ id: "ws-1", slug: "acme", name: "Acme" });
  });

  it("omits description when absent", async () => {
    const spy = fetchSpy().mockResolvedValue(WORKSPACE_ROW);
    await api.createWorkspace({ name: "Acme", slug: "acme" });
    expect(spy).toHaveBeenCalledWith(
      "/api/workspaces",
      expect.objectContaining({
        body: JSON.stringify({ name: "Acme", slug: "acme" }),
      }),
    );
  });

  it("surfaces server errors instead of swallowing into a fallback (write-endpoint rule)", async () => {
    fetchSpy().mockRejectedValue(
      Object.assign(new Error("workspace slug already exists"), { status: 409 }),
    );
    await expect(
      api.createWorkspace({ name: "Acme", slug: "taken" }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("markOnboardingComplete", () => {
  it("POSTs /api/me/onboarding/complete with completion_path and workspace_id and parses the user", async () => {
    const spy = fetchSpy().mockResolvedValue({
      ...USER_ROW,
      onboarded_at: "2026-08-17T00:00:00Z",
    });
    const res = await api.markOnboardingComplete({
      completion_path: "mobile_onboarding",
      workspace_id: "ws-1",
    });
    expect(spy).toHaveBeenCalledWith(
      "/api/me/onboarding/complete",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          completion_path: "mobile_onboarding",
          workspace_id: "ws-1",
        }),
      }),
    );
    expect(res.id).toBe("u1");
    expect(res.onboarded_at).toBe("2026-08-17T00:00:00Z");
  });

  it("sends no body when called without a payload", async () => {
    const spy = fetchSpy().mockResolvedValue(USER_ROW);
    await api.markOnboardingComplete();
    expect(spy).toHaveBeenCalledWith(
      "/api/me/onboarding/complete",
      expect.objectContaining({
        method: "POST",
        body: undefined,
      }),
    );
  });

  it("degrades a drift response to EMPTY_USER", async () => {
    fetchSpy().mockResolvedValue(null);
    const res = await api.markOnboardingComplete({ completion_path: "mobile_onboarding" });
    expect(res.id).toBe("");
  });
});