"use client"

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
} from "@multica/ui/components/ui/sidebar"
import { Button } from "@multica/ui/components/ui/button"
import { HugeiconsIcon } from "@hugeicons/react"
import { PlusSignIcon, Delete02Icon } from "@hugeicons/core-free-icons"
import { useHubStore } from "@multica/store"
import { useHubInit } from "@multica/store"

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
  const fetchHub = useHubStore((s) => s.fetchHub)
  const createAgent = useHubStore((s) => s.createAgent)
  const deleteAgent = useHubStore((s) => s.deleteAgent)
  const setActiveAgentId = useHubStore((s) => s.setActiveAgentId)

  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>Hub</SidebarGroupLabel>
        <SidebarGroupContent>
          <div className="flex items-center gap-2 px-2 py-1 text-sm">
            <span className={`size-2 rounded-full shrink-0 ${STATUS_DOT[status]}`} />
            <span className="text-muted-foreground/70 text-xs">{STATUS_LABEL[status]}</span>
          </div>
          {status === "connected" && hub && (
            <div className="px-2 text-xs text-muted-foreground/50 font-mono truncate">
              {hub.hubId}
            </div>
          )}
          {status === "error" && (
            <div className="px-2 pt-1">
              <Button variant="outline" size="sm" onClick={fetchHub} className="w-full text-xs">
                Retry
              </Button>
            </div>
          )}
        </SidebarGroupContent>
      </SidebarGroup>

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
