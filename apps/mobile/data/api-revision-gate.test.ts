import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The wire contract for the concurrency gate (MYS-2132).
 *
 * The rule module proves what a conflict MEANS; this proves the gate fields are
 * actually SENT, which is the half that stops the silent overwrite. Without
 * `expected_revision` / `content_base` the server accepts a stale edit and
 * replaces whatever another writer saved — no error, no prompt, nothing either
 * party can see. A unit test of the classifier passes happily in that world.
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

/** The transport method under test. Typed with its REAL two parameters so the
 *  spy's call tuple carries the `init` argument — a zero-arg signature would
 *  type the tuple as `[]` and `.at(-1)?.[1]` would not compile. */
type Transport = {
  fetch: (path: string, init?: { method?: string; body?: string }) => Promise<unknown>;
};

const fetchSpy = () => vi.spyOn(api as unknown as Transport, "fetch");

/** The body the transport actually put on the wire for the last call. */
function sentBody(spy: ReturnType<typeof fetchSpy>): Record<string, unknown> {
  const init = spy.mock.calls.at(-1)?.[1];
  return JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
}

beforeAll(async () => {
  ({ api } = await import("./api"));
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("updateComment sends the concurrency gate", () => {
  it("carries content_base and expected_revision when the caller supplies them", async () => {
    const spy = fetchSpy().mockResolvedValue({ id: "c1", content: "edited" });
    await api.updateComment(
      "c1",
      "edited",
      undefined,
      undefined,
      "the content as read",
      7,
    );

    expect(spy).toHaveBeenCalledWith(
      "/api/comments/c1",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(sentBody(spy)).toEqual({
      content: "edited",
      content_base: "the content as read",
      expected_revision: 7,
    });
  });

  it("omits BOTH gate keys when the caller passes neither", async () => {
    // Not cosmetic: the server treats the presence of either key as "this is a
    // strict edit" and will then refuse the write on any mismatch. A caller that
    // supplied no baseline must stay on the old last-write-wins path rather than
    // start sending `null` — which the server rejects with a 400 ("must be a
    // positive integer"), turning a working edit into an error.
    const spy = fetchSpy().mockResolvedValue({ id: "c1" });
    await api.updateComment("c1", "edited");

    const body = sentBody(spy);
    expect(body).not.toHaveProperty("content_base");
    expect(body).not.toHaveProperty("expected_revision");
    expect(body).toEqual({ content: "edited" });
  });

  it("sends a gate even when it is the only thing that changed", async () => {
    // `content_base: ""` is a legitimate baseline (an empty comment cannot be
    // edited, but the guard is on `!== undefined`, not on truthiness) — and a
    // falsy value silently dropped here would disable the gate for exactly the
    // callers that pass an explicit empty baseline.
    const spy = fetchSpy().mockResolvedValue({ id: "c1" });
    await api.updateComment("c1", "now non-empty", undefined, undefined, "", 3);

    expect(sentBody(spy)).toEqual({
      content: "now non-empty",
      content_base: "",
      expected_revision: 3,
    });
  });

  it("still sends attachment_ids and suppress_agent_ids alongside the gate", async () => {
    // The gate was added to an existing signature. A dropped parameter in the
    // middle would silently change what the OTHER fields mean — attachment_ids
    // omitted means "keep the set", so losing it is not a no-op.
    const spy = fetchSpy().mockResolvedValue({ id: "c1" });
    await api.updateComment("c1", "x", ["a1", "a2"], ["ag1"], "base", 5);

    expect(sentBody(spy)).toEqual({
      content: "x",
      attachment_ids: ["a1", "a2"],
      suppress_agent_ids: ["ag1"],
      content_base: "base",
      expected_revision: 5,
    });
  });
});

describe("updateIssue forwards expected_revision", () => {
  it("puts the token in the request body", async () => {
    const spy = fetchSpy().mockResolvedValue({ id: "i1" });
    await api.updateIssue("i1", {
      title: "new",
      description: "body",
      description_base: "old body",
      expected_revision: 12,
    });

    expect(spy).toHaveBeenCalledWith(
      "/api/issues/i1",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(sentBody(spy)).toEqual({
      title: "new",
      description: "body",
      description_base: "old body",
      expected_revision: 12,
    });
  });
});
