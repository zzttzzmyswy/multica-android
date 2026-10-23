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
  UNREAD_BATCH_DELETE_RESULT,
  UNREAD_BATCH_UPDATE_RESULT,
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

  it("BatchUpdateResultSchema REJECTS a response without a count", () => {
    // Iteration 272: a missing `updated` is an unreadable count, not a zero
    // one. It must fall through to the `null` sentinel so no caller can read
    // "committed 0 of N" out of a response the server never shaped that way.
    expect(BatchUpdateResultSchema.safeParse({}).success).toBe(false);
  });

  it("BatchDeleteResultSchema parses {deleted: N}", () => {
    const res = BatchDeleteResultSchema.parse({ deleted: 2 });
    expect(res.deleted).toBe(2);
  });

  it("BatchDeleteResultSchema REJECTS a response without a count", () => {
    expect(BatchDeleteResultSchema.safeParse({}).success).toBe(false);
  });

  it("the unread sentinels are null, not 0", () => {
    expect(UNREAD_BATCH_UPDATE_RESULT.updated).toBeNull();
    expect(UNREAD_BATCH_DELETE_RESULT.deleted).toBeNull();
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

  it("batchUpdateIssues reports an unreadable count as null, never 0", async () => {
    // A malformed body used to hand back `{updated: 0}`, which the bar then
    // printed as a real "0 of 1 applied" verdict. `null` means "no count was
    // read", and the outcome layer makes no claim from it.
    fetchSpy().mockResolvedValue({ unexpected: true });
    const res = await api.batchUpdateIssues(["a"], { priority: "high" });
    expect(res.updated).toBeNull();
  });

  it("batchUpdateIssues keeps a committed 0 distinct from an unreadable count", async () => {
    fetchSpy().mockResolvedValue({ updated: 0 });
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

  it("batchDeleteIssues reports an unreadable count as null, never 0", async () => {
    fetchSpy().mockResolvedValue({ unexpected: true });
    const res = await api.batchDeleteIssues(["a"]);
    expect(res.deleted).toBeNull();
  });
});