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

const NODE = {
  id: "node-1",
  owner_id: "u-1",
  instance_id: "i-1",
  region: "ap-east-1",
  instance_type: "t4g.medium",
  image_id: "ami-1",
  subnet_id: "subnet-1",
  name: "cloud-dev-01",
  status: "running",
  tags: {},
  metadata: {},
  created_at: "2026-08-20T10:00:00Z",
  updated_at: "2026-08-20T10:00:00Z",
};

describe("cloud runtime node api methods (iteration-82)", () => {
  it("listCloudRuntimeNodes GETs /api/cloud-runtime/nodes with limit/offset", async () => {
    const spy = fetchSpy().mockResolvedValue([NODE]);
    const res = await api.listCloudRuntimeNodes({ limit: 20, offset: 0 });
    expect(spy).toHaveBeenCalledWith(
      "/api/cloud-runtime/nodes?limit=20&offset=0",
      expect.objectContaining({ signal: undefined }),
    );
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({
      id: "node-1",
      instance_type: "t4g.medium",
      status: "running",
    });
  });

  it("listCloudRuntimeNodes omits the query when params are omitted", async () => {
    const spy = fetchSpy().mockResolvedValue([]);
    await api.listCloudRuntimeNodes();
    expect(spy).toHaveBeenCalledWith(
      "/api/cloud-runtime/nodes",
      expect.objectContaining({ signal: undefined }),
    );
  });

  it("listCloudRuntimeNodes degrades a drift response to []", async () => {
    fetchSpy().mockResolvedValue({ not: "a list" });
    const res = await api.listCloudRuntimeNodes();
    expect(res).toEqual([]);
  });

  it("createCloudRuntimeNode POSTs the request body", async () => {
    const spy = fetchSpy().mockResolvedValue(NODE);
    const res = await api.createCloudRuntimeNode({
      instance_type: "t4g.medium",
      name: "cloud-dev-01",
      disk_size_gb: 20,
    });
    expect(spy).toHaveBeenCalledWith(
      "/api/cloud-runtime/nodes",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          instance_type: "t4g.medium",
          name: "cloud-dev-01",
          disk_size_gb: 20,
        }),
      }),
    );
    expect(res).toMatchObject({ id: "node-1", name: "cloud-dev-01" });
  });

  it("deleteCloudRuntimeNode DELETEs with the instance id in the body", async () => {
    const spy = fetchSpy().mockResolvedValue(undefined);
    await api.deleteCloudRuntimeNode("i-1");
    expect(spy).toHaveBeenCalledWith(
      "/api/cloud-runtime/nodes",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ instance_id: "i-1" }),
      }),
    );
  });
});