/**
 * Unit tests for the mobile server-config module — the single source of
 * truth for the runtime API base URL override.
 *
 * The module keeps module-level memory (`customBaseUrl`) initialised from
 * `process.env.EXPO_PUBLIC_API_URL` at load, plus a live override stored in
 * `expo-secure-store`. To keep cases hermetic each test reloads the module
 * (via `vi.resetModules`) so the env default and the custom cache start
 * fresh. `expo-secure-store` is mocked as an in-memory KV store.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const secureStoreMap = new Map<string, string>();

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (key: string) => secureStoreMap.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    secureStoreMap.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    secureStoreMap.delete(key);
  }),
}));

/** Reload the module fresh so module-level state (env default + custom
 *  override cache + listener set) starts empty for each case. */
async function loadFreshServerConfig(
  envUrl?: string,
  webUrl?: string,
) {
  vi.unstubAllEnvs();
  if (envUrl !== undefined) vi.stubEnv("EXPO_PUBLIC_API_URL", envUrl);
  if (webUrl !== undefined) vi.stubEnv("EXPO_PUBLIC_WEB_URL", webUrl);
  vi.resetModules();
  return await import("./server-config");
}

beforeEach(() => {
  secureStoreMap.clear();
});

describe("getApiBaseUrl", () => {
  it("returns the build-time env default when no override is set", async () => {
    const mod = await loadFreshServerConfig("https://default.example.com");
    expect(mod.getApiBaseUrl()).toBe("https://default.example.com");
  });

  it("prefers the persisted override once set", async () => {
    const mod = await loadFreshServerConfig("https://default.example.com");
    await mod.setApiBaseUrl("https://custom.example.com");
    expect(mod.getApiBaseUrl()).toBe("https://custom.example.com");
  });

  it("throws when neither an env default nor an override exists", async () => {
    const mod = await loadFreshServerConfig(); // env unset, no stored override
    expect(() => mod.getApiBaseUrl()).toThrow(/base URL is undefined/i);
  });
});

describe("getDisplayBaseUrl", () => {
  it("shows the env default when no override is set", async () => {
    const mod = await loadFreshServerConfig("https://default.example.com");
    expect(mod.getDisplayBaseUrl()).toBe("https://default.example.com");
  });

  it("shows the override once set", async () => {
    const mod = await loadFreshServerConfig("https://default.example.com");
    await mod.setApiBaseUrl("https://custom.example.com");
    expect(mod.getDisplayBaseUrl()).toBe("https://custom.example.com");
  });

  it("does not throw when no server is configured — yields an empty string", async () => {
    const mod = await loadFreshServerConfig();
    expect(mod.getDisplayBaseUrl()).toBe("");
  });

  it("falls back to the env default after reset", async () => {
    const mod = await loadFreshServerConfig("https://default.example.com");
    await mod.setApiBaseUrl("https://custom.example.com");
    await mod.resetApiBaseUrl();
    expect(mod.getDisplayBaseUrl()).toBe("https://default.example.com");
  });
});

describe("hasCustomApiBaseUrl / getCustomApiBaseUrl", () => {
  it("reports false before any override, true after set, false after reset", async () => {
    const mod = await loadFreshServerConfig("https://default.example.com");
    expect(mod.hasCustomApiBaseUrl()).toBe(false);
    expect(mod.getCustomApiBaseUrl()).toBeNull();

    await mod.setApiBaseUrl("https://custom.example.com");
    expect(mod.hasCustomApiBaseUrl()).toBe(true);
    expect(mod.getCustomApiBaseUrl()).toBe("https://custom.example.com");

    await mod.resetApiBaseUrl();
    expect(mod.hasCustomApiBaseUrl()).toBe(false);
    expect(mod.getCustomApiBaseUrl()).toBeNull();
  });
});

describe("normalizeServerBaseUrl", () => {
  it("accepts an http(s) absolute URL and strips a trailing slash", async () => {
    const mod = await loadFreshServerConfig();
    expect(mod.normalizeServerBaseUrl("https://api.example.com/")).toBe(
      "https://api.example.com",
    );
    expect(mod.normalizeServerBaseUrl("  http://localhost:8080/  ")).toBe(
      "http://localhost:8080",
    );
  });

  it("rejects non-http(s) protocols and hostless URLs", async () => {
    const mod = await loadFreshServerConfig();
    expect(mod.normalizeServerBaseUrl("ftp://api.example.com")).toBeNull();
    expect(mod.normalizeServerBaseUrl("https://")).toBeNull();
    expect(mod.normalizeServerBaseUrl("not a url")).toBeNull();
    expect(mod.normalizeServerBaseUrl("")).toBeNull();
    expect(mod.normalizeServerBaseUrl("   ")).toBeNull();
  });
});

describe("setApiBaseUrl", () => {
  it("persists the override to SecureStore and makes it effective", async () => {
    const mod = await loadFreshServerConfig("https://default.example.com");
    await mod.setApiBaseUrl("https://custom.example.com");
    expect(mod.getApiBaseUrl()).toBe("https://custom.example.com");
    expect(secureStoreMap.get("multica_server_base_url")).toBe(
      "https://custom.example.com",
    );
  });

  it("rejects an invalid URL and leaves state unchanged", async () => {
    const mod = await loadFreshServerConfig("https://default.example.com");
    await expect(mod.setApiBaseUrl("nope")).rejects.toThrow(/valid server URL/i);
    expect(mod.getApiBaseUrl()).toBe("https://default.example.com");
    expect(secureStoreMap.size).toBe(0);
  });
});

describe("loadApiBaseUrl", () => {
  it("restores a persisted override into the in-memory cache on startup", async () => {
    // Seed the mock as a prior session would have.
    secureStoreMap.set("multica_server_base_url", "https://stored.example.com");

    const mod = await loadFreshServerConfig("https://default.example.com");
    const restored = await mod.loadApiBaseUrl();
    expect(restored).toBe("https://stored.example.com");
    expect(mod.getApiBaseUrl()).toBe("https://stored.example.com");
    expect(mod.getDisplayBaseUrl()).toBe("https://stored.example.com");
  });

  it("returns null and keeps the env default when nothing was stored", async () => {
    const mod = await loadFreshServerConfig("https://default.example.com");
    expect(await mod.loadApiBaseUrl()).toBeNull();
    expect(mod.getApiBaseUrl()).toBe("https://default.example.com");
  });
});

describe("resetApiBaseUrl", () => {
  it("clears the override and deletes it from SecureStore", async () => {
    const mod = await loadFreshServerConfig("https://default.example.com");
    await mod.setApiBaseUrl("https://custom.example.com");
    await mod.resetApiBaseUrl();
    expect(mod.getApiBaseUrl()).toBe("https://default.example.com");
    expect(secureStoreMap.get("multica_server_base_url")).toBeUndefined();
  });
});

describe("subscribeApiBaseUrl", () => {
  it("notifies subscribers on set and reset, and unsubscribes", async () => {
    const mod = await loadFreshServerConfig("https://default.example.com");
    const seen: string[] = [];
    const unsubscribe = mod.subscribeApiBaseUrl(() => {
      seen.push(mod.getApiBaseUrl());
    });

    await mod.setApiBaseUrl("https://custom.example.com");
    expect(seen).toEqual(["https://custom.example.com"]);

    await mod.resetApiBaseUrl();
    expect(seen).toEqual([
      "https://custom.example.com",
      "https://default.example.com",
    ]);

    unsubscribe();
    await mod.setApiBaseUrl("https://again.example.com");
    expect(seen).toHaveLength(2); // no new notification after unsubscribe
  });
});

describe("getWebBaseUrl", () => {
  it("prefers an explicit EXPO_PUBLIC_WEB_URL when set", async () => {
    const mod = await loadFreshServerConfig("https://api.example.com", "https://www.example.com");
    expect(mod.getWebBaseUrl()).toBe("https://www.example.com");
  });

  it("derives the web origin from the effective API base when web env is unset", async () => {
    const mod = await loadFreshServerConfig("https://mu.zztweb.top");
    expect(mod.getWebBaseUrl()).toBe("https://mu.zztweb.top");
  });

  it("honors the runtime server override when deriving the web origin", async () => {
    const mod = await loadFreshServerConfig();
    await mod.setApiBaseUrl("https://selfhost.example.net");
    expect(mod.getWebBaseUrl()).toBe("https://selfhost.example.net");
  });

  it("strips any path from the API base when deriving the origin", async () => {
    const mod = await loadFreshServerConfig("https://portal.example.com/prefix");
    expect(mod.getWebBaseUrl()).toBe("https://portal.example.com");
  });

  it("strips a leading api. subdomain (self-host web/API split layout)", async () => {
    const mod = await loadFreshServerConfig("https://api.mu.zztweb.top");
    expect(mod.getWebBaseUrl()).toBe("https://mu.zztweb.top");
  });

  it("a runtime server override beats a baked web env (self-host deep links)", async () => {
    const mod = await loadFreshServerConfig(
      "https://api.example.com",
      "https://multica.ai",
    );
    await mod.setApiBaseUrl("https://api.mu.zztweb.top");
    expect(mod.getWebBaseUrl()).toBe("https://mu.zztweb.top");
  });

  it("keeps a non-api host verbatim when no web env is set", async () => {
    const mod = await loadFreshServerConfig("https://selfhost.example.net");
    expect(mod.getWebBaseUrl()).toBe("https://selfhost.example.net");
  });

  it("never throws — yields empty string when neither a web env nor any API base exists", async () => {
    const mod = await loadFreshServerConfig();
    expect(mod.getWebBaseUrl()).toBe("");
  });
});
