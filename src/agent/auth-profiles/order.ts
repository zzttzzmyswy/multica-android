/**
 * Auth Profile Ordering
 *
 * Determines the order in which auth profiles are tried for a given provider.
 * Supports explicit ordering (from credentials.json5) and automatic round-robin
 * based on lastUsed time. Profiles in cooldown are pushed to the end.
 */

import { credentialManager } from "../credentials.js";
import type { AuthProfileStore, ProfileUsageStats } from "./types.js";
import { isProfileInCooldown, resolveProfileUnusableUntil } from "./usage.js";

// ============================================================
// Profile discovery
// ============================================================

/**
 * List all profile IDs from credentials.json5 that belong to a given provider.
 * A profile matches if its key equals the provider exactly or starts with "provider:".
 */
export function listProfilesForProvider(provider: string): string[] {
  return credentialManager.listProfileIdsForProvider(provider);
}

// ============================================================
// Ordering
// ============================================================

/**
 * Resolve the ordered list of profile IDs to try for a given provider.
 *
 * Strategy:
 * 1. If credentials.json5 has `llm.order[provider]`, use that explicit order.
 * 2. Otherwise, use round-robin ordered by `lastUsed` ascending (oldest first).
 *
 * In both cases, profiles currently in cooldown are pushed to the end,
 * sorted by earliest cooldown expiry (soonest-to-recover first).
 */
export function resolveAuthProfileOrder(
  provider: string,
  store: AuthProfileStore,
  now?: number,
): string[] {
  const ts = now ?? Date.now();

  // Gather candidates
  const explicitOrder = credentialManager.getLlmOrder(provider);
  const allProfiles = listProfilesForProvider(provider);

  let candidates: string[];
  if (explicitOrder && explicitOrder.length > 0) {
    // Use explicit order, filter to only existing profiles
    const profileSet = new Set(allProfiles);
    candidates = explicitOrder.filter((id) => profileSet.has(id));
    // Append any profiles not in the explicit order
    for (const id of allProfiles) {
      if (!candidates.includes(id)) {
        candidates.push(id);
      }
    }
  } else {
    // Round-robin by lastUsed (oldest first)
    candidates = [...allProfiles].sort((a, b) => {
      const statsA = store.usageStats?.[a];
      const statsB = store.usageStats?.[b];
      return (statsA?.lastUsed ?? 0) - (statsB?.lastUsed ?? 0);
    });
  }

  // Deduplicate
  candidates = [...new Set(candidates)];

  // Partition into available and in-cooldown
  const available: string[] = [];
  const inCooldown: string[] = [];

  for (const id of candidates) {
    const stats = store.usageStats?.[id];
    if (stats && isProfileInCooldown(stats, ts)) {
      inCooldown.push(id);
    } else {
      available.push(id);
    }
  }

  // Sort cooldown profiles by soonest recovery
  inCooldown.sort((a, b) => {
    const statsA = store.usageStats?.[a] ?? {};
    const statsB = store.usageStats?.[b] ?? {};
    return resolveProfileUnusableUntil(statsA) - resolveProfileUnusableUntil(statsB);
  });

  return [...available, ...inCooldown];
}
