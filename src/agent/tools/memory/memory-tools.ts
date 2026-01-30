/**
 * Memory Tools
 *
 * Provides persistent key-value storage for agents.
 */

import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { memoryDelete, memoryGet, memoryList, memorySet, validateKey } from "./storage.js";
import type { MemoryStorageOptions } from "./types.js";

// ============================================================================
// Schemas
// ============================================================================

const MemoryGetSchema = Type.Object({
  key: Type.String({ description: "The key to retrieve" }),
});

const MemorySetSchema = Type.Object({
  key: Type.String({ description: "The key to set (alphanumeric, underscore, dot, hyphen)" }),
  value: Type.Unknown({ description: "The value to store (will be JSON serialized)" }),
  description: Type.Optional(
    Type.String({ description: "Optional description of this memory entry" }),
  ),
});

const MemoryDeleteSchema = Type.Object({
  key: Type.String({ description: "The key to delete" }),
});

const MemoryListSchema = Type.Object({
  prefix: Type.Optional(Type.String({ description: "Filter keys by prefix" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of keys to return (default 100)" })),
});

// ============================================================================
// Helper
// ============================================================================

function jsonResult<T>(data: T): {
  content: Array<{ type: "text"; text: string }>;
  details: T;
} {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

// ============================================================================
// Tools
// ============================================================================

export function createMemoryGetTool(
  options: MemoryStorageOptions,
): AgentTool<typeof MemoryGetSchema> {
  return {
    name: "memory_get",
    label: "Memory Get",
    description: "Retrieve a value from persistent memory by key.",
    parameters: MemoryGetSchema,
    execute: async (_toolCallId, params) => {
      const key = typeof params.key === "string" ? params.key.trim() : "";

      const validation = validateKey(key);
      if (!validation.valid) {
        return jsonResult({ found: false, error: validation.error });
      }

      const result = memoryGet(key, options);
      if (!result.found) {
        return jsonResult({ found: false, key });
      }

      return jsonResult({
        found: true,
        key,
        value: result.entry.value,
        description: result.entry.description,
        updatedAt: result.entry.updatedAt,
      });
    },
  };
}

export function createMemorySetTool(
  options: MemoryStorageOptions,
): AgentTool<typeof MemorySetSchema> {
  return {
    name: "memory_set",
    label: "Memory Set",
    description:
      "Store a value in persistent memory. The value will be JSON serialized. " +
      "Keys can contain letters, numbers, underscores, dots, and hyphens.",
    parameters: MemorySetSchema,
    execute: async (_toolCallId, params) => {
      const key = typeof params.key === "string" ? params.key.trim() : "";
      const value = params.value;
      const description = typeof params.description === "string" ? params.description : undefined;

      const result = memorySet(key, value, description, options);
      if (!result.success) {
        return jsonResult({ success: false, error: result.error });
      }

      return jsonResult({ success: true, key });
    },
  };
}

export function createMemoryDeleteTool(
  options: MemoryStorageOptions,
): AgentTool<typeof MemoryDeleteSchema> {
  return {
    name: "memory_delete",
    label: "Memory Delete",
    description: "Delete a value from persistent memory by key.",
    parameters: MemoryDeleteSchema,
    execute: async (_toolCallId, params) => {
      const key = typeof params.key === "string" ? params.key.trim() : "";

      const validation = validateKey(key);
      if (!validation.valid) {
        return jsonResult({ success: false, error: validation.error });
      }

      const result = memoryDelete(key, options);
      if (!result.success) {
        return jsonResult({ success: false, error: result.error });
      }

      return jsonResult({ success: true, key, existed: result.existed });
    },
  };
}

export function createMemoryListTool(
  options: MemoryStorageOptions,
): AgentTool<typeof MemoryListSchema> {
  return {
    name: "memory_list",
    label: "Memory List",
    description:
      "List all keys in persistent memory, sorted by most recently updated. " +
      "Optionally filter by prefix.",
    parameters: MemoryListSchema,
    execute: async (_toolCallId, params) => {
      const prefix = typeof params.prefix === "string" ? params.prefix : undefined;
      const limit = typeof params.limit === "number" ? params.limit : undefined;

      const result = memoryList(prefix, limit, options);

      return jsonResult({
        keys: result.keys,
        total: result.total,
        truncated: result.truncated,
      });
    },
  };
}

/**
 * Create all memory tools for a profile
 */
export function createMemoryTools(
  options: MemoryStorageOptions,
): Array<AgentTool<any>> {
  return [
    createMemoryGetTool(options),
    createMemorySetTool(options),
    createMemoryDeleteTool(options),
    createMemoryListTool(options),
  ];
}
