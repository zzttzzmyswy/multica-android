import { create } from "zustand"
import { consoleApi } from "@multica/fetch"
import { toast } from "sonner"

export interface HubInfo {
  hubId: string
  url: string
  connectionState: string
  agentCount: number
}

export interface Agent {
  id: string
  closed: boolean
}

export type HubStatus = "idle" | "loading" | "connected" | "error"

interface HubState {
  status: HubStatus
  hub: HubInfo | null
  agents: Agent[]
  activeAgentId: string | null
}

interface HubActions {
  setActiveAgentId: (id: string | null) => void
  fetchHub: () => Promise<void>
  fetchAgents: () => Promise<void>
  createAgent: (options?: Record<string, unknown>) => Promise<void>
  deleteAgent: (id: string) => Promise<void>
}

export type HubStore = HubState & HubActions

export const useHubStore = create<HubStore>()((set, get) => ({
  status: "idle",
  hub: null,
  agents: [],
  activeAgentId: null,

  setActiveAgentId: (id) => set({ activeAgentId: id }),

  fetchHub: async () => {
    set({ status: "loading" })
    try {
      const data = await consoleApi.get<HubInfo>("/api/hub")
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
      const data = await consoleApi.get<Agent[]>("/api/agents")
      set({ agents: data })
    } catch (e) {
      toast.error("Failed to fetch agents")
      console.error(e)
    }
  },

  createAgent: async (options?) => {
    try {
      const data = await consoleApi.post<{ id: string }>("/api/agents", options)
      await get().fetchAgents()
      if (data.id) set({ activeAgentId: data.id })
    } catch (e) {
      toast.error("Failed to create agent")
      console.error(e)
    }
  },

  deleteAgent: async (id) => {
    if (get().activeAgentId === id) set({ activeAgentId: null })
    try {
      await consoleApi.delete("/api/agents/" + id)
      await get().fetchAgents()
    } catch (e) {
      toast.error("Failed to delete agent")
      console.error(e)
    }
  },
}))
