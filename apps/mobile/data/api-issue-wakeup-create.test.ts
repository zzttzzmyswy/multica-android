import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Same native stubs as api-issue-wakeup-write.test.ts: ApiClient pulls native
// modules in at module scope, and this lane has no renderer.
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
 * Iteration 216 (MYS-2040) — `createIssueWakeup`, the tenth wakeup method.
 *
 * The nine that existed before this round were all "read a rule" or "write to a
 * rule that is already there"; none of them could bring a rule into existence.
 * The path and the body shape are web's (`packages/core/api/client.ts:1341`),
 * and the server mounts exactly this route (`router.go:2035`
 * `POST /api/issues/:issueID/wakeups`). A path that drifts by one segment does
 * not fail loudly — the server answers 404 and the user reads "could not
 * create" on a draft that was perfectly valid.
 */
describe("createIssueWakeup (MYS-2040)", () => {
  it("POSTs the issue's wakeup collection", async () => {
    const spy = fetchSpy().mockResolvedValue(undefined);
    await api.createIssueWakeup("i-1", {
      agent_id: "a-1",
      instruction: "check the result",
      kind: "at",
      mode: "once",
      at: "2026-10-01T09:00:00.000Z",
    });
    expect(call(spy)).toEqual({
      path: "/api/issues/i-1/wakeups",
      method: "POST",
      body: {
        agent_id: "a-1",
        instruction: "check the result",
        kind: "at",
        mode: "once",
        at: "2026-10-01T09:00:00.000Z",
      },
    });
  });

  it("carries a platform condition through unchanged", async () => {
    // The condition path is the one the server validates most narrowly
    // ("conditions use kind event", issue_wakeup.go:150), so the body has to
    // reach it exactly as the draft layer built it.
    const spy = fetchSpy().mockResolvedValue(undefined);
    await api.createIssueWakeup("i-1", {
      agent_id: "a-1",
      instruction: "go",
      kind: "event",
      mode: "once",
      expires_in_seconds: 604800,
      on_timeout: "wake",
      condition: { type: "children_done", stage: 2 },
    });
    expect(call(spy).body).toEqual({
      agent_id: "a-1",
      instruction: "go",
      kind: "event",
      mode: "once",
      expires_in_seconds: 604800,
      on_timeout: "wake",
      condition: { type: "children_done", stage: 2 },
    });
  });

  it("percent-encodes the issue id", async () => {
    const spy = fetchSpy().mockResolvedValue(undefined);
    await api.createIssueWakeup("i/1", {
      agent_id: "a",
      instruction: "x",
      kind: "at",
      at: "2026-10-01T09:00:00.000Z",
    });
    expect(call(spy).path).toBe("/api/issues/i%2F1/wakeups");
  });

  it("never reports a rejected create as a success", async () => {
    // The read path degrades to an empty list on a broken payload; a write must
    // not. A create that resolved on failure would close the sheet as if a rule
    // now existed, and the user would only find out because nothing ever fires.
    fetchSpy().mockRejectedValue(
      Object.assign(new Error("wakeup capacity exceeded"), { status: 409 }),
    );
    await expect(
      api.createIssueWakeup("i-1", {
        agent_id: "a",
        instruction: "x",
        kind: "at",
        at: "2026-10-01T09:00:00.000Z",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
