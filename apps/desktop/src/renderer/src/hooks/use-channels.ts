/**
 * Hook for managing channel accounts (Telegram, Discord, etc.) in the Desktop App.
 *
 * Uses the global ChannelsStore for state management.
 * Data is fetched once at app startup and shared across all components.
 */
import { useChannelsStore } from '../stores/channels'

export interface UseChannelsReturn {
  /** Runtime states of all channel accounts */
  states: ChannelAccountStateInfo[]
  /** Raw channel config from credentials.json5 */
  config: Record<string, Record<string, Record<string, unknown>> | undefined>
  /** Loading state */
  loading: boolean
  /** Error message if any */
  error: string | null
  /** Refresh states and config */
  refresh: () => Promise<void>
  /** Save a bot token — persists to file and starts the bot immediately */
  saveToken: (channelId: string, accountId: string, token: string) => Promise<{ ok: boolean; error?: string }>
  /** Remove a bot token — stops the bot and removes from file */
  removeToken: (channelId: string, accountId: string) => Promise<{ ok: boolean; error?: string }>
  /** Stop a channel account without removing config */
  stopChannel: (channelId: string, accountId: string) => Promise<{ ok: boolean; error?: string }>
  /** Start a channel account from saved config */
  startChannel: (channelId: string, accountId: string) => Promise<{ ok: boolean; error?: string }>
}

export function useChannels(): UseChannelsReturn {
  const {
    states,
    config,
    loading,
    error,
    refresh,
    saveToken,
    removeToken,
    stopChannel,
    startChannel,
  } = useChannelsStore()

  return {
    states,
    config,
    loading,
    error,
    refresh,
    saveToken,
    removeToken,
    stopChannel,
    startChannel,
  }
}
