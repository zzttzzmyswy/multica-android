import { create } from "zustand"
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

interface HubStore {
  status: HubStatus
  hub: HubInfo | null
  agents: Agent[]
  activeAgentId: string | null

  setActiveAgentId: (id: string | null) => void
  fetchHub: () => Promise<void>
  fetchAgents: () => Promise<void>
  createAgent: () => Promise<void>
  deleteAgent: (id: string) => Promise<void>
}

export const useHubStore = create<HubStore>()((set, get) => ({
  status: "idle",
  hub: null,
  agents: [],
  activeAgentId: null,

  setActiveAgentId: (id) => set({ activeAgentId: id }),

  fetchHub: async () => {
    set({ status: "loading" })
    try {
      const res = await fetch(`${CONSOLE_URL}/api/hub`)
      if (!res.ok) throw new Error(res.statusText)
      const data: HubInfo = await res.json()
      set({
        hub: data,
        status: data.connectionState === "registered" ? "connected" : "error",
      })
    } catch {
      set({ status: "error", hub: null })
    }
  },

  fetchAgents: async () => {
    try {
      const res = await fetch(`${CONSOLE_URL}/api/agents`)
      if (res.ok) set({ agents: await res.json() })
    } catch { /* silent */ }
  },

  createAgent: async () => {
    const res = await fetch(`${CONSOLE_URL}/api/agents`, { method: "POST" })
    await get().fetchAgents()
    if (res.ok) {
      const data = await res.json()
      if (data.id) set({ activeAgentId: data.id })
    }
  },

  deleteAgent: async (id) => {
    if (get().activeAgentId === id) set({ activeAgentId: null })
    await fetch(`${CONSOLE_URL}/api/agents/${id}`, { method: "DELETE" })
    await get().fetchAgents()
  },
}))
