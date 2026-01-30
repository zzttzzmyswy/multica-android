/**
 * Memory Tool Type Definitions
 */

/** Memory entry stored in JSON file */
export interface MemoryEntry {
  /** The stored value */
  value: unknown;
  /** Optional description of this memory entry */
  description?: string;
  /** Timestamp when created */
  createdAt: number;
  /** Timestamp when last updated */
  updatedAt: number;
}

/** Memory index structure */
export interface MemoryIndex {
  /** Version for future migrations */
  version: 1;
  /** Map of key to metadata */
  keys: Record<string, MemoryKeyMeta>;
}

/** Metadata for each key in the index */
export interface MemoryKeyMeta {
  /** Optional description */
  description?: string;
  /** Created timestamp */
  createdAt: number;
  /** Updated timestamp */
  updatedAt: number;
}

/** Options for memory storage */
export interface MemoryStorageOptions {
  /** Profile ID (required for storage path) */
  profileId: string;
  /** Base directory for profiles */
  baseDir?: string;
}

/** Result from memory_list */
export interface MemoryListResult {
  keys: Array<{
    key: string;
    description?: string;
    updatedAt: number;
  }>;
  total: number;
  truncated: boolean;
}

/** Valid key pattern: alphanumeric, underscore, dot, hyphen */
export const KEY_PATTERN = /^[a-zA-Z0-9_.-]+$/;

/** Maximum key length */
export const MAX_KEY_LENGTH = 128;

/** Maximum value size in bytes (1MB) */
export const MAX_VALUE_SIZE = 1024 * 1024;

/** Default list limit */
export const DEFAULT_LIST_LIMIT = 100;

/** Maximum list limit */
export const MAX_LIST_LIMIT = 1000;
