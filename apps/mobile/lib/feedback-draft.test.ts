import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  get: vi.fn(async (): Promise<unknown> => null),
  set: vi.fn(async (_key: string, _value: string) => {}),
  del: vi.fn(async (_key: string) => {}),
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: store.get,
  setItemAsync: store.set,
  deleteItemAsync: store.del,
}));

import {
  clearFeedbackDraft,
  loadFeedbackDraft,
  saveFeedbackDraft,
} from "./feedback-draft";

beforeEach(() => {
  vi.clearAllMocks();
  store.get.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("feedback draft persistence (iteration-100)", () => {
  it("loads an empty draft when nothing is stored", async () => {
    expect(await loadFeedbackDraft()).toBe("");
  });

  it("loads the saved message", async () => {
    store.get.mockResolvedValue(JSON.stringify({ message: "草稿内容" }));
    expect(await loadFeedbackDraft()).toBe("草稿内容");
  });

  it("ignores a corrupt / unexpected value shape", async () => {
    store.get.mockResolvedValue("not json");
    expect(await loadFeedbackDraft()).toBe("");
    store.get.mockResolvedValue(JSON.stringify({ message: 42 }));
    expect(await loadFeedbackDraft()).toBe("");
  });

  it("tolerates a SecureStore read failure (best-effort, never throws)", async () => {
    store.get.mockRejectedValue(new Error("secure store unavailable"));
    expect(await loadFeedbackDraft()).toBe("");
  });

  it("saves a message as the web-compatible { message } shape", async () => {
    await saveFeedbackDraft("hl 支持一下深色主题");
    expect(store.set).toHaveBeenCalledWith(
      "multica_feedback_draft",
      JSON.stringify({ message: "hl 支持一下深色主题" }),
    );
  });

  it("prunes the draft when the message becomes empty", async () => {
    await saveFeedbackDraft("   ");
    expect(store.del).toHaveBeenCalledWith("multica_feedback_draft");
    expect(store.set).not.toHaveBeenCalled();
  });

  it("tolerates a SecureStore write failure", async () => {
    store.set.mockRejectedValue(new Error("full"));
    await expect(saveFeedbackDraft("x")).resolves.toBeUndefined();
  });

  it("clears the draft", async () => {
    await clearFeedbackDraft();
    expect(store.del).toHaveBeenCalledWith("multica_feedback_draft");
  });
});