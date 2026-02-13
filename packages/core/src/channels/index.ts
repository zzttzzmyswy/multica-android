/**
 * Channel system bootstrap and exports.
 */

export { ChannelManager } from "./manager.js";
export { registerChannel, getChannel, listChannels } from "./registry.js";
export { loadChannelsConfig } from "./config.js";
export type {
  ChannelPlugin,
  ChannelMessage,
  DeliveryContext,
  ChannelAccountState,
  ChannelsConfig,
} from "./types.js";

/** Register all built-in channel plugins. Call once at startup. */
export function initChannels(): void {
  // Telegram is handled by the Gateway (apps/gateway/telegram/).
  // Future: registerChannel(discordChannel);
  // Future: registerChannel(feishuChannel);
}
