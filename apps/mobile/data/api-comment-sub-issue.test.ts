import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The wire contract for comment → sub-issue (MYS-2137).
 *
 * `lib/source-context.ts` proves what a preview MEANS and which failures get
 * their own sentence. This proves the two things that make the feature work at
 * all, and neither of which a rule test can see:
 *
 *  1. `capture_token` actually reaches the wire on the create. Without it the
 *     server answers 409 `source_context_changed` on EVERY create, and the
 *     member is told to refresh forever.
 *  2. The mode/field pairing matches what the live server accepts. The web
 *     bundle's variable naming suggests a `manual`/`auto` pair; the server
 *     rejects `auto` outright (`{"error":"mode must be manual or agent"}` —
 *     probed 2026-10-13) and requires `quick_create` (not `prompt`) for agent
 *     mode.
 *
 * Same ApiClient harness as api-comment-trigger-preview.test.ts: stub the native
 * modules the module-scope import pulls in, then drive the real transport with a
 * spied `fetch`.
 */
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

let api: typeof import("./api").api;

type Transport = {
  fetch: (path: string, init?: { method?: string; body?: string }) => Promise<unknown>;
};

const fetchSpy = () => vi.spyOn(api as unknown as Transport, "fetch");

function sentBody(spy: ReturnType<typeof fetchSpy>): Record<string, unknown> {
  const init = spy.mock.calls.at(-1)?.[1];
  return JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
}

/** A minimal issue payload the create response is parsed against. */
const ISSUE_ROW = {
  id: "child-1",
  workspace_id: "ws",
  number: 2139,
  identifier: "MYS-2139",
  title: "child",
  description: null,
  status: "todo",
  status_category: "todo",
  priority: "none",
  assignee_type: null,
  assignee_id: null,
  creator_type: "member",
  creator_id: "u1",
  parent_issue_id: "parent-1",
  duplicate_of: null,
  project_id: null,
  position: 0,
  stage: null,
  start_date: null,
  due_date: null,
  metadata: {},
  properties: {},
  created_at: "t",
  updated_at: "t",
};

beforeAll(async () => {
  ({ api } = await import("./api"));
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("getCommentSubIssuePreview", () => {
  it("reads the endpoint and parses the five fields the server sends", async () => {
    // Verbatim shape from `GET /api/comments/:id/sub-issue-preview` on
    // mu.zztweb.top, 2026-10-13.
    const spy = fetchSpy().mockResolvedValue({
      source_issue: {
        id: "src-1",
        identifier: "MYS-2138",
        number: 2138,
        title: "source",
        description: "d",
      },
      comment_thread: [
        {
          id: "c1",
          parent_id: null,
          type: "comment",
          content: "anchor",
          author: { type: "member", id: "u1", name: "MYSWY" },
          created_at: "t",
        },
      ],
      anchor_comment_id: "c1",
      capture_token: "sha256:abc:src-1",
      limits: {
        comment_count: 1,
        text_bytes: 21761,
        attachment_count: 0,
        attachment_bytes: 0,
      },
    });

    const preview = await api.getCommentSubIssuePreview("c1");

    expect(spy).toHaveBeenCalledWith(
      "/api/comments/c1/sub-issue-preview",
      undefined,
    );
    expect(preview.capture_token).toBe("sha256:abc:src-1");
    expect(preview.source_issue.identifier).toBe("MYS-2138");
    expect(preview.comment_thread).toHaveLength(1);
    expect(preview.comment_thread[0]?.author.name).toBe("MYSWY");
    expect(preview.limits.text_bytes).toBe(21761);
  });

  it("forwards the caller's abort signal", async () => {
    const spy = fetchSpy().mockResolvedValue({
      source_issue: { id: "s", identifier: "M", number: 1, title: "t", description: null },
      comment_thread: [],
      anchor_comment_id: "c",
      capture_token: "tok",
      limits: { comment_count: 0, text_bytes: 0, attachment_count: 0, attachment_bytes: 0 },
    });
    const controller = new AbortController();
    await api.getCommentSubIssuePreview("c1", { signal: controller.signal });
    expect(spy.mock.calls.at(-1)?.[1]).toMatchObject({ signal: controller.signal });
  });

  it("fails CLOSED — a drifted body yields a preview with no capture token", async () => {
    // The whole safety property of the surface: `previewIsUsable` refuses a
    // token-less preview, so a drifted read turns into a visible "could not
    // load" instead of a create button that the server rejects on every tap.
    fetchSpy().mockResolvedValue({ nonsense: true });
    const preview = await api.getCommentSubIssuePreview("c1");
    expect(preview.capture_token).toBe("");
    expect(preview.limits.comment_count).toBe(0);
  });
});

describe("createCommentSubIssue — manual mode", () => {
  it("sends mode + capture_token + issue, and returns the created issue", async () => {
    const spy = fetchSpy().mockResolvedValue(ISSUE_ROW);

    const result = await api.createCommentSubIssue("c1", {
      mode: "manual",
      capture_token: "sha256:abc:src-1",
      issue: { title: "child" },
    });

    expect(spy).toHaveBeenCalledWith(
      "/api/comments/c1/sub-issues",
      expect.objectContaining({ method: "POST" }),
    );
    // The token is the point of this test: without it the server refuses every
    // create with 409 and the member is told to refresh forever.
    expect(sentBody(spy)).toEqual({
      mode: "manual",
      capture_token: "sha256:abc:src-1",
      issue: { title: "child" },
    });
    expect(result).toEqual({ mode: "manual", issue: ISSUE_ROW });
  });

  it("never sends `auto`, which the live server rejects outright", async () => {
    const spy = fetchSpy().mockResolvedValue(ISSUE_ROW);
    await api.createCommentSubIssue("c1", {
      mode: "manual",
      capture_token: "tok",
      issue: { title: "x" },
    });
    expect(sentBody(spy).mode).toBe("manual");
  });

  it("throws rather than reporting a malformed create as an empty issue", async () => {
    // A create the server ACCEPTED must not be reported to the member as an
    // empty issue: the surface navigates to `result.issue.id`, so an empty id
    // would send them to a route that does not exist.
    fetchSpy().mockResolvedValue({ nothing: "useful" });
    await expect(
      api.createCommentSubIssue("c1", {
        mode: "manual",
        capture_token: "tok",
        issue: { title: "x" },
      }),
    ).rejects.toThrow(/malformed issue/);
  });
});

describe("createCommentSubIssue — agent mode", () => {
  it("sends quick_create (not prompt) and returns the task id", async () => {
    // The server answers `{"error":"quick_create is required for agent mode"}`
    // for a body carrying a bare `prompt` — probed 2026-10-13. Getting this
    // wrong is a silent 400 on every agent-mode create.
    const spy = fetchSpy().mockResolvedValue({ task_id: "task-9" });

    const result = await api.createCommentSubIssue("c1", {
      mode: "agent",
      capture_token: "tok",
      quick_create: { prompt: "summarize the thread" },
    });

    expect(sentBody(spy)).toEqual({
      mode: "agent",
      capture_token: "tok",
      quick_create: { prompt: "summarize the thread" },
    });
    expect(result).toEqual({ mode: "agent", task_id: "task-9" });
  });

  it("throws when agent mode returns no task id", async () => {
    // Same reason as the manual half: there is nothing to navigate to and
    // nothing to report, so a success that carries no id is a failure.
    fetchSpy().mockResolvedValue({ ok: true });
    await expect(
      api.createCommentSubIssue("c1", {
        mode: "agent",
        capture_token: "tok",
        quick_create: { prompt: "x" },
      }),
    ).rejects.toThrow(/task_id/);
  });
});
