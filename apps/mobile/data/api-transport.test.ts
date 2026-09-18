import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ApiClient pulls in native modules at module scope — stub them before the
// (dynamically imported) module evaluates, same chain as api-feedback.test.ts.
process.env.EXPO_PUBLIC_API_URL = "https://api.test";

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

/** Reach the private transport method the way every endpoint does. */
const rawFetch = () =>
  (
    api as unknown as {
      fetch: (path: string, init?: RequestInit) => Promise<unknown>;
    }
  ).fetch("/api/ping");

describe("ApiClient transport failures normalise to ApiError(status 0)", () => {
  it("wraps RN's fetch rejection (unreachable host / DNS failure)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("Network request failed"),
    );

    const err = await rawFetch().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as InstanceType<typeof ApiError>).status).toBe(0);
    expect((err as Error).message).toMatch(/network/i);
  });

  it("wraps a timeout abort with a status-0 ApiError", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );

    const err = await rawFetch().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as InstanceType<typeof ApiError>).status).toBe(0);
    expect((err as Error).message).toMatch(/timed out/i);
  });

  it("propagates a caller-side cancellation untouched", async () => {
    const controller = new AbortController();
    const abortErr = Object.assign(new Error("cancelled"), {
      name: "AbortError",
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      controller.abort();
      throw abortErr;
    });

    const err = await (
      api as unknown as {
        fetch: (path: string, init?: RequestInit) => Promise<unknown>;
      }
    ).fetch("/api/ping", { signal: controller.signal }).catch((e: unknown) => e);

    expect(err).toBe(abortErr);
    expect(err).not.toBeInstanceOf(ApiError);
  });

  it("still returns the parsed body on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(rawFetch()).resolves.toEqual({ ok: true });
  });
});