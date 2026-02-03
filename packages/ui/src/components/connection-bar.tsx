"use client"

import { useState } from "react"
import { Button } from "@multica/ui/components/ui/button"
import { Textarea } from "@multica/ui/components/ui/textarea"
import { toast } from "@multica/ui/components/ui/sonner"
import {
  useGatewayStore,
  useHubStore,
  useDeviceId,
  useHubInit,
  parseConnectionCode,
  saveConnection,
  clearConnection,
} from "@multica/store"

const STATUS_DOT: Record<string, string> = {
  registered: "bg-green-500",
  connected: "bg-yellow-500 animate-pulse",
  connecting: "bg-yellow-500 animate-pulse",
  disconnected: "bg-red-500",
}

export function ConnectionBar() {
  useHubInit()

  const deviceId = useDeviceId()
  const gwState = useGatewayStore((s) => s.connectionState)
  const hubId = useGatewayStore((s) => s.hubId)
  const agentId = useGatewayStore((s) => s.agentId)
  const hubStatus = useHubStore((s) => s.status)

  const isConnected = gwState === "registered" && hubId
  const [codeInput, setCodeInput] = useState("")

  const handleConnect = () => {
    const trimmed = codeInput.trim()
    if (!trimmed) return
    try {
      const info = parseConnectionCode(trimmed)
      saveConnection(info)
      useGatewayStore.getState().connectWithCode(info, deviceId)
      setCodeInput("")
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const handleDisconnect = () => {
    useGatewayStore.getState().disconnect()
    useHubStore.setState({ status: "idle", hub: null, agents: [], activeAgentId: null })
    clearConnection()
  }

  return (
    <div className="w-64 shrink-0 border-r flex flex-col h-dvh">
      <div className="flex items-center gap-2.5 p-4 pb-2">
        <img src="/icon.png" alt="Multica" className="size-7 rounded-md" />
        <span className="text-sm tracking-wide font-[family-name:var(--font-brand)]">
          Multica
        </span>
      </div>

      <div className="flex-1 p-4 pt-2">
        {isConnected ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className={`size-2 rounded-full shrink-0 ${STATUS_DOT[gwState]}`} />
              <span className="text-xs text-muted-foreground">
                {hubStatus === "connected" ? "Connected" : "Connecting..."}
              </span>
            </div>
            <div className="space-y-1 text-xs text-muted-foreground/70 font-mono">
              <div className="truncate" title={hubId}>Hub: {hubId}</div>
              {agentId && <div className="truncate" title={agentId}>Agent: {agentId}</div>}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDisconnect}
              className="w-full text-xs"
            >
              Disconnect
            </Button>
          </div>
        ) : gwState === "connecting" || gwState === "connected" ? (
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full shrink-0 bg-yellow-500 animate-pulse" />
            <span className="text-xs text-muted-foreground">Connecting...</span>
          </div>
        ) : (
          <div className="space-y-3">
            <Textarea
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder="Paste connection code..."
              className="text-xs font-mono min-h-[80px] resize-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  handleConnect()
                }
              }}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleConnect}
              disabled={!codeInput.trim()}
              className="w-full text-xs"
            >
              Connect
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
