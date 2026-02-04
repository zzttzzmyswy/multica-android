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

interface PendingConfirm {
  deviceId: string
}

/**
 * Device confirmation dialog — shown when a new device tries to connect via QR code.
 * Listens for 'hub:device-confirm-request' IPC events from the main process,
 * shows an AlertDialog, and sends the user's response back.
 */
export function DeviceConfirmDialog() {
  const [pending, setPending] = useState<PendingConfirm | null>(null)

  useEffect(() => {
    window.electronAPI?.hub.onDeviceConfirmRequest((deviceId: string) => {
      setPending({ deviceId })
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

  return (
    <AlertDialog open={pending !== null}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>New Device Connection</AlertDialogTitle>
          <AlertDialogDescription>
            Device <span className="font-mono font-medium">{pending?.deviceId}</span> wants to connect.
            Allow this device?
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
