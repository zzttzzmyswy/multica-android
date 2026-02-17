import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("hub agent store", () => {
  let testDir: string;
  let previousDataDir: string | undefined;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "multica-agent-store-"));
    previousDataDir = process.env.SMC_DATA_DIR;
    process.env.SMC_DATA_DIR = testDir;
    vi.resetModules();
  });

  afterEach(() => {
    if (previousDataDir === undefined) {
      delete process.env.SMC_DATA_DIR;
    } else {
      process.env.SMC_DATA_DIR = previousDataDir;
    }
    vi.resetModules();
    rmSync(testDir, { recursive: true, force: true });
  });

  it("migrates legacy single-layer records into agent+conversation snapshot", async () => {
    const agentsDir = join(testDir, "agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(
      join(agentsDir, "agents.json"),
      JSON.stringify([
        { id: "legacy-a", createdAt: 123 },
      ], null, 2),
      "utf-8",
    );

    const store = await import("./agent-store.js");
    const snapshot = store.loadHubStoreSnapshot();

    expect(snapshot.version).toBe(2);
    expect(snapshot.agents).toEqual([{ id: "legacy-a", createdAt: 123 }]);
    expect(snapshot.conversations).toEqual([{ id: "legacy-a", agentId: "legacy-a", createdAt: 123 }]);

    const persisted = JSON.parse(readFileSync(join(agentsDir, "agents.json"), "utf-8")) as {
      version: number;
    };
    expect(persisted.version).toBe(2);
  });

  it("upserts conversations and auto-creates missing agents", async () => {
    const store = await import("./agent-store.js");

    store.upsertConversationRecord({
      id: "conv-1",
      agentId: "agent-1",
      createdAt: 100,
    });

    const snapshot = store.loadHubStoreSnapshot();
    expect(snapshot.agents).toEqual([{ id: "agent-1", createdAt: 100 }]);
    expect(snapshot.conversations).toEqual([
      { id: "conv-1", agentId: "agent-1", createdAt: 100 },
    ]);
  });

  it("removes empty agent after last conversation is deleted", async () => {
    const store = await import("./agent-store.js");

    store.upsertConversationRecord({ id: "conv-1", agentId: "agent-1", createdAt: 100 });
    store.upsertConversationRecord({ id: "conv-2", agentId: "agent-1", createdAt: 101 });
    store.removeConversationRecordById("conv-1");
    expect(store.loadHubStoreSnapshot().agents).toEqual([{ id: "agent-1", createdAt: 100 }]);

    store.removeConversationRecordById("conv-2");
    const snapshot = store.loadHubStoreSnapshot();
    expect(snapshot.agents).toEqual([]);
    expect(snapshot.conversations).toEqual([]);
  });
});
