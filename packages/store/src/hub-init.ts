"use client"

import { useEffect } from "react"
import { useHubStore } from "./hub"
import { useGatewayStore } from "./gateway"

export function useHubInit() {
  const gwState = useGatewayStore((s) => s.connectionState)
  const fetchHub = useHubStore((s) => s.fetchHub)
  const fetchAgents = useHubStore((s) => s.fetchAgents)

  // Once WS is registered, fetch hub info and agents via RPC
  useEffect(() => {
    if (gwState === "registered") {
      fetchHub()
      fetchAgents()
    }
    if (gwState === "disconnected") {
      useHubStore.setState({ status: "idle", hub: null, agents: [], activeAgentId: null })
    }
  }, [gwState, fetchHub, fetchAgents])
}
