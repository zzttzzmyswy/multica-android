import { create } from "zustand"
import { GatewayClient, type ConnectionState, type DeviceInfo, type SendErrorResponse } from "@multica/sdk"
import { getGatewayUrl } from "@multica/fetch"
import { useMessagesStore } from "./messages"

interface GatewayState {
  connectionState: ConnectionState
  hubId: string | null
  hubs: DeviceInfo[]
  lastError: SendErrorResponse | null
}

interface GatewayActions {
  connect: (deviceId: string) => void
  disconnect: () => void
  setHubId: (hubId: string) => void
  listDevices: () => Promise<DeviceInfo[]>
  send: (to: string, action: string, payload: unknown) => void
  request: <T = unknown>(method: string, params?: unknown) => Promise<T>
}

export type GatewayStore = GatewayState & GatewayActions

let client: GatewayClient | null = null

export const useGatewayStore = create<GatewayStore>()((set, get) => ({
  connectionState: "disconnected",
  hubId: null,
  hubs: [],
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
    set({ connectionState: "disconnected", hubId: null, hubs: [] })
  },

  setHubId: (hubId) => set({ hubId }),

  listDevices: async () => {
    if (!client?.isRegistered) return []
    const devices = await client.listDevices()
    const hubs = devices.filter((d) => d.deviceType === "hub")
    set({ hubs })
    return devices
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
