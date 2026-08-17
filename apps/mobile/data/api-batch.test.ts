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

import {
  BatchDeleteResultSchema,
  BatchUpdateResultSchema,
} from "./schemas";

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

describe("batch result schemas", () => {
  it("BatchUpdateResultSchema parses {updated: N}", () => {
    const res = BatchUpdateResultSchema.parse({ updated: 3 });
    expect(res.updated).toBe(3);
  });

  it("BatchUpdateResultSchema defaults updated to 0 when missing", () => {
    const res = BatchUpdateResultSchema.parse({});
    expect(res.updated).toBe(0);
  });

  it("BatchDeleteResultSchema parses {deleted: N}", () => {
    const res = BatchDeleteResultSchema.parse({ deleted: 2 });
    expect(res.deleted).toBe(2);
  });

  it("BatchDeleteResultSchema defaults deleted to 0 when missing", () => {
    const res = BatchDeleteResultSchema.parse({});
    expect(res.deleted).toBe(0);
  });
});

describe("batch issue api methods", () => {
  it("batchUpdateIssues POSTs to /api/issues/batch-update with issue_ids + updates", async () => {
    const spy = fetchSpy().mockResolvedValue({ updated: 2 });
    const res = await api.batchUpdateIssues(["a", "b"], { status: "done" });
    expect(spy).toHaveBeenCalledWith(
      "/api/issues/batch-update",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          issue_ids: ["a", "b"],
          updates: { status: "done" },
        }),
      }),
    );
    expect(res.updated).toBe(2);
  });

  it("batchUpdateIssues falls back to {updated: 0} on a malformed response", async () => {
    fetchSpy().mockResolvedValue({ unexpected: true });
    const res = await api.batchUpdateIssues(["a"], { priority: "high" });
    expect(res.updated).toBe(0);
  });

  it("batchDeleteIssues POSTs to /api/issues/batch-delete with issue_ids", async () => {
    const spy = fetchSpy().mockResolvedValue({ deleted: 2 });
    const res = await api.batchDeleteIssues(["a", "b"]);
    expect(spy).toHaveBeenCalledWith(
      "/api/issues/batch-delete",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ issue_ids: ["a", "b"] }),
      }),
    );
    expect(res.deleted).toBe(2);
  });

  it("batchDeleteIssues falls back to {deleted: 0} on a malformed response", async () => {
    fetchSpy().mockResolvedValue({ unexpected: true });
    const res = await api.batchDeleteIssues(["a"]);
    expect(res.deleted).toBe(0);
  });
});