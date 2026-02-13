import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveBaseDir,
  resolveSessionDir,
  resolveSessionPath,
  resolveMediaDir,
  ensureSessionDir,
  readEntries,
  appendEntry,
  writeEntries,
} from "./storage.js";
import type { SessionEntry } from "./types.js";

describe("session/storage", () => {
  const testBaseDir = join(tmpdir(), `multica-session-test-${Date.now()}`);

  beforeEach(() => {
    if (existsSync(testBaseDir)) {
      rmSync(testBaseDir, { recursive: true });
    }
    mkdirSync(testBaseDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testBaseDir)) {
      rmSync(testBaseDir, { recursive: true });
    }
  });

  describe("resolveBaseDir", () => {
    it("should return custom baseDir when provided", () => {
      const result = resolveBaseDir({ baseDir: "/custom/path" });
      expect(result).toBe("/custom/path");
    });

    it("should return default path when no options provided", () => {
      const result = resolveBaseDir();
      expect(result).toContain(".super-multica");
      expect(result).toContain("sessions");
    });

    it("should return default path when options is empty", () => {
      const result = resolveBaseDir({});
      expect(result).toContain("sessions");
    });
  });

  describe("resolveSessionDir", () => {
    it("should return session directory path", () => {
      const result = resolveSessionDir("test-session", { baseDir: testBaseDir });
      expect(result).toBe(join(testBaseDir, "test-session"));
    });

    it("should handle session IDs with special characters", () => {
      const result = resolveSessionDir("session-123-abc", { baseDir: testBaseDir });
      expect(result).toBe(join(testBaseDir, "session-123-abc"));
    });
  });

  describe("resolveSessionPath", () => {
    it("should return path to session.jsonl file", () => {
      const result = resolveSessionPath("test-session", { baseDir: testBaseDir });
      expect(result).toBe(join(testBaseDir, "test-session", "session.jsonl"));
    });
  });

  describe("ensureSessionDir", () => {
    it("should create session directory if it does not exist", () => {
      const sessionId = "new-session";
      ensureSessionDir(sessionId, { baseDir: testBaseDir });

      const dir = join(testBaseDir, sessionId);
      expect(existsSync(dir)).toBe(true);
    });

    it("should not fail if directory already exists", () => {
      const sessionId = "existing-session";
      const dir = join(testBaseDir, sessionId);
      mkdirSync(dir, { recursive: true });

      expect(() => ensureSessionDir(sessionId, { baseDir: testBaseDir })).not.toThrow();
      expect(existsSync(dir)).toBe(true);
    });
  });

  describe("readEntries", () => {
    it("should return empty array for non-existent session", () => {
      const entries = readEntries("non-existent", { baseDir: testBaseDir });
      expect(entries).toEqual([]);
    });

    it("should return empty array for empty file", () => {
      const sessionId = "empty-session";
      const dir = join(testBaseDir, sessionId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "session.jsonl"), "");

      const entries = readEntries(sessionId, { baseDir: testBaseDir });
      expect(entries).toEqual([]);
    });

    it("should parse valid JSONL entries", () => {
      const sessionId = "valid-session";
      const dir = join(testBaseDir, sessionId);
      mkdirSync(dir, { recursive: true });

      const entry1: SessionEntry = {
        type: "message",
        message: { role: "user", content: "Hello" } as any,
        timestamp: 1000,
      };
      const entry2: SessionEntry = {
        type: "message",
        message: { role: "assistant", content: "Hi there" } as any,
        timestamp: 2000,
      };

      writeFileSync(
        join(dir, "session.jsonl"),
        `${JSON.stringify(entry1)}\n${JSON.stringify(entry2)}\n`
      );

      const entries = readEntries(sessionId, { baseDir: testBaseDir });
      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual(entry1);
      expect(entries[1]).toEqual(entry2);
    });

    it("should skip malformed lines", () => {
      const sessionId = "malformed-session";
      const dir = join(testBaseDir, sessionId);
      mkdirSync(dir, { recursive: true });

      const validEntry: SessionEntry = {
        type: "message",
        message: { role: "user", content: "Valid" } as any,
        timestamp: 1000,
      };

      writeFileSync(
        join(dir, "session.jsonl"),
        `${JSON.stringify(validEntry)}\nnot valid json\n{broken: json}\n`
      );

      const entries = readEntries(sessionId, { baseDir: testBaseDir });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual(validEntry);
    });

    it("should handle meta entries", () => {
      const sessionId = "meta-session";
      const dir = join(testBaseDir, sessionId);
      mkdirSync(dir, { recursive: true });

      const metaEntry: SessionEntry = {
        type: "meta",
        meta: { provider: "anthropic", model: "claude-3" },
        timestamp: 1000,
      };

      writeFileSync(join(dir, "session.jsonl"), `${JSON.stringify(metaEntry)}\n`);

      const entries = readEntries(sessionId, { baseDir: testBaseDir });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual(metaEntry);
    });

    it("should handle compaction entries", () => {
      const sessionId = "compaction-session";
      const dir = join(testBaseDir, sessionId);
      mkdirSync(dir, { recursive: true });

      const compactionEntry: SessionEntry = {
        type: "compaction",
        removed: 10,
        kept: 5,
        timestamp: 1000,
        tokensRemoved: 500,
        tokensKept: 200,
        reason: "tokens",
      };

      writeFileSync(join(dir, "session.jsonl"), `${JSON.stringify(compactionEntry)}\n`);

      const entries = readEntries(sessionId, { baseDir: testBaseDir });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual(compactionEntry);
    });
  });

  describe("appendEntry", () => {
    it("should create file and append entry", async () => {
      const sessionId = "append-session";
      const entry: SessionEntry = {
        type: "message",
        message: { role: "user", content: "Hello" } as any,
        timestamp: 1000,
      };

      await appendEntry(sessionId, entry, { baseDir: testBaseDir });

      const filePath = join(testBaseDir, sessionId, "session.jsonl");
      expect(existsSync(filePath)).toBe(true);

      const content = readFileSync(filePath, "utf8");
      expect(content).toBe(`${JSON.stringify(entry)}\n`);
    });

    it("should append to existing file", async () => {
      const sessionId = "append-existing";
      const entry1: SessionEntry = {
        type: "message",
        message: { role: "user", content: "First" } as any,
        timestamp: 1000,
      };
      const entry2: SessionEntry = {
        type: "message",
        message: { role: "assistant", content: "Second" } as any,
        timestamp: 2000,
      };

      await appendEntry(sessionId, entry1, { baseDir: testBaseDir });
      await appendEntry(sessionId, entry2, { baseDir: testBaseDir });

      const entries = readEntries(sessionId, { baseDir: testBaseDir });
      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual(entry1);
      expect(entries[1]).toEqual(entry2);
    });
  });

  describe("writeEntries", () => {
    it("should write all entries to file", async () => {
      const sessionId = "write-session";
      const entries: SessionEntry[] = [
        { type: "message", message: { role: "user", content: "One" } as any, timestamp: 1000 },
        { type: "message", message: { role: "assistant", content: "Two" } as any, timestamp: 2000 },
      ];

      await writeEntries(sessionId, entries, { baseDir: testBaseDir });

      const readBack = readEntries(sessionId, { baseDir: testBaseDir });
      expect(readBack).toHaveLength(2);
      expect(readBack).toEqual(entries);
    });

    it("should overwrite existing entries", async () => {
      const sessionId = "overwrite-session";

      await writeEntries(
        sessionId,
        [{ type: "message", message: { role: "user", content: "Old" } as any, timestamp: 1000 }],
        { baseDir: testBaseDir }
      );

      const newEntries: SessionEntry[] = [
        { type: "message", message: { role: "user", content: "New" } as any, timestamp: 2000 },
      ];
      await writeEntries(sessionId, newEntries, { baseDir: testBaseDir });

      const entries = readEntries(sessionId, { baseDir: testBaseDir });
      expect(entries).toHaveLength(1);
      expect((entries[0] as any).message.content).toBe("New");
    });

    it("should handle empty entries array", async () => {
      const sessionId = "empty-write";
      await writeEntries(sessionId, [], { baseDir: testBaseDir });

      const filePath = join(testBaseDir, sessionId, "session.jsonl");
      expect(existsSync(filePath)).toBe(true);
      expect(readFileSync(filePath, "utf8")).toBe("");
    });
  });

  describe("image externalization", () => {
    // Generate a large base64 string (>43KB to exceed MIN_EXTERNALIZE_B64_LENGTH)
    const largeBinarySize = 50_000; // 50KB binary
    const largeBuffer = Buffer.alloc(largeBinarySize, 0x42); // fill with 'B'
    const largeBase64 = largeBuffer.toString("base64");

    // Small base64 that should stay inline
    const smallBase64 = Buffer.alloc(100, 0x41).toString("base64");

    function makeImageEntry(imageData: string, sessionId = "img-session"): SessionEntry {
      return {
        type: "message",
        message: {
          role: "user",
          content: [
            { type: "text", text: "Read image file [image/png]" },
            { type: "image", data: imageData },
          ],
        } as any,
        timestamp: Date.now(),
      };
    }

    function makeFormatBEntry(imageData: string): SessionEntry {
      return {
        type: "message",
        message: {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", data: imageData } },
          ],
        } as any,
        timestamp: Date.now(),
      };
    }

    function makeToolResultEntry(imageData: string): SessionEntry {
      return {
        type: "message",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "test-id",
              content: [
                { type: "text", text: "Read image file [image/png]" },
                { type: "image", data: imageData },
              ],
            },
          ],
        } as any,
        timestamp: Date.now(),
      };
    }

    it("should externalize Format A image and create media file", async () => {
      const sessionId = "ext-format-a";
      const entry = makeImageEntry(largeBase64);

      await appendEntry(sessionId, entry, { baseDir: testBaseDir });

      // Read raw JSONL — should have $ref, not data
      const rawContent = readFileSync(join(testBaseDir, sessionId, "session.jsonl"), "utf8");
      const rawEntry = JSON.parse(rawContent.trim());
      expect(rawEntry.message.content[1].$ref).toMatch(/^media\/[a-f0-9]+\.bin$/);
      expect(rawEntry.message.content[1].data).toBeUndefined();

      // Media file should exist
      const mediaDir = resolveMediaDir(sessionId, { baseDir: testBaseDir });
      const files = existsSync(mediaDir)
        ? require("node:fs").readdirSync(mediaDir) as string[]
        : [];
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^[a-f0-9]+\.bin$/);

      // Binary content should match original
      const binPath = join(mediaDir, files[0]!);
      const savedBuffer = readFileSync(binPath);
      expect(savedBuffer).toEqual(largeBuffer);
    });

    it("should externalize Format B image (Anthropic source style)", async () => {
      const sessionId = "ext-format-b";
      const entry = makeFormatBEntry(largeBase64);

      await appendEntry(sessionId, entry, { baseDir: testBaseDir });

      const rawContent = readFileSync(join(testBaseDir, sessionId, "session.jsonl"), "utf8");
      const rawEntry = JSON.parse(rawContent.trim());
      expect(rawEntry.message.content[0].source.type).toBe("$ref");
      expect(rawEntry.message.content[0].source.path).toMatch(/^media\/[a-f0-9]+\.bin$/);
    });

    it("should restore externalized images on read (round-trip)", async () => {
      const sessionId = "ext-roundtrip";
      const entry = makeImageEntry(largeBase64);

      await appendEntry(sessionId, entry, { baseDir: testBaseDir });

      const entries = readEntries(sessionId, { baseDir: testBaseDir });
      expect(entries).toHaveLength(1);
      const content = (entries[0] as any).message.content;
      expect(content[1].type).toBe("image");
      expect(content[1].data).toBe(largeBase64);
      expect(content[1].$ref).toBeUndefined();
    });

    it("should restore Format B images on read", async () => {
      const sessionId = "ext-roundtrip-b";
      const entry = makeFormatBEntry(largeBase64);

      await appendEntry(sessionId, entry, { baseDir: testBaseDir });

      const entries = readEntries(sessionId, { baseDir: testBaseDir });
      expect(entries).toHaveLength(1);
      const block = (entries[0] as any).message.content[0];
      expect(block.source.type).toBe("base64");
      expect(block.source.data).toBe(largeBase64);
    });

    it("should handle old sessions with inline base64 (backward compat)", () => {
      const sessionId = "old-inline";
      const dir = join(testBaseDir, sessionId);
      mkdirSync(dir, { recursive: true });

      // Write raw JSONL with inline base64 (old format, no $ref)
      const entry = makeImageEntry(largeBase64);
      writeFileSync(join(dir, "session.jsonl"), `${JSON.stringify(entry)}\n`);

      const entries = readEntries(sessionId, { baseDir: testBaseDir });
      expect(entries).toHaveLength(1);
      const content = (entries[0] as any).message.content;
      expect(content[1].data).toBe(largeBase64);
    });

    it("should return placeholder for missing media file", () => {
      const sessionId = "missing-media";
      const dir = join(testBaseDir, sessionId);
      mkdirSync(dir, { recursive: true });

      // Write JSONL with $ref but no media file
      const rawEntry = {
        type: "message",
        message: {
          role: "user",
          content: [
            { type: "image", $ref: "media/deadbeef.bin" },
          ],
        },
        timestamp: Date.now(),
      };
      writeFileSync(join(dir, "session.jsonl"), `${JSON.stringify(rawEntry)}\n`);

      const entries = readEntries(sessionId, { baseDir: testBaseDir });
      expect(entries).toHaveLength(1);
      const block = (entries[0] as any).message.content[0];
      expect(block.type).toBe("text");
      expect(block.text).toContain("unavailable");
    });

    it("should deduplicate same image data", async () => {
      const sessionId = "ext-dedup";
      const entry1 = makeImageEntry(largeBase64);
      const entry2 = makeImageEntry(largeBase64);

      await appendEntry(sessionId, entry1, { baseDir: testBaseDir });
      await appendEntry(sessionId, entry2, { baseDir: testBaseDir });

      const mediaDir = resolveMediaDir(sessionId, { baseDir: testBaseDir });
      const files = require("node:fs").readdirSync(mediaDir) as string[];
      expect(files).toHaveLength(1); // same hash = same file
    });

    it("should keep small images inline", async () => {
      const sessionId = "ext-small";
      const entry = makeImageEntry(smallBase64);

      await appendEntry(sessionId, entry, { baseDir: testBaseDir });

      // Read raw JSONL — small image should still have data, not $ref
      const rawContent = readFileSync(join(testBaseDir, sessionId, "session.jsonl"), "utf8");
      const rawEntry = JSON.parse(rawContent.trim());
      expect(rawEntry.message.content[1].data).toBe(smallBase64);
      expect(rawEntry.message.content[1].$ref).toBeUndefined();

      // No media dir should be created
      const mediaDir = resolveMediaDir(sessionId, { baseDir: testBaseDir });
      expect(existsSync(mediaDir)).toBe(false);
    });

    it("should not affect non-image entries", async () => {
      const sessionId = "ext-noimg";
      const entry: SessionEntry = {
        type: "message",
        message: { role: "assistant", content: "Just text response" } as any,
        timestamp: 1000,
      };

      await appendEntry(sessionId, entry, { baseDir: testBaseDir });

      const rawContent = readFileSync(join(testBaseDir, sessionId, "session.jsonl"), "utf8");
      expect(rawContent.trim()).toBe(JSON.stringify(entry));
    });

    it("should handle images inside nested tool_result content", async () => {
      const sessionId = "ext-tool-result";
      const entry = makeToolResultEntry(largeBase64);

      await appendEntry(sessionId, entry, { baseDir: testBaseDir });

      // Raw JSONL should have $ref inside tool_result
      const rawContent = readFileSync(join(testBaseDir, sessionId, "session.jsonl"), "utf8");
      const rawEntry = JSON.parse(rawContent.trim());
      const toolResult = rawEntry.message.content[0];
      expect(toolResult.content[1].$ref).toMatch(/^media\/[a-f0-9]+\.bin$/);

      // Round-trip should restore
      const entries = readEntries(sessionId, { baseDir: testBaseDir });
      const restored = (entries[0] as any).message.content[0].content[1];
      expect(restored.data).toBe(largeBase64);
      expect(restored.$ref).toBeUndefined();
    });

    it("should externalize via writeEntries (compaction path)", async () => {
      const sessionId = "ext-write-entries";
      const entry = makeImageEntry(largeBase64);

      await writeEntries(sessionId, [entry], { baseDir: testBaseDir });

      // Should be externalized
      const rawContent = readFileSync(join(testBaseDir, sessionId, "session.jsonl"), "utf8");
      const rawEntry = JSON.parse(rawContent.trim());
      expect(rawEntry.message.content[1].$ref).toMatch(/^media\/[a-f0-9]+\.bin$/);

      // Round-trip
      const entries = readEntries(sessionId, { baseDir: testBaseDir });
      expect((entries[0] as any).message.content[1].data).toBe(largeBase64);
    });
  });
});
