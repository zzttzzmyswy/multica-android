import { create } from "zustand"
import { toast } from "sonner"
import type {
  GetHubInfoResult,
  ListAgentsResult,
  CreateAgentResult,
  DeleteAgentResult,
} from "@multica/sdk"
import { useGatewayStore } from "./gateway"

export type HubInfo = GetHubInfoResult

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
      const { request } = useGatewayStore.getState()
      const data = await request<GetHubInfoResult>("getHubInfo")
      set({ hub: data, status: "connected" })
    } catch {
      set({ status: "error", hub: null })
    }
  },

  fetchAgents: async () => {
    try {
      const { request } = useGatewayStore.getState()
      const data = await request<ListAgentsResult>("listAgents")
      set({ agents: data.agents })
    } catch (e) {
      toast.error("Failed to fetch agents")
      console.error(e)
    }
  },

  createAgent: async (options?) => {
    try {
      const { request } = useGatewayStore.getState()
      const data = await request<CreateAgentResult>("createAgent", options)
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
      const { request } = useGatewayStore.getState()
      await request<DeleteAgentResult>("deleteAgent", { id })
      await get().fetchAgents()
    } catch (e) {
      toast.error("Failed to delete agent")
      console.error(e)
    }
  },
}))
