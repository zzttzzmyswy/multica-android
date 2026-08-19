import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Same stub chain as api-failures.test.ts — ApiClient pulls in native modules
// at module scope, so the Node vitest lane stubs them and sets the API URL
// before the (dynamically imported) module evaluates.
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

const QUICK_ACTION_ROW = {
  id: "qa-1",
  workspace_id: "ws-1",
  name: "Summarise",
  description: "",
  assignee_type: "agent",
  assignee_id: "agent-1",
  prompt: "Summarise this issue",
  visibility: "public",
  status: "active",
  last_used_at: null,
  use_count: 0,
  created_by_id: "user-1",
  created_at: "2026-08-17T00:00:00Z",
  updated_at: "2026-08-17T00:00:00Z",
  target_public: true,
  target_missing: false,
};

describe("quick-actions api methods", () => {
  it("listQuickActions GETs /api/quick-actions and unwraps the envelope", async () => {
    const spy = fetchSpy().mockResolvedValue({ quick_actions: [QUICK_ACTION_ROW] });
    const res = await api.listQuickActions();
    expect(spy).toHaveBeenCalledWith("/api/quick-actions");
    expect(res.quick_actions).toHaveLength(1);
    expect(res.quick_actions[0]).toMatchObject({ name: "Summarise" });
  });

  it("listQuickActions appends includeArchived when requested", async () => {
    const spy = fetchSpy().mockResolvedValue({ quick_actions: [] });
    await api.listQuickActions({ includeArchived: true });
    expect(spy).toHaveBeenCalledWith("/api/quick-actions?include_archived=true");
  });

  it("createQuickAction POSTs the request body", async () => {
    const spy = fetchSpy().mockResolvedValue(QUICK_ACTION_ROW);
    const res = await api.createQuickAction({
      name: "Summarise",
      assignee_type: "agent",
      assignee_id: "agent-1",
      prompt: "Summarise this issue",
      visibility: "public",
    });
    expect(spy).toHaveBeenCalledWith(
      "/api/quick-actions",
      expect.objectContaining({ method: "POST" }),
    );
    expect(res.id).toBe("qa-1");
  });

  it("updateQuickAction PATCHes the id route", async () => {
    const spy = fetchSpy().mockResolvedValue({ ...QUICK_ACTION_ROW, name: "Renamed" });
    const res = await api.updateQuickAction("qa-1", { name: "Renamed" });
    expect(spy).toHaveBeenCalledWith(
      "/api/quick-actions/qa-1",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(res.name).toBe("Renamed");
  });

  it("deleteQuickAction DELETEs the id route", async () => {
    const spy = fetchSpy().mockResolvedValue(undefined);
    await api.deleteQuickAction("qa-1");
    expect(spy).toHaveBeenCalledWith("/api/quick-actions/qa-1", {
      method: "DELETE",
    });
  });
});

describe("github api methods", () => {
  it("listGitHubInstallations GETs the workspace installations route", async () => {
    const spy = fetchSpy().mockResolvedValue({
      installations: [
        {
          id: "inst-1",
          workspace_id: "ws-1",
          installation_id: 123,
          account_login: "multica-ai",
          account_type: "Organization",
          account_avatar_url: null,
          created_at: "2026-08-17T00:00:00Z",
        },
      ],
      configured: true,
      repository_browse_configured: true,
      can_manage: true,
    });
    const res = await api.listGitHubInstallations("ws-1");
    expect(spy).toHaveBeenCalledWith("/api/workspaces/ws-1/github/installations");
    expect(res.installations).toHaveLength(1);
    expect(res.installations[0].account_login).toBe("multica-ai");
    expect(res.configured).toBe(true);
  });

  it("listGitHubInstallationRepositories appends page params", async () => {
    const spy = fetchSpy().mockResolvedValue({
      repositories: [],
      total_count: 0,
      next_page: null,
    });
    await api.listGitHubInstallationRepositories("ws-1", "inst-1", {
      page: 2,
      per_page: 100,
    });
    expect(spy).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/github/installations/inst-1/repositories?page=2&per_page=100",
      expect.objectContaining({ signal: undefined }),
    );
  });

  it("getGitHubConnectURL forwards return_to", async () => {
    const spy = fetchSpy().mockResolvedValue({
      url: "https://github.com/apps/x/installations/new",
      configured: true,
    });
    const res = await api.getGitHubConnectURL("ws-1", "repositories");
    expect(spy).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/github/connect?return_to=repositories",
    );
    expect(res.url).toContain("github.com");
  });
});