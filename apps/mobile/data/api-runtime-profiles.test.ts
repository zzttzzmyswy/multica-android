import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Same stub chain as api-runtime.test.ts — ApiClient pulls in native modules
// at module scope, so the Node vitest lane stubs them and sets the API URL
// before the (dynamically imported) module evaluates.
process.env.EXPO_PUBLIC_API_URL = "https://api.test";

vi.mock("expo-file-system", () => ({
  File: class {
    uri = "file:///mock";
    exists = false;
  },
  Paths: {
    document: { uri: "file:///doc" },
    cache: { uri: "file:///cache" },
  },
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

const PROFILE = {
  id: "prof-1",
  workspace_id: "ws-1",
  display_name: "Team Codex",
  protocol_family: "codex",
  command_name: "codex",
  description: null,
  fixed_args: [],
  visibility: "workspace",
  created_by: "u-1",
  enabled: true,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
};

describe("runtime profile api methods (iteration-82, A2.3)", () => {
  it("listRuntimeProfiles GETs the workspace route and unwraps runtime_profiles", async () => {
    const spy = fetchSpy().mockResolvedValue({ runtime_profiles: [PROFILE] });
    const res = await api.listRuntimeProfiles("ws-1");
    expect(spy).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/runtime-profiles",
      expect.objectContaining({ signal: undefined }),
    );
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ display_name: "Team Codex", enabled: true });
  });

  it("listRuntimeProfiles degrades a drift response to []", async () => {
    fetchSpy().mockResolvedValue({ not: "a list" });
    const res = await api.listRuntimeProfiles("ws-1");
    expect(res).toEqual([]);
  });

  it("createRuntimeProfile POSTs the request body", async () => {
    const spy = fetchSpy().mockResolvedValue(PROFILE);
    const res = await api.createRuntimeProfile("ws-1", {
      display_name: "Team Codex",
      protocol_family: "codex",
      command_name: "codex",
    });
    expect(spy).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/runtime-profiles",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          display_name: "Team Codex",
          protocol_family: "codex",
          command_name: "codex",
        }),
      }),
    );
    expect(res).toMatchObject({ id: "prof-1" });
  });

  it("updateRuntimeProfile PATCHes the profile", async () => {
    const spy = fetchSpy().mockResolvedValue({ ...PROFILE, enabled: false });
    await api.updateRuntimeProfile("ws-1", "prof-1", {
      display_name: "Team Codex",
      enabled: false,
    });
    expect(spy).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/runtime-profiles/prof-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ display_name: "Team Codex", enabled: false }),
      }),
    );
  });

  it("deleteRuntimeProfile DELETEs the profile", async () => {
    const spy = fetchSpy().mockResolvedValue(undefined);
    await api.deleteRuntimeProfile("ws-1", "prof-1");
    expect(spy).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/runtime-profiles/prof-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});