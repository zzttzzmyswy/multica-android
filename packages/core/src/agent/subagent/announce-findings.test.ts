import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeEntries } from "../session/storage.js";
import { readLatestAssistantReply } from "./announce.js";
import type { SessionEntry } from "../session/types.js";

describe("readLatestAssistantReply", () => {
  let testDir: string;

  afterEach(() => {
    if (testDir) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  async function seedSession(sessionId: string, entries: SessionEntry[]) {
    await writeEntries(sessionId, entries, { baseDir: testDir });
  }

  it("returns the latest non-empty assistant text when the last assistant message is tool-only", async () => {
    testDir = mkdtempSync(join(tmpdir(), "announce-test-"));
    const sessionId = "child-session-1";

    await seedSession(sessionId, [
      {
        type: "message",
        timestamp: 1,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "南京天气：晴，12°C。" }],
        },
      } as SessionEntry,
      {
        type: "message",
        timestamp: 2,
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "tool-1", name: "weather", arguments: { city: "Nanjing" } }],
        },
      } as SessionEntry,
    ]);

    const result = readLatestAssistantReply(sessionId, { baseDir: testDir });
    expect(result).toBe("南京天气：晴，12°C。");
  });

  it("falls back to latest toolResult text when no assistant text exists", async () => {
    testDir = mkdtempSync(join(tmpdir(), "announce-test-"));
    const sessionId = "child-session-2";

    await seedSession(sessionId, [
      {
        type: "message",
        timestamp: 1,
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "tool-2", name: "weather", arguments: { city: "Nanjing" } }],
        },
      } as SessionEntry,
      {
        type: "message",
        timestamp: 2,
        message: {
          role: "toolResult",
          toolCallId: "tool-2",
          toolName: "weather",
          content: [{ type: "text", text: "{\"city\":\"Nanjing\",\"tempC\":12,\"condition\":\"Sunny\"}" }],
          isError: false,
        },
      } as SessionEntry,
    ]);

    const result = readLatestAssistantReply(sessionId, { baseDir: testDir });
    expect(result).toContain("\"city\":\"Nanjing\"");
    expect(result).toContain("\"condition\":\"Sunny\"");
  });
});
