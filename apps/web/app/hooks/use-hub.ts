import { useState, useCallback, useEffect } from "react"
import { CONSOLE_URL } from "../lib/config"

interface HubInfo {
  hubId: string
  url: string
  connectionState: string
  agentCount: number
}

interface Agent {
  id: string
  closed: boolean
}

type HubStatus = "idle" | "loading" | "connected" | "error"

export function useHub() {
  const [status, setStatus] = useState<HubStatus>("idle")
  const [hub, setHub] = useState<HubInfo | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])

  const fetchHub = useCallback(async () => {
    setStatus("loading")
    try {
      const res = await fetch(`${CONSOLE_URL}/api/hub`)
      if (!res.ok) throw new Error(res.statusText)
      const data: HubInfo = await res.json()
      setHub(data)
      setStatus(data.connectionState === "registered" ? "connected" : "error")
    } catch {
      setStatus("error")
      setHub(null)
    }
  }, [])

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch(`${CONSOLE_URL}/api/agents`)
      if (res.ok) setAgents(await res.json())
    } catch { /* silent */ }
  }, [])

  const createAgent = useCallback(async () => {
    await fetch(`${CONSOLE_URL}/api/agents`, { method: "POST" })
    await fetchAgents()
  }, [fetchAgents])

  const deleteAgent = useCallback(async (id: string) => {
    await fetch(`${CONSOLE_URL}/api/agents/${id}`, { method: "DELETE" })
    await fetchAgents()
  }, [fetchAgents])

  // Auto-fetch hub on mount, agents when connected, poll every 30s
  useEffect(() => { fetchHub() }, [fetchHub])
  useEffect(() => {
    if (status === "connected") fetchAgents()
  }, [status, fetchAgents])
  useEffect(() => {
    const id = setInterval(fetchHub, 30_000)
    return () => clearInterval(id)
  }, [fetchHub])

  return { status, hub, agents, fetchHub, createAgent, deleteAgent }
}
