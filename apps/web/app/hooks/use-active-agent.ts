import { create } from "zustand"

interface ActiveAgentState {
  activeAgentId: string | null
  setActiveAgentId: (id: string | null) => void
}

export const useActiveAgent = create<ActiveAgentState>()((set) => ({
  activeAgentId: null,
  setActiveAgentId: (id: string | null) => set({ activeAgentId: id }),
}))
