/**
 * Channel IPC handlers for Electron main process.
 *
 * Manages channel account configuration, start/stop lifecycle.
 * The Channels page in the renderer uses these to configure
 * Telegram (and future channels) with immediate effect.
 */
import { ipcMain } from 'electron'
import { getCurrentHub } from './hub.js'
import { credentialManager } from '../../../../src/agent/credentials.js'
import { listChannels } from '../../../../src/channels/registry.js'

/**
 * Register all Channel-related IPC handlers.
 */
export function registerChannelsIpcHandlers(): void {
  /**
   * List all channel account states (running / stopped / error).
   */
  ipcMain.handle('channels:listStates', async () => {
    const hub = getCurrentHub()
    if (!hub) return []
    return hub.channelManager.listAccountStates()
  })

  /**
   * Get the channels config from credentials.json5.
   * Returns the raw `channels` section: { telegram: { default: { botToken: "..." } } }
   */
  ipcMain.handle('channels:getConfig', async () => {
    return credentialManager.getChannelsConfig()
  })

  /**
   * Save a channel account token and start the bot immediately.
   * Flow: write to credentials.json5 → start the channel account.
   */
  ipcMain.handle(
    'channels:saveToken',
    async (_event, channelId: string, accountId: string, token: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        const hub = getCurrentHub()
        if (!hub) return { ok: false, error: 'Hub not initialized' }

        // Find the plugin to validate channelId
        const plugin = listChannels().find((p) => p.id === channelId)
        if (!plugin) return { ok: false, error: `Unknown channel: ${channelId}` }

        // Persist config to credentials.json5
        credentialManager.setChannelAccountConfig(channelId, accountId, { botToken: token })
        console.log(`[IPC] Channel config saved: ${channelId}:${accountId}`)

        // Stop existing account if running (e.g. token update)
        hub.channelManager.stopAccount(channelId, accountId)

        // Start the account with the new config
        await hub.channelManager.startAccount(channelId, accountId, { botToken: token })
        console.log(`[IPC] Channel started: ${channelId}:${accountId}`)

        return { ok: true }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[IPC] Failed to save channel token: ${message}`)
        return { ok: false, error: message }
      }
    }
  )

  /**
   * Remove a channel account token and stop the bot.
   */
  ipcMain.handle(
    'channels:removeToken',
    async (_event, channelId: string, accountId: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        const hub = getCurrentHub()
        if (!hub) return { ok: false, error: 'Hub not initialized' }

        // Stop the account
        hub.channelManager.stopAccount(channelId, accountId)

        // Remove from credentials.json5
        credentialManager.removeChannelAccountConfig(channelId, accountId)
        console.log(`[IPC] Channel config removed: ${channelId}:${accountId}`)

        return { ok: true }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[IPC] Failed to remove channel token: ${message}`)
        return { ok: false, error: message }
      }
    }
  )

  /**
   * Stop a channel account without removing its config.
   */
  ipcMain.handle(
    'channels:stop',
    async (_event, channelId: string, accountId: string): Promise<{ ok: boolean }> => {
      const hub = getCurrentHub()
      if (!hub) return { ok: false }
      hub.channelManager.stopAccount(channelId, accountId)
      return { ok: true }
    }
  )

  /**
   * Start a channel account using its saved config.
   */
  ipcMain.handle(
    'channels:start',
    async (_event, channelId: string, accountId: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        const hub = getCurrentHub()
        if (!hub) return { ok: false, error: 'Hub not initialized' }

        // Read config from credentials
        const config = credentialManager.getChannelsConfig()
        const accountConfig = config[channelId]?.[accountId]
        if (!accountConfig) {
          return { ok: false, error: `No config found for ${channelId}:${accountId}` }
        }

        await hub.channelManager.startAccount(channelId, accountId, accountConfig)
        return { ok: true }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, error: message }
      }
    }
  )
}
