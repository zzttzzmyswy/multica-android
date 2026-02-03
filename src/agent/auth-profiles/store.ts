/**
 * Auth Profile Store
 *
 * Persistence layer for auth profile runtime state.
 * Stores usage stats, cooldowns, and last-good info in ~/.super-multica/auth-profiles.json.
 * Uses proper-lockfile for safe concurrent access across multiple agent processes.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import lockfile from "proper-lockfile";
import { DATA_DIR } from "../../shared/paths.js";
import { AUTH_STORE_VERSION, AUTH_PROFILE_STORE_FILENAME } from "./constants.js";
import type { AuthProfileStore } from "./types.js";

// ============================================================
// Lock options (matches OpenClaw's AUTH_STORE_LOCK_OPTIONS)
// ============================================================

const LOCK_OPTIONS = {
  retries: {
    retries: 10,
    factor: 2,
    minTimeout: 100,
    maxTimeout: 10_000,
    randomize: true,
  },
  stale: 30_000,
} as const;

// ============================================================
// Paths
// ============================================================

/** Resolve the auth profile store file path */
export function resolveAuthStorePath(): string {
  return join(DATA_DIR, AUTH_PROFILE_STORE_FILENAME);
}

// ============================================================
// Load / Save
// ============================================================

function createEmptyStore(): AuthProfileStore {
  return { version: AUTH_STORE_VERSION };
}

/** Coerce raw JSON into a valid AuthProfileStore, defensive against malformed data */
export function coerceStore(raw: unknown): AuthProfileStore {
  if (!raw || typeof raw !== "object") return createEmptyStore();

  const obj = raw as Record<string, unknown>;
  const store: AuthProfileStore = {
    version: typeof obj.version === "number" ? obj.version : AUTH_STORE_VERSION,
  };

  if (obj.lastGood && typeof obj.lastGood === "object") {
    store.lastGood = obj.lastGood as Record<string, string>;
  }
  if (obj.usageStats && typeof obj.usageStats === "object") {
    store.usageStats = obj.usageStats as AuthProfileStore["usageStats"];
  }

  return store;
}

/** Ensure the store file exists on disk (creates it if missing) */
export function ensureAuthStoreFile(): string {
  const storePath = resolveAuthStorePath();
  const dir = dirname(storePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  if (!existsSync(storePath)) {
    writeFileSync(storePath, JSON.stringify(createEmptyStore(), null, 2), "utf8");
  }
  return storePath;
}

/** Load auth profile store from disk. Returns empty store if file doesn't exist. */
export function loadAuthProfileStore(): AuthProfileStore {
  const storePath = resolveAuthStorePath();
  if (!existsSync(storePath)) return createEmptyStore();

  try {
    const raw = readFileSync(storePath, "utf8");
    return coerceStore(JSON.parse(raw));
  } catch {
    return createEmptyStore();
  }
}

/** Save auth profile store to disk */
export function saveAuthProfileStore(store: AuthProfileStore): void {
  const storePath = resolveAuthStorePath();
  const dir = dirname(storePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");
}

/**
 * Atomic load-update-save cycle with file locking.
 * Acquires a lock on the store file, loads current state, runs the updater,
 * and saves. Falls back to unlocked update if the lock cannot be acquired.
 * Returns the updated store.
 */
export function updateAuthProfileStore(
  updater: (store: AuthProfileStore) => void,
): AuthProfileStore {
  const storePath = ensureAuthStoreFile();

  try {
    // Acquire file lock
    const release = lockfile.lockSync(storePath, LOCK_OPTIONS);
    try {
      const store = loadAuthProfileStore();
      updater(store);
      saveAuthProfileStore(store);
      return store;
    } finally {
      release();
    }
  } catch {
    // Fallback: unlocked update (better than losing the write entirely)
    const store = loadAuthProfileStore();
    updater(store);
    saveAuthProfileStore(store);
    return store;
  }
}
