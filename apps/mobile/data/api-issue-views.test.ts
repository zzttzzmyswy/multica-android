import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ApiClient pulls in native modules at module scope; the Node vitest lane
// stubs them so the import chain resolves (same pattern as
// api-subscription.test.ts). The env var satisfies api.ts's load-time guard.
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

describe("saved issue view api methods (iteration-65)", () => {
  const VIEW = {
    id: "view-1",
    workspace_id: "ws-1",
    owner_id: "user-1",
    name: "Backlog",
    scope_type: "workspace",
    scope_id: null,
    scope_variant: "all",
    visibility: "private",
    definition_version: 1,
    query: { statusFilters: ["todo", "in_progress"] },
    display: { viewMode: "board" },
    revision: 1,
    created_at: "2026-08-18T00:00:00Z",
    updated_at: "2026-08-18T00:00:00Z",
  };

  it("listIssueViews GETs /api/issue-views with scope_type + scope_id", async () => {
    const spy = fetchSpy().mockResolvedValue([VIEW]);
    const res = await api.listIssueViews({ scope_type: "workspace" });
    expect(spy).toHaveBeenCalledWith("/api/issue-views?scope_type=workspace");
    expect(res).toHaveLength(1);
    expect(res[0].name).toBe("Backlog");
  });

  it("listIssueViews omits scope_id when null and defaults bad payloads to []", async () => {
    const spy = fetchSpy().mockResolvedValue({ not: "an array" });
    const res = await api.listIssueViews({ scope_type: "my", scope_id: null });
    expect(spy).toHaveBeenCalledWith("/api/issue-views?scope_type=my");
    expect(res).toEqual([]);
  });

  it("createIssueView POSTs the CreateIssueViewRequest body", async () => {
    const spy = fetchSpy().mockResolvedValue(VIEW);
    const body = {
      name: "Backlog",
      scope_type: "workspace" as const,
      scope_id: null,
      scope_variant: null,
      visibility: "private" as const,
      definition_version: 1,
      query: { statusFilters: ["todo"] },
      display: { viewMode: "list" },
    };
    await api.createIssueView(body);
    expect(spy).toHaveBeenCalledWith(
      "/api/issue-views",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
  });

  it("createIssueView returns null on unparsable success body (not a crash)", async () => {
    fetchSpy().mockResolvedValue({ bizarre: true });
    const res = await api.createIssueView({
      name: "x",
      scope_type: "workspace",
      scope_id: null,
      scope_variant: null,
      visibility: "private",
      definition_version: 1,
      query: {},
      display: {},
    });
    expect(res).toBeNull();
  });

  it("updateIssueView PATCHes /api/issue-views/:id with expected_revision", async () => {
    const spy = fetchSpy().mockResolvedValue({ ...VIEW, name: "Renamed" });
    const res = await api.updateIssueView("view-1", {
      name: "Renamed",
      expected_revision: 1,
    });
    expect(spy).toHaveBeenCalledWith(
      "/api/issue-views/view-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ name: "Renamed", expected_revision: 1 }),
      }),
    );
    expect(res?.name).toBe("Renamed");
  });

  it("getIssueView GETs one view by id", async () => {
    const spy = fetchSpy().mockResolvedValue(VIEW);
    const res = await api.getIssueView("view-1");
    expect(spy).toHaveBeenCalledWith("/api/issue-views/view-1");
    expect(res?.id).toBe("view-1");
  });

  it("deleteIssueView DELETEs /api/issue-views/:id", async () => {
    const spy = fetchSpy().mockResolvedValue(undefined);
    await api.deleteIssueView("view-1");
    expect(spy).toHaveBeenCalledWith(
      "/api/issue-views/view-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("getIssueViewPreference GETs /api/issue-view-preferences and falls back to EMPTY", async () => {
    const spy = fetchSpy().mockResolvedValue({
      scope_type: "workspace",
      scope_id: null,
      prefs: { hidden: ["view-2"], order: [] },
      updated_at: "2026-08-18T00:00:00Z",
    });
    const res = await api.getIssueViewPreference({ scope_type: "workspace" });
    expect(spy).toHaveBeenCalledWith("/api/issue-view-preferences?scope_type=workspace");
    expect(res.prefs.hidden).toEqual(["view-2"]);

    fetchSpy().mockResolvedValue(undefined);
    const empty = await api.getIssueViewPreference({ scope_type: "my" });
    expect(empty.prefs).toEqual({ hidden: [], order: [] });
  });

  it("putIssueViewPreference PUTs the pref body", async () => {
    const spy = fetchSpy().mockResolvedValue(undefined);
    await api.putIssueViewPreference({
      scope_type: "my",
      scope_id: null,
      prefs: { hidden: [], order: ["view-3"] },
    });
    expect(spy).toHaveBeenCalledWith(
      "/api/issue-view-preferences",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          scope_type: "my",
          scope_id: null,
          prefs: { hidden: [], order: ["view-3"] },
        }),
      }),
    );
  });
});