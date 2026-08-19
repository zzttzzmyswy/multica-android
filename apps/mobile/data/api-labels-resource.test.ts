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

const LABEL_ROW = {
  id: "l-1",
  workspace_id: "ws-1",
  resource_type: "skill",
  name: "custom",
  color: "#3b82f6",
  created_at: "2026-08-18T00:00:00Z",
  updated_at: "2026-08-18T00:00:00Z",
};

describe("resource-label api methods (iteration-60)", () => {
  it("listLabels keeps the legacy workspace URL when no resourceType", async () => {
    const spy = fetchSpy().mockResolvedValue({ labels: [LABEL_ROW], total: 1 });
    await api.listLabels();
    expect(spy).toHaveBeenCalledWith("/api/labels", expect.anything());
  });

  it("listLabels scopes the catalog by resource_type when requested", async () => {
    const spy = fetchSpy().mockResolvedValue({ labels: [LABEL_ROW], total: 1 });
    await api.listLabels({ resourceType: "skill" });
    expect(spy).toHaveBeenCalledWith(
      "/api/labels?resource_type=skill",
      expect.anything(),
    );
  });

  it("listLabelsForResource GETs the skill labels endpoint and unwraps labels", async () => {
    const spy = fetchSpy().mockResolvedValue({ labels: [LABEL_ROW] });
    const res = await api.listLabelsForResource("skill", "skill-1");
    expect(spy).toHaveBeenCalledWith("/api/skills/skill-1/labels", expect.anything());
    expect(res.labels).toHaveLength(1);
    expect(res.labels[0]).toMatchObject({ name: "custom", color: "#3b82f6" });
  });

  it("listLabelsForResource maps agent to the agents endpoint", async () => {
    const spy = fetchSpy().mockResolvedValue({ labels: [] });
    await api.listLabelsForResource("agent", "agent-1");
    expect(spy).toHaveBeenCalledWith("/api/agents/agent-1/labels", expect.anything());
  });

  it("listLabelsForResource degrades a drift response to an empty list", async () => {
    fetchSpy().mockResolvedValue({ not: "labels" });
    const res = await api.listLabelsForResource("skill", "skill-1");
    expect(res.labels).toEqual([]);
  });

  it("attachLabelToResource POSTs { label_id } to the skill labels endpoint", async () => {
    const spy = fetchSpy().mockResolvedValue({ labels: [LABEL_ROW] });
    await api.attachLabelToResource("skill", "skill-1", "l-1");
    expect(spy).toHaveBeenCalledWith("/api/skills/skill-1/labels", {
      method: "POST",
      body: JSON.stringify({ label_id: "l-1" }),
    });
  });

  it("detachLabelFromResource DELETEs the label junction", async () => {
    const spy = fetchSpy().mockResolvedValue({ labels: [] });
    await api.detachLabelFromResource("skill", "skill-1", "l-1");
    expect(spy).toHaveBeenCalledWith("/api/skills/skill-1/labels/l-1", {
      method: "DELETE",
    });
  });
});