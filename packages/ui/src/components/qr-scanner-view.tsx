"use client"

import "./qr-scanner.css"

import { useState, useCallback, useRef, useEffect } from "react"
import { useQrScanner, type Point } from "@multica/ui/hooks/use-qr-scanner"
import { Spinner } from "@multica/ui/components/spinner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Camera01Icon,
  CheckmarkCircle02Icon,
  Alert02Icon,
  FlashlightIcon,
} from "@hugeicons/core-free-icons"

type ScannerState =
  | "idle"
  | "requesting"
  | "scanning"
  | "detected"
  | "success"
  | "error"

export interface QrScannerProps {
  onResult: (data: string) => Promise<void>
  onClose?: () => void
  open?: boolean
}

/**
 * Standalone QR scanner with full state machine.
 *
 * States: idle → requesting → scanning → detected → success → (auto-close)
 *                                ↑           ↓
 *                                └── error ──┘
 */
export function QrScannerView({ onResult, onClose, open }: QrScannerProps) {
  const [state, setState] = useState<ScannerState>("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [mappedPoints, setMappedPoints] = useState<Point[] | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const startRef = useRef<(() => Promise<void>) | null>(null)

  const handleScan = useCallback(
    (data: string) => {
      if (stateRef.current !== "scanning") return

      setState("detected")
      navigator.vibrate?.(50)

      // Brief detected state then validate
      setTimeout(async () => {
        try {
          await onResult(data)
          setState("success")
          navigator.vibrate?.(50)
          // Auto-close after success
          setTimeout(() => onClose?.(), 800)
        } catch (e) {
          setErrorMessage((e as Error).message || "Invalid code")
          setState("error")
          navigator.vibrate?.([30, 50, 30])
          // Auto-retry after error
          setTimeout(() => {
            setErrorMessage(null)
            setState("scanning")
            startRef.current?.()
          }, 1500)
        }
      }, 200)
    },
    [onResult, onClose],
  )

  const {
    videoRef,
    hasCamera,
    cornerPoints,
    hasFlash,
    toggleFlash,
    start: scannerStart,
    stop: scannerStop,
    pause: scannerPause,
  } = useQrScanner({
    onScan: handleScan,
    enabled: false,
  })

  startRef.current = scannerStart

  // Map corner points from video coordinates to container coordinates
  useEffect(() => {
    if (!cornerPoints || !containerRef.current || !videoRef.current) {
      setMappedPoints(null)
      return
    }

    const video = videoRef.current
    const container = containerRef.current
    const containerRect = container.getBoundingClientRect()

    const videoWidth = video.videoWidth || 1
    const videoHeight = video.videoHeight || 1
    const scaleX = containerRect.width / videoWidth
    const scaleY = containerRect.height / videoHeight

    setMappedPoints(
      cornerPoints.map((p) => ({
        x: p.x * scaleX,
        y: p.y * scaleY,
      })),
    )
  }, [cornerPoints, videoRef])

  // Pause video on detected state
  useEffect(() => {
    if (state === "detected" || state === "success") {
      scannerPause()
    }
  }, [state, scannerPause])

  // Reset state when `open` toggles
  useEffect(() => {
    if (open === false) {
      scannerStop()
      setState("idle")
      setErrorMessage(null)
      setMappedPoints(null)
    }
  }, [open, scannerStop])

  // Cleanup on unmount
  useEffect(() => {
    return () => scannerStop()
  }, [scannerStop])

  const handleStart = useCallback(async () => {
    setState("requesting")

    // Check camera permission (try/catch for Safari which doesn't support camera query)
    try {
      const perm = await navigator.permissions?.query({
        name: "camera" as PermissionName,
      })
      if (perm?.state === "denied") {
        setState("idle")
        setErrorMessage("Camera access denied. Please enable it in your browser settings.")
        onClose?.()
        return
      }
    } catch {
      // Safari doesn't support camera permission query — proceed anyway
    }

    await scannerStart()
    setState("scanning")
  }, [scannerStart, onClose])

  if (!hasCamera) {
    return (
      <div className="flex items-center justify-center h-[320px] rounded-xl bg-muted">
        <p className="text-sm text-muted-foreground">No camera available</p>
      </div>
    )
  }

  // Compute bounding box from corner points for detected/success/error bracket positioning
  const bracketBounds = mappedPoints
    ? {
        left: Math.min(...mappedPoints.map((p) => p.x)),
        top: Math.min(...mappedPoints.map((p) => p.y)),
        right: Math.max(...mappedPoints.map((p) => p.x)),
        bottom: Math.max(...mappedPoints.map((p) => p.y)),
      }
    : null

  const bracketColor =
    state === "success"
      ? "border-[color:var(--tool-success)]"
      : state === "error"
        ? "border-[color:var(--tool-error)]"
        : state === "detected"
          ? "border-primary"
          : "border-white/30"

  const bracketAnimation =
    state === "scanning"
      ? "animate-scan-breathe"
      : state === "error"
        ? "animate-scan-shake"
        : ""

  return (
    <div className="relative w-full max-w-[320px] mx-auto">
      <div
        ref={containerRef}
        className="relative aspect-square rounded-xl overflow-hidden bg-muted"
      >
        {/* Camera feed (always rendered for ref stability) */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`absolute inset-0 w-full h-full object-cover ${
            state === "idle" || state === "requesting" ? "invisible" : ""
          }`}
        />

        {/* Idle state */}
        {state === "idle" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <button
              type="button"
              onClick={handleStart}
              className="flex items-center justify-center size-16 rounded-full bg-foreground/10 hover:bg-foreground/20 transition-colors"
            >
              <HugeiconsIcon
                icon={Camera01Icon}
                className="size-7 text-muted-foreground"
              />
            </button>
            <p className="text-xs text-muted-foreground">Tap to scan</p>
          </div>
        )}

        {/* Requesting state */}
        {state === "requesting" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <Spinner className="text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              Requesting camera...
            </p>
          </div>
        )}

        {/* Corner brackets overlay */}
        {(state === "scanning" ||
          state === "detected" ||
          state === "success" ||
          state === "error") && (
          <div className="absolute inset-0 pointer-events-none">
            {bracketBounds ? (
              // Position brackets around detected QR code
              <div
                className={`absolute ${bracketAnimation}`}
                style={{
                  left: bracketBounds.left - 8,
                  top: bracketBounds.top - 8,
                  width: bracketBounds.right - bracketBounds.left + 16,
                  height: bracketBounds.bottom - bracketBounds.top + 16,
                }}
              >
                <div
                  className={`absolute -top-1 -left-1 w-5 h-5 border-t-2 border-l-2 ${bracketColor} rounded-tl-md transition-colors duration-200`}
                />
                <div
                  className={`absolute -top-1 -right-1 w-5 h-5 border-t-2 border-r-2 ${bracketColor} rounded-tr-md transition-colors duration-200`}
                />
                <div
                  className={`absolute -bottom-1 -left-1 w-5 h-5 border-b-2 border-l-2 ${bracketColor} rounded-bl-md transition-colors duration-200`}
                />
                <div
                  className={`absolute -bottom-1 -right-1 w-5 h-5 border-b-2 border-r-2 ${bracketColor} rounded-br-md transition-colors duration-200`}
                />
              </div>
            ) : (
              // Default centered brackets
              <div className="absolute inset-0 flex items-center justify-center">
                <div
                  className={`relative w-3/4 h-3/4 ${bracketAnimation}`}
                >
                  <div
                    className={`absolute -top-1 -left-1 w-5 h-5 border-t-2 border-l-2 ${bracketColor} rounded-tl-md transition-colors duration-200`}
                  />
                  <div
                    className={`absolute -top-1 -right-1 w-5 h-5 border-t-2 border-r-2 ${bracketColor} rounded-tr-md transition-colors duration-200`}
                  />
                  <div
                    className={`absolute -bottom-1 -left-1 w-5 h-5 border-b-2 border-l-2 ${bracketColor} rounded-bl-md transition-colors duration-200`}
                  />
                  <div
                    className={`absolute -bottom-1 -right-1 w-5 h-5 border-b-2 border-r-2 ${bracketColor} rounded-br-md transition-colors duration-200`}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Flash toggle */}
        {state === "scanning" && hasFlash && (
          <button
            type="button"
            onClick={toggleFlash}
            className="absolute top-3 right-3 flex items-center justify-center size-8 rounded-full bg-black/40 hover:bg-black/60 transition-colors pointer-events-auto"
          >
            <HugeiconsIcon
              icon={FlashlightIcon}
              className="size-4 text-white"
            />
          </button>
        )}

        {/* Success overlay */}
        {state === "success" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              className="size-12 text-[color:var(--tool-success)] animate-in fade-in zoom-in duration-300"
            />
          </div>
        )}

        {/* Error overlay */}
        {state === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <HugeiconsIcon
              icon={Alert02Icon}
              className="size-10 text-[color:var(--tool-error)]"
            />
            {errorMessage && (
              <p className="text-xs text-white bg-black/60 px-3 py-1 rounded-full">
                {errorMessage}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Hint text */}
      {state === "scanning" && (
        <p className="text-xs text-muted-foreground text-center mt-3">
          Point at QR code on desktop
        </p>
      )}
    </div>
  )
}
