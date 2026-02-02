import { create } from "zustand"
import { GatewayClient, type ConnectionState, type SendErrorResponse } from "@multica/sdk"
import { getGatewayUrl } from "@multica/fetch"
import { useMessagesStore } from "./messages"

interface GatewayState {
  connectionState: ConnectionState
  lastError: SendErrorResponse | null
}

interface GatewayActions {
  connect: (deviceId: string) => void
  disconnect: () => void
  send: (to: string, action: string, payload: unknown) => void
}

export type GatewayStore = GatewayState & GatewayActions

let client: GatewayClient | null = null

export const useGatewayStore = create<GatewayStore>()((set) => ({
  connectionState: "disconnected",
  lastError: null,

  connect: (deviceId) => {
    if (client) return

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
    set({ connectionState: "disconnected" })
  },

  send: (to, action, payload) => {
    if (!client?.isRegistered) return
    client.send(to, action, payload)
  },
}))
