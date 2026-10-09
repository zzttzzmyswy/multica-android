import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ApiClient pulls in native modules at module scope; the Node vitest lane
// stubs them so the import chain resolves (same chain as
// api-issue-wakeups.test.ts, which covers this family's read half).
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

/** A spy on the private `fetch` the public methods route through. */
const fetchSpy = () =>
  vi.spyOn(
    api as unknown as {
      fetch: (path: string, init?: unknown) => Promise<unknown>;
    },
    "fetch",
  );

beforeAll(async () => {
  ({ api } = await import("./api"));
});

beforeEach(() => {
  vi.restoreAllMocks();
});

/** Path + method + parsed body of call `i`, for asserting the request shape. */
function call(spy: { mock: { calls: unknown[][] } }, i = 0) {
  const [path, init] = spy.mock.calls[i] as [
    string,
    { method?: string; body?: string } | undefined,
  ];
  return {
    path,
    method: init?.method,
    body: init?.body ? (JSON.parse(init.body) as unknown) : undefined,
  };
}

/**
 * Iteration 215 (MYS-2031) — the seven wakeup writes.
 *
 * Every path below is web's, byte for byte
 * (`packages/core/api/client.ts:1333-1389`). A path that drifts by one
 * segment does not error loudly: the server answers 404 and the user reads
 * "could not save" on a rule that is perfectly fine. So each one is pinned
 * here against the literal the server mounts
 * (`server/cmd/server/router.go:2033-2044`).
 */
describe("issue wakeup write methods (MYS-2031)", () => {
  it("enableIssueWakeup POSTs the rule's enable path with the revision", async () => {
    const spy = fetchSpy().mockResolvedValue(undefined);
    await api.enableIssueWakeup("issue-1", "w-1", { revision: 7 });
    expect(call(spy)).toEqual({
      path: "/api/issues/issue-1/wakeups/w-1/enable",
      method: "POST",
      body: { revision: 7 },
    });
  });

  it("carries the rearm flag and the new time through unchanged", async () => {
    // The server validates `at` in its own timezone-aware way and refuses an
    // enable that needs a rearm without one ("consumed one-shot requires
    // explicit rearm"). The client must not drop either field.
    const spy = fetchSpy().mockResolvedValue(undefined);
    await api.enableIssueWakeup("i", "w", {
      revision: 3,
      rearm: true,
      at: "2026-10-10T02:00:00.000Z",
    });
    expect(call(spy).body).toEqual({
      revision: 3,
      rearm: true,
      at: "2026-10-10T02:00:00.000Z",
    });
  });

  it("disableIssueWakeup POSTs the disable path with no body", async () => {
    const spy = fetchSpy().mockResolvedValue(undefined);
    await api.disableIssueWakeup("issue-1", "w-1");
    expect(call(spy)).toEqual({
      path: "/api/issues/issue-1/wakeups/w-1/disable",
      method: "POST",
      body: undefined,
    });
  });

  it("triggerIssueWakeup POSTs the trigger path with no body", async () => {
    const spy = fetchSpy().mockResolvedValue(undefined);
    await api.triggerIssueWakeup("issue-1", "w-1");
    expect(call(spy)).toEqual({
      path: "/api/issues/issue-1/wakeups/w-1/trigger",
      method: "POST",
      body: undefined,
    });
  });

  it("deleteIssueWakeup DELETEs the rule's own path", async () => {
    const spy = fetchSpy().mockResolvedValue(undefined);
    await api.deleteIssueWakeup("issue-1", "w-1");
    expect(call(spy)).toEqual({
      path: "/api/issues/issue-1/wakeups/w-1",
      method: "DELETE",
      body: undefined,
    });
  });

  it("editIssueWakeupInstruction PATCHes the instruction path with all three fences", async () => {
    // `expected_instruction` is not decoration: the server compares BOTH it
    // and the revision (`issue_wakeup.go:325`), so dropping it would let a
    // stale editor overwrite another person's edit whenever the revision
    // happened to match.
    const spy = fetchSpy().mockResolvedValue(undefined);
    await api.editIssueWakeupInstruction("issue-1", "w-1", {
      instruction: "check CI",
      expected_instruction: "review the PR",
      revision: 4,
    });
    expect(call(spy)).toEqual({
      path: "/api/issues/issue-1/wakeups/w-1/instruction",
      method: "PATCH",
      body: {
        instruction: "check CI",
        expected_instruction: "review the PR",
        revision: 4,
      },
    });
  });

  it("updateIssueSystemWakeup PUTs the system rule path", async () => {
    const spy = fetchSpy().mockResolvedValue([]);
    await api.updateIssueSystemWakeup("issue-1", "child_done", {
      enabled: false,
      instruction: "",
    });
    expect(call(spy)).toEqual({
      path: "/api/issues/issue-1/system-wakeups/child_done",
      method: "PUT",
      body: { enabled: false, instruction: "" },
    });
  });

  it("omits a field the caller did not set rather than sending undefined", async () => {
    // The server keeps an omitted field's value, and its decoder rejects
    // unknown fields (`DisallowUnknownFields`). `JSON.stringify` already drops
    // an `undefined` value, so this pins the property the toggle path relies
    // on: toggling must not blank the instruction.
    const spy = fetchSpy().mockResolvedValue([]);
    await api.updateIssueSystemWakeup("i", "child_done", { enabled: true });
    expect(call(spy).body).toEqual({ enabled: true });
  });

  it("percent-encodes every id it interpolates", async () => {
    const spy = fetchSpy().mockResolvedValue(undefined);
    await api.disableIssueWakeup("i/1", "w 2");
    expect(call(spy).path).toBe("/api/issues/i%2F1/wakeups/w%202/disable");
  });

  it("propagates a conflict instead of swallowing it", async () => {
    // A write must never degrade to "success": the caller branches on the 409
    // to refresh the row, and a swallowed error would leave the UI claiming a
    // change that did not happen.
    fetchSpy().mockRejectedValue(
      Object.assign(new Error("wakeup changed; refresh and retry"), {
        status: 409,
      }),
    );
    await expect(
      api.enableIssueWakeup("i", "w", { revision: 1 }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("never swallows a failure on ANY of the seven writes", async () => {
    // The reads degrade to an empty list on a broken payload; the writes do
    // not, and that asymmetry is the whole point. A `catch` that turned a
    // rejected write into a resolved one would leave the row claiming the rule
    // was stopped / woken / deleted when the server never applied it — and the
    // user would only find out from the run that still fires.
    //
    // Every method is listed explicitly rather than sampled: a single
    // regression here is invisible, because the caller's `onError` simply never
    // runs and the sheet closes as if it had worked.
    const failing = () =>
      fetchSpy().mockRejectedValue(
        Object.assign(new Error("wakeup changed; refresh and retry"), {
          status: 409,
        }),
      );
    const calls: [string, () => Promise<unknown>][] = [
      ["enable", () => api.enableIssueWakeup("i", "w", { revision: 1 })],
      ["disable", () => api.disableIssueWakeup("i", "w")],
      ["trigger", () => api.triggerIssueWakeup("i", "w")],
      ["delete", () => api.deleteIssueWakeup("i", "w")],
      [
        "editInstruction",
        () =>
          api.editIssueWakeupInstruction("i", "w", {
            instruction: "a",
            expected_instruction: "b",
            revision: 1,
          }),
      ],
      [
        "updateSystem",
        () => api.updateIssueSystemWakeup("i", "child_done", { enabled: true }),
      ],
    ];
    for (const [name, call] of calls) {
      failing();
      await expect(call(), `${name} must reject`).rejects.toMatchObject({
        status: 409,
      });
    }
  });

  it("returns the parsed system rules from an update", async () => {
    // The endpoint answers with the issue's full rule list, not just the one
    // changed. Parsing it means the caller can refresh from the response.
    fetchSpy().mockResolvedValue([
      {
        id: "r-1",
        revision: 1,
        rule: "child_done",
        enabled: false,
        instruction: "",
        default_instruction: "…",
        customized: true,
        paused_reason: null,
        staged: false,
        stage: null,
        total: 3,
        remaining: 2,
        waiting: ["MYS-2"],
        target: null,
        blocked: "",
        workspace_default: true,
      },
    ]);
    const rules = await api.updateIssueSystemWakeup("i", "child_done", {
      enabled: false,
    });
    expect(rules).toHaveLength(1);
    expect(rules[0].customized).toBe(true);
  });
});
