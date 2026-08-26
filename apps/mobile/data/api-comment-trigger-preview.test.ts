import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Same ApiClient test harness as api-issue-views.test.ts: stub the native
// modules the module-scope import pulls in, then spy on the private fetch.
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

describe("comment trigger preview api (iter 106)", () => {
  it("previewCommentTriggers POSTs content-only to the trigger-preview path", async () => {
    const spy = fetchSpy().mockResolvedValue({ agents: [], blocked: [] });
    const res = await api.previewCommentTriggers("issue-1", "hello @agent");
    expect(spy).toHaveBeenCalledWith(
      "/api/issues/issue-1/comments/trigger-preview",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ content: "hello @agent" }),
      }),
    );
    expect(res).toEqual({ agents: [], blocked: [] });
  });

  it("passes parent_id and editing_comment_id when present", async () => {
    const spy = fetchSpy().mockResolvedValue({ agents: [] });
    await api.previewCommentTriggers("issue-1", "x", {
      parentId: "parent-9",
      editingCommentId: "comment-8",
    });
    expect(spy).toHaveBeenCalledWith(
      "/api/issues/issue-1/comments/trigger-preview",
      expect.objectContaining({
        body: JSON.stringify({
          content: "x",
          parent_id: "parent-9",
          editing_comment_id: "comment-8",
        }),
      }),
    );
  });

  it("omits parent_id when only editing_comment_id is set", async () => {
    const spy = fetchSpy().mockResolvedValue({ agents: [] });
    await api.previewCommentTriggers("issue-1", "x", {
      editingCommentId: "comment-8",
    });
    expect(spy).toHaveBeenCalledWith(
      "/api/issues/issue-1/comments/trigger-preview",
      expect.objectContaining({
        body: JSON.stringify({ content: "x", editing_comment_id: "comment-8" }),
      }),
    );
  });

  it("parses a full preview response into agents + blocked", async () => {
    const spy = fetchSpy().mockResolvedValue({
      agents: [{ id: "a-1", name: "Walt", source: "issue_assignee", reason: "" }],
      blocked: [
        {
          target_type: "agent",
          target_id: "a-2",
          status: "blocked",
          reason_code: "invocation_not_allowed",
        },
      ],
    });
    const res = await api.previewCommentTriggers("issue-1", "x");
    expect(res.agents[0]?.name).toBe("Walt");
    expect(res.blocked?.[0]?.reason_code).toBe("invocation_not_allowed");
  });

  it("degrades a malformed preview payload to an empty preview", async () => {
    fetchSpy().mockResolvedValue({ agents: "nonsense", blocked: null });
    const res = await api.previewCommentTriggers("issue-1", "x");
    expect(res).toEqual({ agents: [], blocked: [] });
  });

  it("createComment includes suppress_agent_ids only when supplied", async () => {
    const spy = fetchSpy().mockResolvedValue({
      id: "c-1",
      issue_id: "issue-1",
      author_type: "member",
      author_id: "u-1",
      content: "x",
      type: "comment",
      parent_id: null,
      reactions: [],
      attachments: [],
      created_at: "2026-08-26T00:00:00Z",
      updated_at: "2026-08-26T00:00:00Z",
      resolved_at: null,
      resolved_by_type: null,
      resolved_by_id: null,
    });
    await api.createComment("issue-1", "x", {
      suppressAgentIds: ["a-1"],
    });
    expect(spy).toHaveBeenCalledWith(
      "/api/issues/issue-1/comments",
      expect.objectContaining({
        body: JSON.stringify({
          content: "x",
          type: "comment",
          suppress_agent_ids: ["a-1"],
        }),
      }),
    );

    await api.createComment("issue-1", "x");
    expect(spy).toHaveBeenLastCalledWith(
      "/api/issues/issue-1/comments",
      expect.objectContaining({
        body: JSON.stringify({ content: "x", type: "comment" }),
      }),
    );
  });
});