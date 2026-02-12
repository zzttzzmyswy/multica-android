import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Button } from '@multica/ui/components/ui/button'
import { Copy, Check } from 'lucide-react'

// ============ Types ============

export interface QRCodeData {
  type: 'multica-connect'
  gateway: string
  hubId: string
  agentId: string
  token: string
  expires: number
}

export interface ConnectionQRCodeProps {
  gateway: string
  hubId: string
  agentId: string
  expirySeconds?: number
  size?: number
}

// ============ Hooks ============

/** Generate a secure random token */
function generateToken(): string {
  return crypto.randomUUID()
}

/**
 * Hook to manage QR token lifecycle
 * - Generates token on mount
 * - Auto-refreshes when expired
 * - Registers token with Hub
 */
function useQRToken(agentId: string, expirySeconds: number) {
  const [token, setToken] = useState(generateToken)
  const [expiresAt, setExpiresAt] = useState(() => Date.now() + expirySeconds * 1000)

  const refresh = useCallback(() => {
    const newToken = generateToken()
    const newExpiry = Date.now() + expirySeconds * 1000
    setToken(newToken)
    setExpiresAt(newExpiry)
    window.electronAPI?.hub.registerToken(newToken, agentId, newExpiry)
  }, [agentId, expirySeconds])

  // Register initial token
  useEffect(() => {
    window.electronAPI?.hub.registerToken(token, agentId, expiresAt)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return { token, expiresAt, refresh }
}

/**
 * Hook for countdown timer
 * Returns remaining seconds, auto-updates every second
 */
function useCountdown(expiresAt: number, onExpire: () => void) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))
  )
  const onExpireRef = useRef(onExpire)
  onExpireRef.current = onExpire

  useEffect(() => {
    // Reset when expiresAt changes
    setRemaining(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)))

    const id = setInterval(() => {
      const next = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))
      setRemaining(next)
      if (next === 0) onExpireRef.current()
    }, 1000)

    return () => clearInterval(id)
  }, [expiresAt])

  return remaining
}

/**
 * Hook for clipboard copy with feedback
 */
function useCopyToClipboard(timeout = 2000) {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), timeout)
      return true
    } catch {
      return false
    }
  }, [timeout])

  return { copied, copy }
}

// ============ Components ============

/** Corner accent decoration */
function CornerAccent({ position }: { position: 'tl' | 'tr' | 'bl' | 'br' }) {
  const positionClasses = {
    tl: '-top-2 -left-2 border-t-2 border-l-2 rounded-tl-lg',
    tr: '-top-2 -right-2 border-t-2 border-r-2 rounded-tr-lg',
    bl: '-bottom-2 -left-2 border-b-2 border-l-2 rounded-bl-lg',
    br: '-bottom-2 -right-2 border-b-2 border-r-2 rounded-br-lg',
  }

  return (
    <div
      className={`absolute w-5 h-5 border-muted-foreground/30 ${positionClasses[position]}`}
    />
  )
}

/** QR code frame with corner accents */
function QRCodeFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative inline-block">
      <CornerAccent position="tl" />
      <CornerAccent position="tr" />
      <CornerAccent position="bl" />
      <CornerAccent position="br" />
      <div className="bg-white p-3 rounded-lg">{children}</div>
    </div>
  )
}

/** Format seconds as M:SS */
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Expiry timer display */
function ExpiryTimer({ remaining }: { remaining: number }) {
  // Derive display state from remaining seconds (no extra state needed)
  const isWarning = remaining > 0 && remaining < 10

  return (
    <span
      className={`text-xs font-mono ${
        isWarning ? 'text-orange-500' : 'text-muted-foreground'
      }`}
    >
      Expires in {formatTime(remaining)}
    </span>
  )
}

/** Copy link button */
function CopyLinkButton({ url }: { url: string }) {
  const { copied, copy } = useCopyToClipboard()

  return (
    <Button variant="ghost" size="sm" className="h-7 gap-1.5" onClick={() => copy(url)}>
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? 'Copied!' : 'Copy Link'}
    </Button>
  )
}

// ============ Main Component ============

/**
 * ConnectionQRCode - QR code for mobile app connection
 *
 * Architecture:
 * - useQRToken: manages token generation and Hub registration
 * - useCountdown: handles timer with auto-refresh on expiry
 * - Pure child components for display (no state)
 */
export function ConnectionQRCode({
  gateway,
  hubId,
  agentId,
  expirySeconds = 30,
  size = 200,
}: ConnectionQRCodeProps) {
  const { token, expiresAt, refresh } = useQRToken(agentId, expirySeconds)
  const remaining = useCountdown(expiresAt, refresh)

  // Derive QR data and URL from current token (computed during render)
  const qrData: QRCodeData = useMemo(
    () => ({
      type: 'multica-connect',
      gateway,
      hubId,
      agentId,
      token,
      expires: expiresAt,
    }),
    [gateway, hubId, agentId, token, expiresAt]
  )

  const connectionUrl = useMemo(() => {
    const params = new URLSearchParams({
      gateway,
      hub: hubId,
      agent: agentId,
      token,
      exp: expiresAt.toString(),
    })
    return `multica://connect?${params.toString()}`
  }, [gateway, hubId, agentId, token, expiresAt])

  return (
    <div className="flex flex-col items-center gap-4">
      <QRCodeFrame>
        <QRCodeSVG
          value={JSON.stringify(qrData)}
          size={size}
          level="M"
          marginSize={0}
          bgColor="#ffffff"
          fgColor="#0a0a0a"
        />
      </QRCodeFrame>

      <div className="flex items-center gap-3">
        <ExpiryTimer remaining={remaining} />
        <CopyLinkButton url={connectionUrl} />
      </div>
    </div>
  )
}

export default ConnectionQRCode
