/**
 * System tray (menu bar) for the desktop app.
 *
 * Shows agent/hub status and allows window show/hide even
 * when the main window is closed.
 */
import { Tray, Menu, nativeImage, app, type BrowserWindow } from 'electron'
import path from 'node:path'
import { getCurrentHub, getDefaultAgent } from './ipc/hub.js'

let tray: Tray | null = null
let mainWindowRef: BrowserWindow | null = null
let statusInterval: ReturnType<typeof setInterval> | null = null

/**
 * Create the system tray and start status polling.
 */
export function createTray(window: BrowserWindow): void {
  mainWindowRef = window

  // Use dedicated tray icon (asterisk shape matching MulticaIcon).
  // On macOS, Electron auto-picks trayTemplate.png / trayTemplate@2x.png
  // and treats "Template" suffix as a template image (adapts to dark/light menu bar).
  const iconPath = path.join(process.env.APP_ROOT!, 'build', 'trayTemplate.png')
  const icon = nativeImage.createFromPath(iconPath)

  tray = new Tray(icon)
  tray.setToolTip('Multica')

  // Initial menu
  updateTrayMenu()

  // Poll status every 2 seconds
  statusInterval = setInterval(updateTrayMenu, 2000)
}

/**
 * Destroy tray and stop polling.
 */
export function destroyTray(): void {
  if (statusInterval) {
    clearInterval(statusInterval)
    statusInterval = null
  }
  if (tray) {
    tray.destroy()
    tray = null
  }
  mainWindowRef = null
}

function showMainWindow(): void {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) return
  mainWindowRef.show()
  mainWindowRef.focus()
}

function updateTrayMenu(): void {
  if (!tray) return

  const hub = getCurrentHub()
  const agent = getDefaultAgent()

  let agentStatus = 'Initializing'
  let hubStatus = 'Disconnected'

  if (hub) {
    hubStatus = hub.connectionState === 'connected' ? 'Connected' : 'Disconnected'
  }

  if (agent && !agent.closed) {
    if (agent.isStreaming) {
      agentStatus = 'Streaming'
    } else if (agent.isRunning) {
      agentStatus = 'Running'
    } else {
      agentStatus = 'Idle'
    }
  }

  tray.setToolTip(`Multica - Agent: ${agentStatus}`)

  const menu = Menu.buildFromTemplate([
    { label: `Agent: ${agentStatus}`, enabled: false },
    { label: `Hub: ${hubStatus}`, enabled: false },
    { type: 'separator' },
    {
      label: 'Show Main Window',
      click: showMainWindow,
    },
    { type: 'separator' },
    {
      label: 'Quit Multica',
      click: () => {
        app.quit()
      },
    },
  ])

  tray.setContextMenu(menu)
}
