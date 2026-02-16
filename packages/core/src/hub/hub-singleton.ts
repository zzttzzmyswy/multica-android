/**
 * Global Hub singleton for cross-module access.
 *
 * Used by modules like cron execution without threading Hub references
 * through the entire call chain.
 */

import type { Hub } from "./hub.js";

let _hub: Hub | undefined;

/** Set the global Hub instance. Called once during Hub construction. */
export function setHub(hub: Hub): void {
  _hub = hub;
}

/** Get the global Hub instance. Throws if not yet initialized. */
export function getHub(): Hub {
  if (!_hub) {
    throw new Error("[Hub] Hub singleton not initialized. Ensure Hub is constructed before accessing.");
  }
  return _hub;
}

/** Check if the Hub singleton has been initialized. */
export function isHubInitialized(): boolean {
  return _hub !== undefined;
}
