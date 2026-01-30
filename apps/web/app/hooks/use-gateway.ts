import { useEffect, useRef, useState, useCallback } from "react"
import { GatewayClient, type ConnectionState, type RoutedMessage } from "@multica/sdk"
import { useDeviceId } from "./use-device-id"
import { GATEWAY_URL } from "../lib/config"

interface UseGatewayOptions {
  onMessage?: (msg: RoutedMessage) => void
}

export function useGateway(options?: UseGatewayOptions) {
  const deviceId = useDeviceId()
  const [state, setState] = useState<ConnectionState>("disconnected")
  const clientRef = useRef<GatewayClient | null>(null)
  const onMessageRef = useRef(options?.onMessage)
  onMessageRef.current = options?.onMessage

  useEffect(() => {
    if (!deviceId) return

    const client = new GatewayClient({
      url: GATEWAY_URL,
      deviceId,
      deviceType: "client",
    })
      .onStateChange(setState)
      .onMessage(msg => onMessageRef.current?.(msg))

    clientRef.current = client
    client.connect()
    return () => { client.disconnect() }
  }, [deviceId])

  const send = useCallback(
    (to: string, action: string, payload: unknown) => {
      clientRef.current?.send(to, action, payload)
    },
    []
  )

  return { state, send }
}
