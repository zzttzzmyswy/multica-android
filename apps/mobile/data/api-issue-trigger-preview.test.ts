import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Same ApiClient test harness as api-comment-trigger-preview.test.ts: stub the
// native modules the module-scope import pulls in, then spy on the private
// fetch. The point of this file is the REQUEST SHAPE — the create form's caption
// is only as truthful as the body it asks with, and web's `previewIssueTrigger`
// omits every nil field rather than sending `null` (a nil prospective field
// means "leave unchanged" to the server, so `status: null` would silently mean
// something other than "no opinion").
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

describe("issue trigger preview api (iter 229)", () => {
  it("previews the create form's prospective write", async () => {
    const spy = fetchSpy().mockResolvedValue({
      triggers: [],
      total_count: 0,
    });
    await api.previewIssueTrigger({
      isCreate: true,
      assigneeType: "agent",
      assigneeId: "a-1",
      status: "todo",
    });
    expect(spy).toHaveBeenCalledWith(
      "/api/issues/preview-trigger",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          is_create: true,
          assignee_type: "agent",
          assignee_id: "a-1",
          status: "todo",
        }),
      }),
    );
  });

  it("omits every nil field rather than sending null", async () => {
    // A nil prospective field means "leave unchanged" server-side, so sending
    // `assignee_type: null` is not the same request as omitting it.
    const spy = fetchSpy().mockResolvedValue({ triggers: [], total_count: 0 });
    await api.previewIssueTrigger({
      isCreate: true,
      assigneeType: null,
      assigneeId: null,
    });
    expect(spy).toHaveBeenCalledWith(
      "/api/issues/preview-trigger",
      expect.objectContaining({
        body: JSON.stringify({ is_create: true }),
      }),
    );
  });

  it("carries issue_ids for an existing-issue preview", async () => {
    const spy = fetchSpy().mockResolvedValue({ triggers: [], total_count: 1 });
    await api.previewIssueTrigger({
      issueIds: ["i-1"],
      assigneeType: "squad",
      assigneeId: "s-1",
    });
    expect(spy).toHaveBeenCalledWith(
      "/api/issues/preview-trigger",
      expect.objectContaining({
        body: JSON.stringify({
          issue_ids: ["i-1"],
          assignee_type: "squad",
          assignee_id: "s-1",
        }),
      }),
    );
  });

  it("drops an empty issue_ids list instead of sending it", async () => {
    const spy = fetchSpy().mockResolvedValue({ triggers: [], total_count: 0 });
    await api.previewIssueTrigger({ issueIds: [], isCreate: true });
    expect(spy).toHaveBeenCalledWith(
      "/api/issues/preview-trigger",
      expect.objectContaining({
        body: JSON.stringify({ is_create: true }),
      }),
    );
  });

  it("parses a resolved verdict, including the trigger list", async () => {
    fetchSpy().mockResolvedValue({
      triggers: [
        {
          issue_id: "i-1",
          agent_id: "a-1",
          source: "assignee",
          handoff_supported: true,
        },
      ],
      total_count: 1,
    });
    const res = await api.previewIssueTrigger({ isCreate: true });
    expect(res.total_count).toBe(1);
    expect(res.triggers[0]?.agent_id).toBe("a-1");
    expect(res.triggers[0]?.handoff_supported).toBe(true);
  });

  it("degrades a malformed payload to the empty preview", async () => {
    // parseWithFallback per the mobile CLAUDE.md drift-defense rule: a bad
    // response must read as "no run would start", which is the benign
    // direction for the caption (it stays parked rather than promising a run).
    fetchSpy().mockResolvedValue({ triggers: "nonsense", total_count: "x" });
    const res = await api.previewIssueTrigger({ isCreate: true });
    expect(res).toEqual({ triggers: [], total_count: 0 });
  });
});
