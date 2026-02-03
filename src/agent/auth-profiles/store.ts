/**
 * Auth Profile Store
 *
 * Persistence layer for auth profile runtime state.
 * Stores usage stats, cooldowns, and last-good info in ~/.super-multica/auth-profiles.json.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { DATA_DIR } from "../../shared/paths.js";
import { AUTH_STORE_VERSION, AUTH_PROFILE_STORE_FILENAME } from "./constants.js";
import type { AuthProfileStore } from "./types.js";

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

function coerceStore(raw: unknown): AuthProfileStore {
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
 * Atomic load-update-save cycle.
 * The updater receives the current store and should mutate it in place.
 * Returns the updated store.
 */
export function updateAuthProfileStore(
  updater: (store: AuthProfileStore) => void,
): AuthProfileStore {
  const store = loadAuthProfileStore();
  updater(store);
  saveAuthProfileStore(store);
  return store;
}
