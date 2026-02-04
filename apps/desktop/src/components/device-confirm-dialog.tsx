import { useState, useEffect, useCallback } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@multica/ui/components/ui/alert-dialog'

interface DeviceMeta {
  userAgent?: string
  platform?: string
  language?: string
}

interface PendingConfirm {
  deviceId: string
  meta?: DeviceMeta
}

function parseUserAgent(ua: string): { browser: string; os: string } {
  let os = 'Unknown'
  if (/Mac OS X/.test(ua)) os = 'macOS'
  else if (/Windows/.test(ua)) os = 'Windows'
  else if (/Android/.test(ua)) os = 'Android'
  else if (/iPhone|iPad/.test(ua)) os = 'iOS'
  else if (/Linux/.test(ua)) os = 'Linux'

  let browser = 'Unknown'
  const edgeMatch = ua.match(/Edg\/(\d+)/)
  const chromeMatch = ua.match(/Chrome\/(\d+)/)
  const safariMatch = ua.match(/Version\/(\d+).*Safari/)
  const firefoxMatch = ua.match(/Firefox\/(\d+)/)

  if (edgeMatch) browser = `Edge ${edgeMatch[1]}`
  else if (firefoxMatch) browser = `Firefox ${firefoxMatch[1]}`
  else if (chromeMatch) browser = `Chrome ${chromeMatch[1]}`
  else if (safariMatch) browser = `Safari ${safariMatch[1]}`

  return { browser, os }
}

/**
 * Device confirmation dialog — shown when a new device tries to connect via QR code.
 * Listens for 'hub:device-confirm-request' IPC events from the main process,
 * shows an AlertDialog, and sends the user's response back.
 */
export function DeviceConfirmDialog() {
  const [pending, setPending] = useState<PendingConfirm | null>(null)

  useEffect(() => {
    window.electronAPI?.hub.onDeviceConfirmRequest((deviceId: string, meta?: DeviceMeta) => {
      setPending({ deviceId, meta })
    })
  }, [])

  const handleAllow = useCallback(() => {
    if (!pending) return
    window.electronAPI?.hub.deviceConfirmResponse(pending.deviceId, true)
    setPending(null)
  }, [pending])

  const handleReject = useCallback(() => {
    if (!pending) return
    window.electronAPI?.hub.deviceConfirmResponse(pending.deviceId, false)
    setPending(null)
  }, [pending])

  const parsed = pending?.meta?.userAgent
    ? parseUserAgent(pending.meta.userAgent)
    : null

  const deviceLabel = parsed
    ? `${parsed.browser} on ${parsed.os}`
    : pending?.deviceId

  return (
    <AlertDialog open={pending !== null}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>New Device Connection</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                <span className="font-medium">{deviceLabel}</span> wants to connect.
              </p>
              {parsed && (
                <p className="text-xs font-mono text-muted-foreground truncate">
                  {pending?.deviceId}
                </p>
              )}
              <p>Allow this device?</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleReject}>
            Reject
          </AlertDialogCancel>
          <AlertDialogAction onClick={handleAllow}>
            Allow
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
