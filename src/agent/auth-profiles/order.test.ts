import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveAuthProfileOrder, listProfilesForProvider } from "./order.js";
import type { AuthProfileStore } from "./types.js";

// Mock credentialManager
vi.mock("../credentials.js", () => {
  let _profiles: Record<string, { apiKey?: string }> = {};
  let _order: Record<string, string[]> = {};

  return {
    credentialManager: {
      listProfileIdsForProvider(provider: string): string[] {
        return Object.keys(_profiles).filter(
          (key) => key === provider || key.startsWith(`${provider}:`),
        );
      },
      getLlmOrder(provider: string): string[] | undefined {
        return _order[provider];
      },
      // Test helpers
      __setProfiles(profiles: Record<string, { apiKey?: string }>) {
        _profiles = profiles;
      },
      __setOrder(order: Record<string, string[]>) {
        _order = order;
      },
    },
  };
});

// Import the mock to use test helpers
import { credentialManager } from "../credentials.js";
const mock = credentialManager as unknown as {
  __setProfiles: (p: Record<string, { apiKey?: string }>) => void;
  __setOrder: (o: Record<string, string[]>) => void;
};

beforeEach(() => {
  mock.__setProfiles({});
  mock.__setOrder({});
});

// ============================================================
// listProfilesForProvider
// ============================================================

describe("listProfilesForProvider", () => {
  it("returns profiles matching the provider", () => {
    mock.__setProfiles({
      anthropic: { apiKey: "sk-1" },
      "anthropic:backup": { apiKey: "sk-2" },
      openai: { apiKey: "sk-3" },
    });
    expect(listProfilesForProvider("anthropic")).toEqual([
      "anthropic",
      "anthropic:backup",
    ]);
  });

  it("returns empty array when no profiles match", () => {
    mock.__setProfiles({ openai: { apiKey: "sk-1" } });
    expect(listProfilesForProvider("anthropic")).toEqual([]);
  });
});

// ============================================================
// resolveAuthProfileOrder
// ============================================================

describe("resolveAuthProfileOrder", () => {
  const now = 1_000_000;

  it("returns round-robin order by lastUsed when no explicit order", () => {
    mock.__setProfiles({
      "anthropic": { apiKey: "sk-1" },
      "anthropic:b": { apiKey: "sk-2" },
      "anthropic:c": { apiKey: "sk-3" },
    });
    const store: AuthProfileStore = {
      version: 1,
      usageStats: {
        "anthropic": { lastUsed: 300 },
        "anthropic:b": { lastUsed: 100 },
        "anthropic:c": { lastUsed: 200 },
      },
    };

    const order = resolveAuthProfileOrder("anthropic", store, now);
    // Sorted by lastUsed ascending: b(100) -> c(200) -> default(300)
    expect(order).toEqual(["anthropic:b", "anthropic:c", "anthropic"]);
  });

  it("respects explicit order from config", () => {
    mock.__setProfiles({
      "anthropic": { apiKey: "sk-1" },
      "anthropic:b": { apiKey: "sk-2" },
      "anthropic:c": { apiKey: "sk-3" },
    });
    mock.__setOrder({ anthropic: ["anthropic:c", "anthropic", "anthropic:b"] });

    const store: AuthProfileStore = { version: 1 };
    const order = resolveAuthProfileOrder("anthropic", store, now);
    expect(order).toEqual(["anthropic:c", "anthropic", "anthropic:b"]);
  });

  it("pushes cooldown profiles to the end", () => {
    mock.__setProfiles({
      "anthropic": { apiKey: "sk-1" },
      "anthropic:b": { apiKey: "sk-2" },
      "anthropic:c": { apiKey: "sk-3" },
    });
    const store: AuthProfileStore = {
      version: 1,
      usageStats: {
        "anthropic": { lastUsed: 100 },
        "anthropic:b": { lastUsed: 200, cooldownUntil: now + 5000 },
        "anthropic:c": { lastUsed: 300 },
      },
    };

    const order = resolveAuthProfileOrder("anthropic", store, now);
    // anthropic and anthropic:c are available; anthropic:b is in cooldown -> pushed to end
    expect(order).toEqual(["anthropic", "anthropic:c", "anthropic:b"]);
  });

  it("sorts cooldown profiles by earliest recovery", () => {
    mock.__setProfiles({
      "anthropic": { apiKey: "sk-1" },
      "anthropic:b": { apiKey: "sk-2" },
      "anthropic:c": { apiKey: "sk-3" },
    });
    const store: AuthProfileStore = {
      version: 1,
      usageStats: {
        "anthropic": { cooldownUntil: now + 10_000 },
        "anthropic:b": { cooldownUntil: now + 1_000 },
        "anthropic:c": { cooldownUntil: now + 5_000 },
      },
    };

    const order = resolveAuthProfileOrder("anthropic", store, now);
    // All in cooldown, sorted by soonest recovery
    expect(order).toEqual(["anthropic:b", "anthropic:c", "anthropic"]);
  });

  it("deduplicates profile IDs", () => {
    mock.__setProfiles({
      "anthropic": { apiKey: "sk-1" },
      "anthropic:b": { apiKey: "sk-2" },
    });
    // Explicit order has duplicate
    mock.__setOrder({ anthropic: ["anthropic", "anthropic", "anthropic:b"] });

    const store: AuthProfileStore = { version: 1 };
    const order = resolveAuthProfileOrder("anthropic", store, now);
    expect(order).toEqual(["anthropic", "anthropic:b"]);
  });

  it("appends unlisted profiles to explicit order", () => {
    mock.__setProfiles({
      "anthropic": { apiKey: "sk-1" },
      "anthropic:b": { apiKey: "sk-2" },
      "anthropic:c": { apiKey: "sk-3" },
    });
    // Only lists one profile in explicit order
    mock.__setOrder({ anthropic: ["anthropic:b"] });

    const store: AuthProfileStore = { version: 1 };
    const order = resolveAuthProfileOrder("anthropic", store, now);
    // anthropic:b first (explicit), then the rest
    expect(order[0]).toBe("anthropic:b");
    expect(order).toHaveLength(3);
    expect(order).toContain("anthropic");
    expect(order).toContain("anthropic:c");
  });
});
