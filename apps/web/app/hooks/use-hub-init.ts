"use client"

import { useEffect } from "react"
import { useHubStore } from "./use-hub-store"

export function useHubInit() {
  const fetchHub = useHubStore((s) => s.fetchHub)
  const status = useHubStore((s) => s.status)
  const fetchAgents = useHubStore((s) => s.fetchAgents)

  useEffect(() => { fetchHub() }, [fetchHub])
  useEffect(() => {
    if (status === "connected") fetchAgents()
  }, [status, fetchAgents])
  useEffect(() => {
    const id = setInterval(fetchHub, 30_000)
    return () => clearInterval(id)
  }, [fetchHub])
}
