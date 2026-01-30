import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  validateKey,
  memoryGet,
  memorySet,
  memoryDelete,
  memoryList,
  getMemoryDir,
} from "./storage.js";
import type { MemoryStorageOptions } from "./types.js";

describe("memory storage", () => {
  const testBaseDir = join(tmpdir(), `multica-memory-test-${Date.now()}`);
  const profileId = "test-profile";

  const options: MemoryStorageOptions = {
    profileId,
    baseDir: testBaseDir,
  };

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

  describe("validateKey", () => {
    it("should accept valid alphanumeric keys", () => {
      expect(validateKey("mykey")).toEqual({ valid: true });
      expect(validateKey("my_key")).toEqual({ valid: true });
      expect(validateKey("my-key")).toEqual({ valid: true });
      expect(validateKey("my.key")).toEqual({ valid: true });
      expect(validateKey("MyKey123")).toEqual({ valid: true });
    });

    it("should reject empty keys", () => {
      expect(validateKey("")).toMatchObject({ valid: false, error: "Key is required" });
      expect(validateKey("   ")).toMatchObject({ valid: false, error: "Key cannot be empty" });
    });

    it("should reject keys with invalid characters", () => {
      const result = validateKey("my key");
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("can only contain");
      }
    });

    it("should reject keys that are too long", () => {
      const longKey = "a".repeat(129);
      const result = validateKey(longKey);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("exceeds maximum length");
      }
    });
  });

  describe("memorySet and memoryGet", () => {
    it("should set and get a string value", () => {
      const result = memorySet("test-key", "test-value", undefined, options);
      expect(result).toEqual({ success: true });

      const getResult = memoryGet("test-key", options);
      expect(getResult.found).toBe(true);
      if (getResult.found) {
        expect(getResult.entry.value).toBe("test-value");
      }
    });

    it("should set and get a complex object", () => {
      const value = { name: "test", count: 42, nested: { a: 1 } };
      memorySet("complex-key", value, "A complex object", options);

      const getResult = memoryGet("complex-key", options);
      expect(getResult.found).toBe(true);
      if (getResult.found) {
        expect(getResult.entry.value).toEqual(value);
        expect(getResult.entry.description).toBe("A complex object");
      }
    });

    it("should update existing key and preserve createdAt", async () => {
      memorySet("update-key", "initial", undefined, options);
      const firstGet = memoryGet("update-key", options);
      expect(firstGet.found).toBe(true);

      // Wait a bit to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      memorySet("update-key", "updated", undefined, options);
      const secondGet = memoryGet("update-key", options);

      expect(secondGet.found).toBe(true);
      if (firstGet.found && secondGet.found) {
        expect(secondGet.entry.value).toBe("updated");
        expect(secondGet.entry.createdAt).toBe(firstGet.entry.createdAt);
        expect(secondGet.entry.updatedAt).toBeGreaterThan(firstGet.entry.createdAt);
      }
    });

    it("should return not found for non-existent key", () => {
      const result = memoryGet("non-existent", options);
      expect(result.found).toBe(false);
    });

    it("should handle keys with dots", () => {
      memorySet("user.settings.theme", "dark", undefined, options);

      const result = memoryGet("user.settings.theme", options);
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.entry.value).toBe("dark");
      }
    });

    it("should reject value that is too large", () => {
      const largeValue = "x".repeat(1024 * 1024 + 1);
      const result = memorySet("large-key", largeValue, undefined, options);
      expect(result).toMatchObject({ success: false });
      if (!result.success) {
        expect(result.error).toContain("exceeds maximum size");
      }
    });
  });

  describe("memoryDelete", () => {
    it("should delete existing key", () => {
      memorySet("delete-me", "value", undefined, options);
      expect(memoryGet("delete-me", options).found).toBe(true);

      const result = memoryDelete("delete-me", options);
      expect(result).toEqual({ success: true, existed: true });

      expect(memoryGet("delete-me", options).found).toBe(false);
    });

    it("should handle deleting non-existent key", () => {
      const result = memoryDelete("non-existent", options);
      expect(result).toEqual({ success: true, existed: false });
    });

    it("should reject invalid key", () => {
      const result = memoryDelete("invalid key", options);
      expect(result.success).toBe(false);
    });
  });

  describe("memoryList", () => {
    beforeEach(() => {
      // Create some test keys
      memorySet("project.config", { name: "test" }, "Project config", options);
      memorySet("project.settings", { theme: "dark" }, "Settings", options);
      memorySet("user.name", "Alice", "User name", options);
    });

    it("should list all keys", () => {
      const result = memoryList(undefined, undefined, options);

      expect(result.total).toBe(3);
      expect(result.truncated).toBe(false);
      expect(result.keys.map((k) => k.key)).toContain("project.config");
      expect(result.keys.map((k) => k.key)).toContain("project.settings");
      expect(result.keys.map((k) => k.key)).toContain("user.name");
    });

    it("should filter by prefix", () => {
      const result = memoryList("project", undefined, options);

      expect(result.total).toBe(2);
      expect(result.keys.map((k) => k.key)).toContain("project.config");
      expect(result.keys.map((k) => k.key)).toContain("project.settings");
      expect(result.keys.map((k) => k.key)).not.toContain("user.name");
    });

    it("should respect limit", () => {
      const result = memoryList(undefined, 2, options);

      expect(result.keys.length).toBe(2);
      expect(result.total).toBe(3);
      expect(result.truncated).toBe(true);
    });

    it("should sort by updatedAt descending", async () => {
      // Wait and update one key
      await new Promise((resolve) => setTimeout(resolve, 10));
      memorySet("project.config", { name: "updated" }, "Updated config", options);

      const result = memoryList(undefined, undefined, options);

      // project.config should be first as it was updated most recently
      expect(result.keys[0].key).toBe("project.config");
    });

    it("should return empty array for non-existent directory", () => {
      const emptyOptions: MemoryStorageOptions = {
        profileId: "non-existent-profile",
        baseDir: testBaseDir,
      };

      const result = memoryList(undefined, undefined, emptyOptions);
      expect(result.keys).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe("getMemoryDir", () => {
    it("should return correct memory directory path", () => {
      const dir = getMemoryDir(options);
      expect(dir).toContain(profileId);
      expect(dir).toContain("memory");
    });
  });
});
