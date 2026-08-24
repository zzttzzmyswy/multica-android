import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Same stub chain as api-runtime-profiles.test.ts — ApiClient pulls in native
// modules at module scope, so the Node vitest lane stubs them and sets the
// API URL before the (dynamically imported) module evaluates.
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

type ApiClientInstance = typeof import("./api").api;
let api: ApiClientInstance;

const fetchSpy = () =>
  vi.spyOn(
    api as unknown as {
      fetch: (path: string, init?: RequestInit) => Promise<unknown>;
    },
    "fetch",
  );

beforeAll(async () => {
  ({ api } = await import("./api"));
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("api.createFeedback (iteration-100)", () => {
  it("POSTs /api/feedback with the aligned request body", async () => {
    const spy = fetchSpy().mockResolvedValue({
      id: "fb-1",
      created_at: "2026-08-24T12:00:00Z",
    });
    const res = await api.createFeedback({
      message: "希望支持深色主题下的表格对比度",
      url: "https://mu.zztweb.top/x/inbox",
      workspace_id: "ws-1",
      kind: "feature",
    });
    expect(spy).toHaveBeenCalledWith(
      "/api/feedback",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          message: "希望支持深色主题下的表格对比度",
          url: "https://mu.zztweb.top/x/inbox",
          workspace_id: "ws-1",
          kind: "feature",
        }),
      }),
    );
    expect(res).toEqual({ id: "fb-1", created_at: "2026-08-24T12:00:00Z" });
  });

  it("serializes an omitted kind/url/workspace as absent keys", async () => {
    const spy = fetchSpy().mockResolvedValue({
      id: "fb-1",
      created_at: "2026-08-24T12:00:00Z",
    });
    await api.createFeedback({ message: "仅文本" });
    const body = JSON.parse(spy.mock.calls[0][1]!.body as string);
    expect(body).toEqual({ message: "仅文本" });
    expect("kind" in body).toBe(false);
  });

  it("is lenient — a body missing created_at still resolves (default \"\")", async () => {
    fetchSpy().mockResolvedValue({ id: "fb-1" });
    const res = await api.createFeedback({ message: "hi" });
    expect(res).toEqual({ id: "fb-1", created_at: "" });
  });

  it("degrades an unparsable response body to the empty fallback", async () => {
    fetchSpy().mockResolvedValue({ id: 123, created_at: null });
    const res = await api.createFeedback({ message: "hi" });
    expect(res).toEqual({ id: "", created_at: "" });
  });

  it("propagates a server rejection (429 rate limit) as an ApiError", async () => {
    const ApiErrorMod = await import("./api");
    fetchSpy().mockRejectedValue(
      new ApiErrorMod.ApiError(
        "too many feedback submissions, please try again later",
        429,
        undefined,
      ),
    );
    await expect(
      api.createFeedback({ message: "hi" }),
    ).rejects.toMatchObject({ status: 429 });
  });
});
