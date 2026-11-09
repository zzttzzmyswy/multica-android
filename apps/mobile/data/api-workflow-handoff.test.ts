/**
 * `GET /api/issues/{id}/workflow-handoff` — the preview behind the handoff
 * confirmation (MUL-7420, iteration 290).
 *
 * The bodies used below are the REAL ones captured from the deployed server
 * (`mu.zztweb.top`, v0.8.1) in this iteration, not idealised ones, because the
 * property that matters is what the parser does with the server's actual
 * omissions: with `handoff: false` the server leaves `workflow_name`,
 * `handler_type`, `handler_id` and `brief` out of the body entirely
 * (`json:"...,omitempty"`). A schema that required them would fall back on
 * every ordinary status change — and a fallback is exactly the "silently no
 * handoff" answer this iteration exists to stop being automatic.
 *
 * The request shape is pinned too: upstream omits a nil field rather than
 * sending an empty one, so `previewWorkflowHandoff(id, "")` must not put
 * `status=` on the wire — the server reads a present-but-empty status as a
 * real request and refuses it.
 */
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

type ApiClient = typeof import("./api").api;
let api: ApiClient;

// Typed with an explicit arg tuple: the private `fetch` is generic, so a bare
// `vi.spyOn` infers `[]` and `spy.mock.calls[0][0]` stops type-checking — the
// assertions below are about the URL and options that reached it.
const fetchSpy = () =>
  vi.spyOn(
    api as unknown as { fetch: (path: string, init?: unknown) => Promise<unknown> },
    "fetch",
  );

beforeAll(async () => {
  ({ api } = await import("./api"));
});

beforeEach(() => {
  vi.restoreAllMocks();
});

/** Captured verbatim from the deployed server: nothing to hand off. */
const REAL_NO_HANDOFF = {
  handoff: false,
  from_status: "done",
  to_status: "todo",
  previous_assignee_type: "agent",
  previous_assignee_id: "4a890197-0df8-4414-b2a0-cc912a5ff0e9",
  previous_runs: [],
};

/** Captured verbatim from the deployed server: a real handoff, brief included. */
const REAL_HANDOFF = {
  handoff: true,
  workflow_name: "iter290 probe (temporary)",
  from_status: "todo",
  to_status: "in_progress",
  handler_type: "agent",
  handler_id: "4a890197-0df8-4414-b2a0-cc912a5ff0e9",
  previous_assignee_type: null,
  previous_assignee_id: null,
  previous_runs: [],
  brief: 'You are handling the "in_progress" step of MYS-2744.\n\nStep instructions:\n> do the thing\n',
};

describe("api.previewWorkflowHandoff — request", () => {
  it("asks the handoff endpoint with the status", async () => {
    const spy = fetchSpy().mockResolvedValue(REAL_NO_HANDOFF);
    await api.previewWorkflowHandoff("issue-1", "in_progress");
    expect(spy).toHaveBeenCalledWith(
      "/api/issues/issue-1/workflow-handoff?status=in_progress",
      expect.anything(),
    );
  });

  it("omits an empty status rather than sending it", async () => {
    // A present-but-empty `status` is not the same as an absent one to the
    // server. The project-move form sends no status at all.
    const spy = fetchSpy().mockResolvedValue(REAL_NO_HANDOFF);
    await api.previewWorkflowHandoff("issue-1", "");
    expect(spy.mock.calls[0]?.[0]).toBe("/api/issues/issue-1/workflow-handoff?");
  });

  it("sends project_id for a project move", async () => {
    const spy = fetchSpy().mockResolvedValue(REAL_NO_HANDOFF);
    await api.previewWorkflowHandoff("issue-1", "", "proj-9");
    expect(spy.mock.calls[0]?.[0]).toBe(
      "/api/issues/issue-1/workflow-handoff?project_id=proj-9",
    );
  });

  it("forwards the abort signal", async () => {
    const spy = fetchSpy().mockResolvedValue(REAL_NO_HANDOFF);
    const signal = new AbortController().signal;
    await api.previewWorkflowHandoff("issue-1", "todo", undefined, { signal });
    expect(spy.mock.calls[0]?.[1]).toEqual({ signal });
  });
});

describe("api.previewWorkflowHandoff — response", () => {
  it("parses the server's real no-handoff body, whose optional fields are ABSENT", async () => {
    fetchSpy().mockResolvedValue(REAL_NO_HANDOFF);
    const preview = await api.previewWorkflowHandoff("issue-1", "todo");
    expect(preview).toMatchObject({
      handoff: false,
      from_status: "done",
      to_status: "todo",
      previous_assignee_type: "agent",
      previous_runs: [],
    });
    // Absent in the body, defaulted here — not a parse failure.
    expect(preview.workflow_name).toBe("");
    expect(preview.handler_type).toBeNull();
    expect(preview.handler_id).toBeNull();
    expect(preview.brief).toBe("");
  });

  it("parses the server's real handoff body, brief and all", async () => {
    fetchSpy().mockResolvedValue(REAL_HANDOFF);
    const preview = await api.previewWorkflowHandoff("issue-1", "in_progress");
    expect(preview.handoff).toBe(true);
    expect(preview.workflow_name).toBe("iter290 probe (temporary)");
    expect(preview.handler_type).toBe("agent");
    expect(preview.handler_id).toBe("4a890197-0df8-4414-b2a0-cc912a5ff0e9");
    expect(preview.brief).toContain("MYS-2744");
  });

  it("keeps the runs the server reports", async () => {
    fetchSpy().mockResolvedValue({
      ...REAL_HANDOFF,
      previous_assignee_type: "agent",
      previous_assignee_id: "agent-2",
      previous_runs: [
        { task_id: "t1", agent_id: "agent-2", status: "running", started_at: "2026-11-09T10:00:00Z" },
      ],
    });
    const preview = await api.previewWorkflowHandoff("issue-1", "in_progress");
    expect(preview.previous_runs).toEqual([
      { task_id: "t1", agent_id: "agent-2", status: "running", started_at: "2026-11-09T10:00:00Z" },
    ]);
  });

  it("maps an unknown handler type to null instead of failing the parse", async () => {
    // Enum drift downgrades rather than crashes: a future handler type must
    // leave the dialog without a sentence, not blank the whole confirmation.
    fetchSpy().mockResolvedValue({ ...REAL_HANDOFF, handler_type: "some_future_actor" });
    const preview = await api.previewWorkflowHandoff("issue-1", "in_progress");
    expect(preview.handler_type).toBeNull();
  });

  it("defaults a missing started_at to null", async () => {
    fetchSpy().mockResolvedValue({
      ...REAL_HANDOFF,
      previous_runs: [{ task_id: "t1", agent_id: "a", status: "queued" }],
    });
    const preview = await api.previewWorkflowHandoff("issue-1", "in_progress");
    expect(preview.previous_runs[0]?.started_at).toBeNull();
  });
});
