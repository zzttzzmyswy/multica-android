/**
 * `ApiClient.getAgent` — the wire half of the no-access face (MYS-2161).
 *
 * The screen's whole decision rests on this method's failure shape: it must
 * request the single-agent endpoint and it must let a 403 out as an `ApiError`
 * carrying `status: 403`. If either half breaks, the page silently falls back
 * to 「该智能体不存在或已被删除」 for an agent that exists — the defect the
 * iteration is closing — and nothing else in the app would notice, because the
 * list path does not use this method at all.
 *
 * Same native-module stubs as the neighbouring `api-*.test.ts` files: the Node
 * vitest lane has no RN.
 */
process.env.EXPO_PUBLIC_API_URL = "https://api.test";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

let api: typeof import("./api").api;
let ApiError: typeof import("./api").ApiError;

beforeAll(async () => {
  ({ api, ApiError } = await import("./api"));
});

beforeEach(() => {
  vi.restoreAllMocks();
});

type FetchCall = [path: string, init?: RequestInit];

const fetchSpy = () =>
  vi.spyOn(
    api as unknown as { fetch: (path: string, init?: RequestInit) => Promise<unknown> },
    "fetch",
  );

/** A minimal body that satisfies AgentSchema — `id` is its only required key. */
const AGENT_BODY = { id: "agent-1", name: "Private Agent" };

describe("getAgent", () => {
  it("GETs the single-agent endpoint, not the list", async () => {
    const spy = fetchSpy().mockResolvedValue(AGENT_BODY);
    const agent = await api.getAgent("agent-1");

    const [path, init] = (spy.mock.calls as unknown as FetchCall[])[0];
    // The id must be IN the path: a request to /api/agents (the filtered list)
    // would return 200-without-the-row and produce no 403 to branch on, which
    // is precisely the state the page cannot distinguish today.
    expect(path).toBe("/api/agents/agent-1");
    expect(init?.method ?? "GET").toBe("GET");
    expect(agent.id).toBe("agent-1");
    expect(agent.name).toBe("Private Agent");
  });

  it("forwards the caller's abort signal", async () => {
    const spy = fetchSpy().mockResolvedValue(AGENT_BODY);
    const controller = new AbortController();
    await api.getAgent("agent-1", { signal: controller.signal });
    const [, init] = (spy.mock.calls as unknown as FetchCall[])[0];
    // React Query cancels a probe whose observer detached (navigate away). A
    // dropped signal would leave the request running against a dead component.
    expect(init?.signal).toBe(controller.signal);
  });

  it("propagates a 403 as an ApiError carrying that status", async () => {
    // The screen tests `error.status === 403`; the transport is what has to
    // preserve it. `ApiClient.fetch` throws before any parsing, so schema drift
    // in the body cannot mask the verdict.
    fetchSpy().mockRejectedValue(
      new ApiError("you do not have access to this agent", 403),
    );
    await expect(api.getAgent("agent-1")).rejects.toMatchObject({ status: 403 });
  });

  it("propagates a 404 distinctly from a 403", async () => {
    fetchSpy().mockRejectedValue(new ApiError("agent not found", 404));
    await expect(api.getAgent("agent-1")).rejects.toMatchObject({ status: 404 });
  });

  it("degrades a malformed 200 body to the empty fallback instead of throwing", async () => {
    // House read-side discipline (`parseWithFallback`): a drifted body must not
    // throw into the screen. The fallback is safe BECAUSE nothing reads it — the
    // probe's consumer branches on the error's status alone — so this asserts
    // the degradation happens, not that the value means anything.
    fetchSpy().mockResolvedValue({ not: "an agent" });
    const agent = await api.getAgent("agent-1");
    expect(agent.id).toBe("");
  });

  it("keeps the empty fallback distinguishable from a real agent", async () => {
    // `id` is AgentSchema's only required field, so a real agent can never
    // collide with the fallback — the invariant the previous case leans on.
    fetchSpy().mockResolvedValue(AGENT_BODY);
    const agent = await api.getAgent("agent-1");
    expect(agent.id).not.toBe("");
  });
});
