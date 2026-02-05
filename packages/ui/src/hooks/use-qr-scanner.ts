"use client"

import { useRef, useState, useEffect, useCallback } from "react"
import type QrScannerLib from "qr-scanner"

export interface Point {
  x: number
  y: number
}

export interface UseQrScannerOptions {
  onScan: (data: string) => void
  onError?: (error: string) => void
  enabled?: boolean
}

export interface UseQrScannerResult {
  videoRef: React.RefObject<HTMLVideoElement | null>
  isScanning: boolean
  error: string | null
  hasCamera: boolean
  cornerPoints: Point[] | null
  hasFlash: boolean
  toggleFlash: () => Promise<void>
  start: () => Promise<void>
  stop: () => void
  pause: () => void
}

/**
 * Hook wrapping qr-scanner lifecycle.
 *
 * - Dynamically imports qr-scanner (keeps it out of SSR bundles)
 * - Creates/destroys scanner instance based on `enabled` or manual start/stop
 * - Exposes cornerPoints from scan results, flash control, and lifecycle methods
 * - Releases camera stream on cleanup
 */
export function useQrScanner({
  onScan,
  onError,
  enabled = false,
}: UseQrScannerOptions): UseQrScannerResult {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const scannerRef = useRef<QrScannerLib | null>(null)
  const [isScanning, setIsScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasCamera, setHasCamera] = useState(true)
  const [cornerPoints, setCornerPoints] = useState<Point[] | null>(null)
  const [hasFlash, setHasFlash] = useState(false)

  // Stable callback refs to avoid re-creating scanner on every render
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  // Check camera availability once
  useEffect(() => {
    let cancelled = false
    import("qr-scanner").then((mod) => {
      const QrScanner = mod.default
      QrScanner.hasCamera().then((has) => {
        if (!cancelled) setHasCamera(has)
      })
    })
    return () => { cancelled = true }
  }, [])

  const createScanner = useCallback(async () => {
    if (!videoRef.current || !hasCamera) return

    const mod = await import("qr-scanner")
    const QrScanner = mod.default

    // Destroy previous instance if any
    if (scannerRef.current) {
      scannerRef.current.stop()
      scannerRef.current.destroy()
      scannerRef.current = null
    }

    const scanner = new QrScanner(
      videoRef.current,
      (result) => {
        const points = result.cornerPoints as Point[] | undefined
        setCornerPoints(points?.length ? points : null)
        onScanRef.current(result.data)
      },
      {
        preferredCamera: "environment",
        maxScansPerSecond: 5,
        returnDetailedScanResult: true,
        highlightScanRegion: false,
        highlightCodeOutline: false,
        onDecodeError: (err) => {
          // "No QR code found" fires every frame — ignore it
          if (typeof err === "string" && err.includes("No QR code found")) return
          console.warn("[QrScanner] decode error:", err)
        },
      },
    )

    scannerRef.current = scanner
    return scanner
  }, [hasCamera])

  const start = useCallback(async () => {
    setError(null)
    setCornerPoints(null)

    try {
      let scanner = scannerRef.current
      if (!scanner) {
        scanner = (await createScanner()) ?? null
        if (!scanner) return
      }

      await scanner.start()
      setIsScanning(true)

      // Check flash availability after camera starts
      try {
        const flash = await scanner.hasFlash()
        setHasFlash(flash)
      } catch {
        setHasFlash(false)
      }
    } catch (err) {
      const msg = (err as Error).message || "Camera access failed"
      setError(msg)
      setIsScanning(false)
      onErrorRef.current?.(msg)
    }
  }, [createScanner])

  const stop = useCallback(() => {
    if (scannerRef.current) {
      scannerRef.current.stop()
      scannerRef.current.destroy()
      scannerRef.current = null
    }
    setIsScanning(false)
    setCornerPoints(null)
    setHasFlash(false)
  }, [])

  const pause = useCallback(() => {
    scannerRef.current?.pause()
    setIsScanning(false)
  }, [])

  const toggleFlash = useCallback(async () => {
    if (!scannerRef.current) return
    try {
      await scannerRef.current.toggleFlash()
    } catch {
      // Flash not supported or other error — silently ignore
    }
  }, [])

  // Auto-start/stop based on `enabled` prop (backwards compatible)
  useEffect(() => {
    if (enabled) {
      start()
    } else if (!enabled && scannerRef.current) {
      stop()
    }
  }, [enabled, start, stop])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop()
        scannerRef.current.destroy()
        scannerRef.current = null
      }
    }
  }, [])

  return {
    videoRef,
    isScanning,
    error,
    hasCamera,
    cornerPoints,
    hasFlash,
    toggleFlash,
    start,
    stop,
    pause,
  }
}
