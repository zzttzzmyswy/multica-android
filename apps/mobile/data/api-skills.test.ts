import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Same stub chain as api-labels-resource.test.ts — ApiClient pulls in native
// modules at module scope, so the Node vitest lane stubs them and sets the API
// URL before the (dynamically imported) module evaluates.
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

const SKILL_RESPONSE = {
  id: "skill-1",
  workspace_id: "ws-1",
  name: "my-skill",
  description: "desc",
  config: {
    origin: {
      type: "github",
      source_url: "https://github.com/acme/skill",
    },
  },
  content: "# My skill\n\nBody",
  created_by: "u-1",
  created_at: "2026-08-20T00:00:00Z",
  updated_at: "2026-08-21T00:00:00Z",
  files: [
    {
      id: "f-1",
      skill_id: "skill-1",
      path: "scripts/run.sh",
      content: "#!/bin/sh",
      created_at: "2026-08-20T00:00:00Z",
      updated_at: "2026-08-21T00:00:00Z",
    },
  ],
};

describe("refreshSkill api method (iteration 81)", () => {
  it("POSTs /api/skills/{id}/refresh and returns the refreshed skill", async () => {
    const spy = fetchSpy().mockResolvedValue(SKILL_RESPONSE);
    const res = await api.refreshSkill("skill-1");
    expect(spy).toHaveBeenCalledWith("/api/skills/skill-1/refresh", {
      method: "POST",
    });
    expect(res.id).toBe("skill-1");
    expect(res.content).toBe("# My skill\n\nBody");
    expect(res.files).toHaveLength(1);
    expect(res.files[0].path).toBe("scripts/run.sh");
  });

  it("degrades a malformed files shape to the empty-skill fallback", async () => {
    const spy = fetchSpy().mockResolvedValue({
      ...SKILL_RESPONSE,
      files: "not-an-array",
    });
    const res = await api.refreshSkill("skill-1");
    // SkillSchema drift defense: an invalid files field falls back to
    // EMPTY_SKILL rather than throwing.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(res.id).toBe("");
  });
});