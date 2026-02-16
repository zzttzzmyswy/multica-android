import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DeviceStore } from "./device-store.js";

describe("DeviceStore", () => {
  const testDirs: string[] = [];

  afterEach(() => {
    for (const dir of testDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    testDirs.length = 0;
  });

  it("stores token with conversation scope and enforces one-time consumption", () => {
    const dir = mkdtempSync(join(tmpdir(), "device-store-test-"));
    testDirs.push(dir);
    const store = new DeviceStore({ devicesFile: join(dir, "whitelist.json") });

    const expiresAt = Date.now() + 60_000;
    store.registerToken("token-1", "agent-1", "conv-1", expiresAt);

    expect(store.consumeToken("token-1")).toEqual({
      agentId: "agent-1",
      conversationId: "conv-1",
    });
    expect(store.consumeToken("token-1")).toBeNull();
  });

  it("enforces conversation-level authorization and supports adding scopes", () => {
    const dir = mkdtempSync(join(tmpdir(), "device-store-test-"));
    testDirs.push(dir);
    const devicesFile = join(dir, "whitelist.json");
    const store = new DeviceStore({ devicesFile });

    store.allowDevice("dev-1", "agent-1", "conv-1");
    expect(store.isAllowed("dev-1")).toEqual({
      agentId: "agent-1",
      conversationIds: ["conv-1"],
    });
    expect(store.isAllowed("dev-1", "conv-1")).toEqual({
      agentId: "agent-1",
      conversationIds: ["conv-1"],
    });
    expect(store.isAllowed("dev-1", "conv-2")).toBeNull();

    expect(store.allowConversation("dev-1", "conv-2")).toBe(true);
    expect(store.isAllowed("dev-1", "conv-2")).toEqual({
      agentId: "agent-1",
      conversationIds: ["conv-1", "conv-2"],
    });

    const restored = new DeviceStore({ devicesFile });
    expect(restored.isAllowed("dev-1", "conv-1")).not.toBeNull();
    expect(restored.isAllowed("dev-1", "conv-2")).not.toBeNull();
  });

  it("migrates legacy entries without conversationIds using agentId as fallback scope", () => {
    const dir = mkdtempSync(join(tmpdir(), "device-store-test-"));
    testDirs.push(dir);
    const devicesFile = join(dir, "whitelist.json");
    writeFileSync(
      devicesFile,
      JSON.stringify({
        version: 1,
        devices: [
          {
            deviceId: "legacy-dev",
            agentId: "legacy-agent",
            addedAt: 123,
          },
        ],
      }),
      "utf-8",
    );

    const store = new DeviceStore({ devicesFile });
    expect(store.isAllowed("legacy-dev")).toEqual({
      agentId: "legacy-agent",
      conversationIds: ["legacy-agent"],
    });
    expect(store.isAllowed("legacy-dev", "legacy-agent")).not.toBeNull();
  });
});

