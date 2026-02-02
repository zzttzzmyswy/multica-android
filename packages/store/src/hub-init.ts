"use client"

import { useEffect } from "react"
import { useHubStore } from "./hub"
import { useDeviceId } from "./device-id"
import { useGatewayStore } from "./gateway"

export function useHubInit() {
  const fetchHub = useHubStore((s) => s.fetchHub)
  const status = useHubStore((s) => s.status)
  const fetchAgents = useHubStore((s) => s.fetchAgents)
  const deviceId = useDeviceId()

  useEffect(() => { fetchHub() }, [fetchHub])
  useEffect(() => {
    if (status === "connected") fetchAgents()
  }, [status, fetchAgents])
  useEffect(() => {
    const id = setInterval(fetchHub, 30_000)
    return () => clearInterval(id)
  }, [fetchHub])

  // Connect gateway when hub is ready and deviceId is available
  useEffect(() => {
    if (status === "connected" && deviceId) {
      useGatewayStore.getState().connect(deviceId)
      return () => { useGatewayStore.getState().disconnect() }
    }
  }, [status, deviceId])
}
