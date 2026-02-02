"use client"

import { useEffect } from "react"
import { useHubStore } from "./hub"
import { useDeviceId } from "./device-id"
import { useGatewayStore } from "./gateway"

export function useHubInit() {
  const deviceId = useDeviceId()
  const gwState = useGatewayStore((s) => s.connectionState)
  const hubId = useGatewayStore((s) => s.hubId)
  const fetchHub = useHubStore((s) => s.fetchHub)
  const fetchAgents = useHubStore((s) => s.fetchAgents)

  // Auto-connect WS when deviceId is available
  useEffect(() => {
    if (deviceId) {
      useGatewayStore.getState().connect(deviceId)
      return () => { useGatewayStore.getState().disconnect() }
    }
  }, [deviceId])

  // Once WS is registered, discover available hubs
  useEffect(() => {
    if (gwState === "registered") {
      useGatewayStore.getState().listDevices()
    }
  }, [gwState])

  // Once hubId is set and WS is registered, fetch hub info and agents via RPC
  useEffect(() => {
    if (gwState === "registered" && hubId) {
      fetchHub()
      fetchAgents()
    }
    if (gwState === "disconnected") {
      useHubStore.setState({ status: "idle", hub: null, agents: [], activeAgentId: null })
    }
  }, [gwState, hubId, fetchHub, fetchAgents])
}
