/**
 * Memory Storage Layer
 *
 * Handles file-based storage for agent memory in the profile directory.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getProfileDir } from "../../profile/storage.js";
import {
  DEFAULT_LIST_LIMIT,
  KEY_PATTERN,
  MAX_KEY_LENGTH,
  MAX_LIST_LIMIT,
  MAX_VALUE_SIZE,
  type MemoryEntry,
  type MemoryListResult,
  type MemoryStorageOptions,
} from "./types.js";

/**
 * Validate a memory key
 */
export function validateKey(key: string): { valid: true } | { valid: false; error: string } {
  if (!key || typeof key !== "string") {
    return { valid: false, error: "Key is required" };
  }

  const trimmed = key.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: "Key cannot be empty" };
  }

  if (trimmed.length > MAX_KEY_LENGTH) {
    return { valid: false, error: `Key exceeds maximum length of ${MAX_KEY_LENGTH}` };
  }

  if (!KEY_PATTERN.test(trimmed)) {
    return {
      valid: false,
      error: "Key can only contain letters, numbers, underscores, dots, and hyphens",
    };
  }

  return { valid: true };
}

/**
 * Get the memory directory for a profile
 */
export function getMemoryDir(options: MemoryStorageOptions): string {
  const profileDir = getProfileDir(options.profileId, { baseDir: options.baseDir });
  return join(profileDir, "memory");
}

/**
 * Ensure the memory directory exists
 */
export function ensureMemoryDir(options: MemoryStorageOptions): string {
  const memoryDir = getMemoryDir(options);
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
  }
  return memoryDir;
}

/**
 * Get the file path for a memory key
 */
function getKeyFilePath(key: string, options: MemoryStorageOptions): string {
  const memoryDir = getMemoryDir(options);
  // Sanitize key for filename (replace dots with double underscore to avoid extension issues)
  const safeKey = key.replace(/\./g, "__DOT__");
  return join(memoryDir, `${safeKey}.json`);
}

/**
 * Decode a sanitized filename back to the original key
 */
function decodeKeyFromFilename(filename: string): string {
  // Remove .json extension and decode
  const base = filename.replace(/\.json$/, "");
  return base.replace(/__DOT__/g, ".");
}

/**
 * Get a memory value by key
 */
export function memoryGet(
  key: string,
  options: MemoryStorageOptions,
): { found: true; entry: MemoryEntry } | { found: false } {
  const validation = validateKey(key);
  if (!validation.valid) {
    return { found: false };
  }

  const filePath = getKeyFilePath(key.trim(), options);
  if (!existsSync(filePath)) {
    return { found: false };
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    const entry = JSON.parse(content) as MemoryEntry;
    return { found: true, entry };
  } catch {
    return { found: false };
  }
}

/**
 * Set a memory value
 */
export function memorySet(
  key: string,
  value: unknown,
  description: string | undefined,
  options: MemoryStorageOptions,
): { success: true } | { success: false; error: string } {
  const validation = validateKey(key);
  if (validation.valid === false) {
    return { success: false, error: validation.error };
  }

  // Check value size
  const serialized = JSON.stringify(value);
  if (serialized.length > MAX_VALUE_SIZE) {
    return { success: false, error: `Value exceeds maximum size of ${MAX_VALUE_SIZE} bytes` };
  }

  const trimmedKey = key.trim();
  ensureMemoryDir(options);

  const now = Date.now();
  const existing = memoryGet(trimmedKey, options);

  const entry: MemoryEntry = {
    value,
    description: description?.trim() || undefined,
    createdAt: existing.found ? existing.entry.createdAt : now,
    updatedAt: now,
  };

  const filePath = getKeyFilePath(trimmedKey, options);

  try {
    writeFileSync(filePath, JSON.stringify(entry, null, 2), "utf-8");
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to write memory: ${message}` };
  }
}

/**
 * Delete a memory key
 */
export function memoryDelete(
  key: string,
  options: MemoryStorageOptions,
): { success: true; existed: boolean } | { success: false; error: string } {
  const validation = validateKey(key);
  if (validation.valid === false) {
    return { success: false, error: validation.error };
  }

  const filePath = getKeyFilePath(key.trim(), options);
  const existed = existsSync(filePath);

  if (existed) {
    try {
      rmSync(filePath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Failed to delete memory: ${message}` };
    }
  }

  return { success: true, existed };
}

/**
 * List memory keys
 */
export function memoryList(
  prefix: string | undefined,
  limit: number | undefined,
  options: MemoryStorageOptions,
): MemoryListResult {
  const memoryDir = getMemoryDir(options);

  if (!existsSync(memoryDir)) {
    return { keys: [], total: 0, truncated: false };
  }

  const effectiveLimit = Math.min(
    Math.max(1, limit ?? DEFAULT_LIST_LIMIT),
    MAX_LIST_LIMIT,
  );

  try {
    const files = readdirSync(memoryDir).filter((f) => f.endsWith(".json"));
    const entries: Array<{ key: string; description?: string; updatedAt: number }> = [];

    for (const file of files) {
      const key = decodeKeyFromFilename(file);

      // Apply prefix filter
      if (prefix && !key.startsWith(prefix)) {
        continue;
      }

      const filePath = join(memoryDir, file);
      try {
        const content = readFileSync(filePath, "utf-8");
        const entry = JSON.parse(content) as MemoryEntry;
        entries.push({
          key,
          description: entry.description,
          updatedAt: entry.updatedAt,
        });
      } catch {
        // Skip invalid files
      }
    }

    // Sort by updatedAt descending (most recent first)
    entries.sort((a, b) => b.updatedAt - a.updatedAt);

    const total = entries.length;
    const truncated = total > effectiveLimit;
    const keys = entries.slice(0, effectiveLimit);

    return { keys, total, truncated };
  } catch {
    return { keys: [], total: 0, truncated: false };
  }
}
