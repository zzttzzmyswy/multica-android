/**
 * Channel configuration loader.
 *
 * Reads ~/.super-multica/channels.json5 for channel credentials and settings.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import JSON5 from "json5";
import { DATA_DIR } from "../shared/paths.js";
import type { ChannelsConfig } from "./types.js";

export const CHANNELS_CONFIG_PATH = join(DATA_DIR, "channels.json5");

/** Load channels config from ~/.super-multica/channels.json5 */
export function loadChannelsConfig(): ChannelsConfig {
  if (!existsSync(CHANNELS_CONFIG_PATH)) {
    console.log(`[Channels] No channels.json5 found, skipping`);
    return {};
  }
  try {
    const raw = readFileSync(CHANNELS_CONFIG_PATH, "utf8");
    const config = JSON5.parse(raw) as ChannelsConfig;
    console.log(`[Channels] Loaded config from ${CHANNELS_CONFIG_PATH}`);
    return config;
  } catch (err) {
    console.warn(`[Channels] Failed to parse ${CHANNELS_CONFIG_PATH}: ${err}`);
    return {};
  }
}
