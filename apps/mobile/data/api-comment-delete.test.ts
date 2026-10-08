import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ApiClient pulls in native modules at module scope; the Node vitest lane
// stubs them so the import chain resolves. Same pattern as
// api-attachment-content.test.ts.
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

type Api = typeof import("./api").api;
let api: Api;

beforeAll(async () => {
  const mod = await import("./api");
  api = mod.api;
});

beforeEach(() => {
  vi.restoreAllMocks();
});

/** The delete endpoint answers 204 with no body. */
function mockDelete() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve(new Response(null, { status: 204 })),
  );
}

function urlOf(spy: { mock: { calls: unknown[][] } }, index = 0): string {
  return String((spy.mock.calls[index] as unknown[])[0]);
}

/**
 * Iteration 210 — `/keep-replies` is the route that PROMISES the replies
 * survive (#8296). A server that predates it does not mount the path, so the
 * plain route must stay the default: sending `/keep-replies` unconditionally
 * would turn every delete on an older deployment into a 404.
 */
describe("deleteComment route selection", () => {
  it("uses the plain route by default", async () => {
    const spy = mockDelete();
    await api.deleteComment("c-1");
    expect(urlOf(spy)).toBe("https://api.test/api/comments/c-1");
  });

  it("uses the keep-replies route when the caller asks for the promise", async () => {
    const spy = mockDelete();
    await api.deleteComment("c-1", { keepReplies: true });
    expect(urlOf(spy)).toBe("https://api.test/api/comments/c-1/keep-replies");
  });

  it("keeps the plain route for an explicit false", async () => {
    const spy = mockDelete();
    await api.deleteComment("c-1", { keepReplies: false });
    expect(urlOf(spy)).toBe("https://api.test/api/comments/c-1");
  });

  it("sends DELETE, not a body-carrying verb", async () => {
    const spy = mockDelete();
    await api.deleteComment("c-1", { keepReplies: true });
    const init = (spy.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(init?.method).toBe("DELETE");
  });
});
