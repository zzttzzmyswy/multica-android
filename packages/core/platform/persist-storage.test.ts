import { describe, it, expect, vi } from "vitest";
import { createPersistStorage } from "./persist-storage";
import type { StorageAdapter } from "../types/storage";

function mockAdapter(): StorageAdapter {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((k) => store.get(k) ?? null),
    setItem: vi.fn((k, v) => store.set(k, v)),
    removeItem: vi.fn((k) => store.delete(k)),
  };
}

describe("createPersistStorage", () => {
  it("delegates to StorageAdapter without namespace", () => {
    const adapter = mockAdapter();
    const storage = createPersistStorage(adapter);

    storage.setItem("key", JSON.stringify("value"));
    expect(adapter.setItem).toHaveBeenCalledWith(
      "key",
      JSON.stringify("value"),
    );

    const result = storage.getItem("key");
    expect(adapter.getItem).toHaveBeenCalledWith("key");
    expect(result).toEqual(JSON.stringify("value"));
  });

  it("namespaces keys when wsId is provided", () => {
    const adapter = mockAdapter();
    const storage = createPersistStorage(adapter, "ws_123");

    storage.setItem("draft", JSON.stringify({ title: "test" }));
    expect(adapter.setItem).toHaveBeenCalledWith(
      "draft:ws_123",
      JSON.stringify({ title: "test" }),
    );

    storage.getItem("draft");
    expect(adapter.getItem).toHaveBeenCalledWith("draft:ws_123");
  });

  it("removeItem namespaces correctly", () => {
    const adapter = mockAdapter();
    const storage = createPersistStorage(adapter, "ws_abc");

    storage.removeItem("draft");
    expect(adapter.removeItem).toHaveBeenCalledWith("draft:ws_abc");
  });

  it("returns null for missing keys", () => {
    const adapter = mockAdapter();
    const storage = createPersistStorage(adapter);

    const result = storage.getItem("nonexistent");
    expect(result).toBeNull();
  });
});
