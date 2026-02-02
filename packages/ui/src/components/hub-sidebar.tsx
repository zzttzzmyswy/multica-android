"use client"

import { useState } from "react"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
} from "@multica/ui/components/ui/sidebar"
import { Button } from "@multica/ui/components/ui/button"
import { Input } from "@multica/ui/components/ui/input"
import { HugeiconsIcon } from "@hugeicons/react"
import { PlusSignIcon, Delete02Icon } from "@hugeicons/core-free-icons"
import { useHubStore, useDeviceId, useGatewayStore } from "@multica/store"
import { useHubInit } from "@multica/store"
import { Skeleton } from "@multica/ui/components/ui/skeleton"

const STATUS_DOT: Record<string, string> = {
  connected: "bg-green-500/60",
  loading: "bg-yellow-500/50 animate-pulse",
  error: "bg-red-500/60",
  idle: "bg-muted-foreground/50",
}

const STATUS_LABEL: Record<string, string> = {
  connected: "Connected",
  loading: "Connecting...",
  error: "Disconnected",
  idle: "Idle",
}

export function HubSidebar() {
  useHubInit()

  const status = useHubStore((s) => s.status)
  const hub = useHubStore((s) => s.hub)
  const agents = useHubStore((s) => s.agents)
  const activeAgentId = useHubStore((s) => s.activeAgentId)
  const createAgent = useHubStore((s) => s.createAgent)
  const deleteAgent = useHubStore((s) => s.deleteAgent)
  const setActiveAgentId = useHubStore((s) => s.setActiveAgentId)

  const gwState = useGatewayStore((s) => s.connectionState)
  const hubId = useGatewayStore((s) => s.hubId)
  const hubs = useGatewayStore((s) => s.hubs)
  const setHubId = useGatewayStore((s) => s.setHubId)
  const listDevices = useGatewayStore((s) => s.listDevices)

  const [hubIdInput, setHubIdInput] = useState("")
  const isRegistered = gwState === "registered"
  const needsHubSelection = isRegistered && !hubId

  const handleConnect = () => {
    const id = hubIdInput.trim()
    if (!id) return
    setHubId(id)
  }

  const handleDisconnect = () => {
    useGatewayStore.setState({ hubId: null })
    useHubStore.setState({ status: "idle", hub: null, agents: [], activeAgentId: null })
  }

  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>Hub</SidebarGroupLabel>
        <SidebarGroupContent>
          {!isRegistered ? (
            <div className="flex items-center gap-2 px-2 py-1 text-sm">
              <span className="size-2 rounded-full shrink-0 bg-yellow-500/50 animate-pulse" />
              <span className="text-muted-foreground/70 text-xs">
                {gwState === "disconnected" ? "Connecting to Gateway..." : "Registering..."}
              </span>
            </div>
          ) : needsHubSelection ? (
            <div className="px-2 space-y-2 py-1">
              {hubs.length > 0 && (
                <div className="space-y-1">
                  {hubs.map((h) => (
                    <button
                      key={h.deviceId}
                      onClick={() => setHubId(h.deviceId)}
                      className="w-full text-left px-2 py-1 rounded-md text-xs font-mono hover:bg-sidebar-accent hover:text-sidebar-accent-foreground cursor-pointer truncate"
                    >
                      {h.deviceId}
                    </button>
                  ))}
                </div>
              )}
              <Input
                value={hubIdInput}
                onChange={(e) => setHubIdInput(e.target.value)}
                placeholder="Or enter Hub ID..."
                className="h-7 text-xs font-mono"
                onKeyDown={(e) => e.key === "Enter" && handleConnect()}
              />
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleConnect}
                  disabled={!hubIdInput.trim()}
                  className="flex-1 text-xs"
                >
                  Connect
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => listDevices()}
                  className="text-xs"
                >
                  Refresh
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 px-2 py-1 text-sm">
                <span className={`size-2 rounded-full shrink-0 ${STATUS_DOT[status] ?? STATUS_DOT.idle}`} />
                <span className="text-muted-foreground/70 text-xs">
                  {STATUS_LABEL[status]}
                </span>
              </div>
              {status === "connected" && hub ? (
                <div className="px-2 text-xs text-muted-foreground/50 font-mono truncate">
                  {hub.hubId}
                </div>
              ) : (status === "idle" || status === "loading") ? (
                <Skeleton className="mx-2 h-3.5 w-32" />
              ) : null}
              <div className="px-2 pt-1">
                <Button variant="outline" size="sm" onClick={handleDisconnect} className="w-full text-xs">
                  Disconnect
                </Button>
              </div>
            </>
          )}
        </SidebarGroupContent>
      </SidebarGroup>

      {isRegistered && hubId && (status === "idle" || status === "loading") && (
        <SidebarGroup>
          <SidebarGroupLabel>Agents</SidebarGroupLabel>
          <SidebarGroupContent>
            <div className="space-y-2 px-2 py-1">
              <Skeleton className="h-6 w-full rounded-md" />
              <Skeleton className="h-6 w-3/4 rounded-md" />
              <Skeleton className="h-6 w-5/6 rounded-md" />
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      )}

      {status === "connected" && (
        <SidebarGroup>
          <SidebarGroupLabel>Agents</SidebarGroupLabel>
          <SidebarGroupAction onClick={() => createAgent()} title="Create agent">
            <HugeiconsIcon icon={PlusSignIcon} />
          </SidebarGroupAction>
          <SidebarGroupContent>
            <SidebarMenu>
              {agents.length === 0 && (
                <div className="px-2 py-2 text-xs text-muted-foreground/60">
                  No agents
                </div>
              )}
              {agents.map(agent => (
                <SidebarMenuItem key={agent.id} className="group/agent-item">
                  <div
                    role="button"
                    onClick={() => setActiveAgentId(agent.id)}
                    data-active={agent.id === activeAgentId || undefined}
                    className="flex items-center w-full h-8 px-2 rounded-md cursor-pointer hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground data-active:font-medium"
                  >
                    <span className="flex-1 min-w-0 truncate font-mono text-xs">
                      {agent.id}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteAgent(agent.id)
                      }}
                      title="Delete agent"
                      className="shrink-0 size-5 flex items-center justify-center rounded-md opacity-0 group-hover/agent-item:opacity-100 hover:bg-sidebar-accent-foreground/10 text-muted-foreground transition-opacity cursor-pointer"
                    >
                      <HugeiconsIcon icon={Delete02Icon} strokeWidth={1.5} className="size-3.5" />
                    </button>
                  </div>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}
    </>
  )
}
