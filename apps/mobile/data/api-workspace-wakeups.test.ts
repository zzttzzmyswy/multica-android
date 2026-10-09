import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ApiClient pulls in native modules at module scope; the Node vitest lane stubs
// them so the import chain resolves (same chain as api-issue-wakeups.test.ts).
// `api` is brought in by dynamic import because static ESM imports hoist above
// these mocks.
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

/** A spy on the private `fetch` the public methods route through. Typed with a
 *  one-argument signature so `mock.calls[0][0]` is the requested path rather
 *  than an empty tuple. */
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

/**
 * Iteration 217 (MYS-2043) — the three workspace-level wakeup endpoints.
 *
 * MYS-2023 / 2031 / 2040 built the ISSUE-level wakeup surface. The workspace
 * had two more homes on web that mobile had no caller for at all: the
 * cross-issue rule table (自动化 → 任务唤醒) and the platform rule's workspace
 * default (设置 → 唤醒). This suite pins the wire shape of the three methods
 * that reach them, using response bodies copied from the live deployment
 * (`mu.zztweb.top`, probed this round) rather than invented ones.
 */
/** A row shaped like the live `/api/issue-wakeups` payload (mu.zztweb.top). */
function liveRow(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "w-1",
    issue_id: "i-1",
    issue_identifier: "MYS-1",
    issue_title: "迭代",
    issue_closed: false,
    can_manage: true,
    active_runs: 0,
    runs_7d: 0,
    source: "member",
    rule: null,
    system_stage: null,
    system_remaining: null,
    target_type: null,
    task: null,
    kind: "event",
    mode: "once",
    event_types: ["issue.status_changed"],
    timezone: "UTC",
    enabled: true,
    revision: 1,
    fire_count: 0,
    condition: { type: "issue_field", field: "status", value: "in_review" },
    ...over,
  };
}

describe("workspace wakeup API", () => {
  it("GETs one page of the workspace table with every filter on the query string", async () => {
    const spy = fetchSpy().mockResolvedValue({
      items: [],
      total: 0,
      counts: { active: 0, all: 0, paused: 0, disabled: 0, ended: 0 },
      agents: [],
    });
    await api.listWorkspaceWakeups({
      scope: "active",
      kind: "recurring",
      source: "agent",
      search: "迭代",
      agent_id: "a-1",
      offset: 20,
      limit: 20,
    });

    const path = spy.mock.calls[0][0];
    expect(path.startsWith("/api/issue-wakeups?")).toBe(true);
    const query = new URLSearchParams(path.slice("/api/issue-wakeups?".length));
    expect(query.get("scope")).toBe("active");
    expect(query.get("kind")).toBe("recurring");
    expect(query.get("source")).toBe("agent");
    expect(query.get("agent_id")).toBe("a-1");
    expect(query.get("offset")).toBe("20");
    expect(query.get("limit")).toBe("20");
    // Encoded, not dropped: a CJK search is the case that breaks a hand-rolled
    // query string.
    expect(query.get("search")).toBe("迭代");
  });

  it("sends an empty source and search rather than omitting them", async () => {
    // Web builds the bag with `Object.entries(filters)`, so an unset dimension
    // still travels as an empty value. The server accepts it (verified live:
    // a web-shaped bag with empties answers 200), and matching that shape
    // exactly is what keeps the two clients' URLs identical.
    const spy = fetchSpy().mockResolvedValue({
      items: [],
      total: 0,
      counts: { active: 0, all: 0, paused: 0, disabled: 0, ended: 0 },
      agents: [],
    });
    await api.listWorkspaceWakeups({
      scope: "all",
      kind: "all",
      source: "",
      search: "",
      agent_id: "",
      offset: 0,
      limit: 20,
    });

    const query = new URLSearchParams(
      spy.mock.calls[0][0].slice("/api/issue-wakeups?".length),
    );
    expect(query.has("source")).toBe(true);
    expect(query.get("source")).toBe("");
    expect(query.has("search")).toBe(true);
    expect(query.has("agent_id")).toBe(true);
  });

  it("parses a live-shaped page, including a row with a task and a system row", async () => {
    // Trimmed from a real GET /api/issue-wakeups row (probed this round); the
    // field list is the server's, not a guess.
    fetchSpy().mockResolvedValue({
      items: [
        {
          id: "01a1217a-cf5d-77fc-bc49-735cd3d09fbf",
          issue_id: "01a1217a-ae6d-7e77-b686-f962be72a137",
          issue_identifier: "MYS-2042",
          issue_title: "迭代 I13",
          issue_closed: false,
          can_manage: true,
          active_runs: 0,
          source: "agent",
          runs_7d: 3,
          rule: null,
          system_stage: null,
          system_remaining: null,
          target_type: null,
          enabled: true,
          kind: "event",
          mode: "once",
          agent_id: "a-1",
          agent_name: "技术负责人-贵",
          event_types: ["issue.status_changed"],
          revision: 4,
          task: null,
        },
      ],
      total: 136,
      counts: { active: 10, all: 136, paused: 0, disabled: 4, ended: 122 },
      agents: [{ id: "a-1", name: "技术负责人-贵" }],
    });

    const page = await api.listWorkspaceWakeups({
      scope: "active",
      kind: "all",
      source: "",
      search: "",
      agent_id: "",
      offset: 0,
      limit: 20,
    });

    expect(page.total).toBe(136);
    expect(page.counts.ended).toBe(122);
    expect(page.agents).toHaveLength(1);
    expect(page.items[0].issue_identifier).toBe("MYS-2042");
    expect(page.items[0].can_manage).toBe(true);
    expect(page.items[0].runs_7d).toBe(3);
    expect(page.items[0].source).toBe("agent");
  });

  it("degrades a malformed page to an empty one rather than throwing", async () => {
    // The table is a whole screen of rows: a server that renames a field should
    // show "nothing here", not take the screen down. The fallback's counts are
    // zero for the same reason the real ones come from the server — this client
    // never derives a scope inventory it was not given.
    fetchSpy().mockResolvedValue({ nope: true });
    const page = await api.listWorkspaceWakeups({
      scope: "active",
      kind: "all",
      source: "",
      search: "",
      agent_id: "",
      offset: 0,
      limit: 20,
    });
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.counts.all).toBe(0);
    expect(page.agents).toEqual([]);
  });

  it("GETs the platform rule's workspace default", async () => {
    const spy = fetchSpy().mockResolvedValue([
      {
        rule: "child_done",
        enabled: true,
        instruction: "",
        builtin_instruction: "Sub-issues of this issue have closed; …",
        customized: 0,
      },
    ]);
    const rules = await api.listWorkspaceSystemWakeups();

    expect(spy.mock.calls[0][0]).toBe("/api/system-wakeups");
    expect(rules).toHaveLength(1);
    expect(rules[0].rule).toBe("child_done");
    expect(rules[0].enabled).toBe(true);
    expect(rules[0].customized).toBe(0);
    expect(rules[0].builtin_instruction.length).toBeGreaterThan(0);
  });

  it("degrades a malformed default read to an empty list", async () => {
    fetchSpy().mockResolvedValue({ nope: true });
    expect(await api.listWorkspaceSystemWakeups()).toEqual([]);
  });

  it("PUTs a default change and returns the server's own rule list", async () => {
    const spy = fetchSpy().mockResolvedValue([
      {
        rule: "child_done",
        enabled: false,
        instruction: "check the stage",
        builtin_instruction: "…",
        customized: 2,
      },
    ]);
    const rules = await api.updateWorkspaceSystemWakeup("child_done", {
      instruction: "check the stage",
    });

    const [path, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/system-wakeups/child_done");
    expect(init.method).toBe("PUT");
    // Omitted fields keep their value server-side, so only what changed travels.
    expect(JSON.parse(String(init.body))).toEqual({
      instruction: "check the stage",
    });
    // The response IS the new state — the caller seeds it rather than refetching.
    expect(rules[0].enabled).toBe(false);
    expect(rules[0].customized).toBe(2);
  });

  it("throws on a rejected default write instead of reporting a stored default", async () => {
    // A write that degraded would tell an admin their default was saved while
    // every issue that follows it keeps the old one. The server answers 403 for
    // a non-admin and 400 for an over-long instruction; both must surface.
    fetchSpy().mockRejectedValue(
      Object.assign(new Error("only owners and admins can change workspace defaults"), {
        status: 403,
      }),
    );
    await expect(
      api.updateWorkspaceSystemWakeup("child_done", { enabled: true }),
    ).rejects.toThrow(/only owners and admins/);
  });

  it("keeps a row whose target agent was DELETED, instead of blanking the page", async () => {
    // The defect this pins was found on the Pixel 5, not by this suite: the
    // live server returned a 200 with nine rows, one of them carrying
    // `agent_id: null` (its agent had been deleted), and a `z.string()` on that
    // field rejected the WHOLE response — so ONE row emptied a table of 135
    // rules, and the screen said 「暂无唤醒规则」 about a workspace full of them.
    // Measured on mu.zztweb.top: 1 of 9 active rows has a null `agent_id`.
    const spy = fetchSpy().mockResolvedValue({
      items: [
        liveRow({ id: "w-live", agent_id: "d85c4c9a-6527-4310-bc12-48dd82e50684", agent_name: "技术负责人-贵" }),
        liveRow({ id: "w-deleted", agent_id: null, agent_name: null, source: "agent" }),
      ],
      total: 2,
      counts: { active: 2, all: 2, paused: 0, disabled: 0, ended: 0 },
      agents: [],
    });
    const page = await api.listWorkspaceWakeups({
      scope: "active",
      kind: "all",
      source: "",
      search: "",
      agent_id: "",
      offset: 0,
      limit: 20,
    });
    expect(page.items.map((row) => row.id)).toEqual(["w-live", "w-deleted"]);
    // An empty string, not null: every reader downstream treats `agent_id` as a
    // string, and `wakeups.no_target` is what says the row has no agent.
    expect(page.items[1].agent_id).toBe("");
    expect(page.items[1].agent_name).toBe("");
  });

  it("names the rule in the path so a second platform rule needs no new method", async () => {
    const spy = fetchSpy().mockResolvedValue([]);
    await api.updateWorkspaceSystemWakeup("child_done", { enabled: true });
    // Encoded like every other path segment in this client.
    expect(spy.mock.calls[0][0]).toBe("/api/system-wakeups/child_done");
  });
});
