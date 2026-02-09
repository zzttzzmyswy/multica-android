/**
 * IPC handlers index - register all handlers from main process.
 */
export { registerAgentIpcHandlers, cleanupAgent } from './agent.js'
export { registerSkillsIpcHandlers } from './skills.js'
export { registerHubIpcHandlers, cleanupHub, initializeHub, setupDeviceConfirmation } from './hub.js'
export { registerProfileIpcHandlers } from './profile.js'
export { registerProviderIpcHandlers } from './provider.js'
export { registerChannelsIpcHandlers } from './channels.js'

import { registerAgentIpcHandlers, cleanupAgent } from './agent.js'
import { registerSkillsIpcHandlers } from './skills.js'
import { registerHubIpcHandlers, cleanupHub, initializeHub } from './hub.js'
import { registerProfileIpcHandlers } from './profile.js'
import { registerProviderIpcHandlers } from './provider.js'
import { registerChannelsIpcHandlers } from './channels.js'

/**
 * Register all IPC handlers.
 * Call this in main.ts after app is ready.
 */
export function registerAllIpcHandlers(): void {
  registerHubIpcHandlers()
  registerAgentIpcHandlers()
  registerSkillsIpcHandlers()
  registerProfileIpcHandlers()
  registerProviderIpcHandlers()
  registerChannelsIpcHandlers()
}

/**
 * Initialize Hub and create default agent.
 * Call this after IPC handlers are registered.
 */
export async function initializeApp(): Promise<void> {
  console.log('[Desktop] Initializing app...')
  await initializeHub()
  console.log('[Desktop] App initialized')
}

/**
 * Cleanup all resources.
 * Call this before app quits.
 */
export function cleanupAll(): void {
  cleanupHub()
  cleanupAgent()
}
