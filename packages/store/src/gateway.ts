import { create } from "zustand"
import { GatewayClient, type ConnectionState, type SendErrorResponse } from "@multica/sdk"
import { getGatewayUrl } from "@multica/fetch"
import { useMessagesStore } from "./messages"

interface GatewayState {
  connectionState: ConnectionState
  hubId: string | null
  lastError: SendErrorResponse | null
}

interface GatewayActions {
  connect: (deviceId: string, hubId: string) => void
  disconnect: () => void
  send: (to: string, action: string, payload: unknown) => void
  request: <T = unknown>(method: string, params?: unknown) => Promise<T>
}

export type GatewayStore = GatewayState & GatewayActions

let client: GatewayClient | null = null

export const useGatewayStore = create<GatewayStore>()((set, get) => ({
  connectionState: "disconnected",
  hubId: null,
  lastError: null,

  connect: (deviceId, hubId) => {
    if (client) return

    set({ hubId })

    client = new GatewayClient({
      url: getGatewayUrl(),
      deviceId,
      deviceType: "client",
    })
      .onStateChange((connectionState) => set({ connectionState }))
      .onMessage((msg) => {
        const payload = msg.payload as { agentId?: string; content?: string }
        if (payload?.agentId && payload?.content) {
          useMessagesStore.getState().addAssistantMessage(payload.content, payload.agentId)
        }
      })
      .onSendError((error) => set({ lastError: error }))

    client.connect()
  },

  disconnect: () => {
    if (client) {
      client.disconnect()
      client = null
    }
    set({ connectionState: "disconnected", hubId: null })
  },

  send: (to, action, payload) => {
    if (!client?.isRegistered) return
    client.send(to, action, payload)
  },

  request: <T = unknown>(method: string, params?: unknown): Promise<T> => {
    const { hubId } = get()
    if (!client?.isRegistered || !hubId) {
      return Promise.reject(new Error("Not connected"))
    }
    return client.request<T>(hubId, method, params)
  },
}))
