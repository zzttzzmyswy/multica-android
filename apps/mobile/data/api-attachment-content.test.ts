import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ApiClient pulls in native modules at module scope; the Node vitest lane
// stubs them so the import chain resolves. Same pattern as api-failures.test.ts.
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
type ApiModule = typeof import("./api");
let api: Api;
let apiModule: ApiModule;

beforeAll(async () => {
  apiModule = await import("./api");
  api = apiModule.api;
});

beforeEach(() => {
  vi.restoreAllMocks();
});

function textResponse(
  body: string,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, { status, headers });
}

/** getAttachmentTextContent calls bare `fetch` (not the private JSON
 *  pipeline — a text body can't go through res.json()), so the mock sits
 *  on globalThis.fetch. */
function mockFetch(
  status: number,
  body: string,
  headers: Record<string, string> = {},
) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() =>
      Promise.resolve(textResponse(body, status, headers)),
    );
}

describe("getAttachmentTextContent — /api/attachments/{id}/content", () => {
  it("returns text + originalContentType from a 200 reply", async () => {
    const spy = mockFetch(200, "<h1>doc</h1>", {
      "X-Original-Content-Type": "text/html",
    });

    const res = await api.getAttachmentTextContent("att-1");
    expect(String((spy.mock.calls[0] as unknown[])[0])).toBe(
      "https://api.test/api/attachments/att-1/content",
    );
    expect(res.text).toBe("<h1>doc</h1>");
    expect(res.originalContentType).toBe("text/html");
  });

  it("maps 413 to PreviewTooLargeError", async () => {
    mockFetch(413, "file too large");
    await expect(api.getAttachmentTextContent("big")).rejects.toBeInstanceOf(
      apiModule.PreviewTooLargeError,
    );
  });

  it("maps 415 to PreviewUnsupportedError", async () => {
    mockFetch(415, "preview not supported");
    await expect(api.getAttachmentTextContent("bin")).rejects.toBeInstanceOf(
      apiModule.PreviewUnsupportedError,
    );
  });

  it("rethrows other statuses as ApiError with the server status", async () => {
    mockFetch(404, "attachment object not found");
    await expect(api.getAttachmentTextContent("gone")).rejects.toMatchObject({
      status: 404,
    });
  });
});
