/**
 * Chat Page - supports both Local (IPC) and Remote (Gateway) modes
 *
 * Local mode: useLocalChat() → ChatView (direct IPC to embedded Hub)
 * Remote mode: useGatewayConnection() + useChat() → DevicePairing / ChatView
 */
import { useState, useEffect } from 'react'
import { Button } from '@multica/ui/components/ui/button'
import { Loading } from '@multica/ui/components/ui/loading'
import { ChatView } from '@multica/ui/components/chat-view'
import { DevicePairing } from '@multica/ui/components/device-pairing'
import { useGatewayConnection } from '@multica/hooks/use-gateway-connection'
import { useChat } from '@multica/hooks/use-chat'
import { useLocalChat } from '../hooks/use-local-chat'

type ChatMode = 'select' | 'local' | 'remote'

export default function ChatPage() {
  const [mode, setMode] = useState<ChatMode>('select')
  const [defaultAgentId, setDefaultAgentId] = useState<string | null>(null)

  // Get default agent ID on mount (only for enabling the Local button)
  useEffect(() => {
    const loadAgentId = async () => {
      const status = await window.electronAPI.hub.getStatus()
      if (status.defaultAgent?.agentId) {
        setDefaultAgentId(status.defaultAgent.agentId)
      }
    }
    loadAgentId()
  }, [])

  if (mode === 'select') {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-6 p-4">
        <div className="text-center space-y-2">
          <h2 className="text-lg font-semibold">Start a Conversation</h2>
          <p className="text-sm text-muted-foreground">
            Choose how you want to connect
          </p>
        </div>

        <div className="flex flex-col gap-3 w-full max-w-xs">
          <Button
            size="lg"
            onClick={() => setMode('local')}
            disabled={!defaultAgentId}
            className="w-full"
          >
            Local Agent
            <span className="text-xs ml-2 opacity-70">(Direct IPC)</span>
          </Button>

          <Button
            size="lg"
            variant="outline"
            onClick={() => setMode('remote')}
            className="w-full"
          >
            Remote Agent
            <span className="text-xs ml-2 opacity-70">(Via Gateway)</span>
          </Button>
        </div>

        {!defaultAgentId && (
          <p className="text-xs text-muted-foreground">
            Waiting for local agent to initialize...
          </p>
        )}
      </div>
    )
  }

  if (mode === 'local') {
    return <LocalChatView onBack={() => setMode('select')} />
  }

  return <RemoteChatView onBack={() => setMode('select')} />
}

/**
 * Local Chat View - Direct IPC communication with agent.
 * useLocalChat() fetches agentId internally and returns UseChatReturn shape.
 */
function LocalChatView({ onBack }: { onBack: () => void }) {
  const chat = useLocalChat()

  return (
    <div className="h-full flex flex-col overflow-hidden w-full">
      <ChatView {...chat} onDisconnect={onBack} />
    </div>
  )
}

/**
 * Remote Chat View - Gateway connection to external Hub.
 * Mirrors the web app structure: DevicePairing → ConnectedRemoteChat.
 */
function RemoteChatView({ onBack }: { onBack: () => void }) {
  const {
    pageState,
    connectionState,
    identity,
    error,
    client,
    pairingKey,
    connect,
    disconnect,
  } = useGatewayConnection()

  const handleDisconnect = () => {
    disconnect()
    onBack()
  }

  return (
    <div className="h-full flex flex-col overflow-hidden w-full">
      {pageState === 'loading' && (
        <div className="flex-1 flex items-center justify-center gap-2 text-muted-foreground text-sm">
          <Loading />
          Loading...
        </div>
      )}

      {(pageState === 'not-connected' || pageState === 'connecting') && (
        <DevicePairing
          key={pairingKey}
          connectionState={connectionState}
          lastError={error}
          onConnect={connect}
          onCancel={handleDisconnect}
        />
      )}

      {pageState === 'connected' && client && identity && (
        <ConnectedRemoteChat
          client={client}
          hubId={identity.hubId}
          agentId={identity.agentId}
          onDisconnect={handleDisconnect}
        />
      )}
    </div>
  )
}

/** Thin wrapper that wires useChat to the shared ChatView */
function ConnectedRemoteChat({
  client,
  hubId,
  agentId,
  onDisconnect,
}: {
  client: NonNullable<ReturnType<typeof useGatewayConnection>['client']>
  hubId: string
  agentId: string
  onDisconnect: () => void
}) {
  const chat = useChat({ client, hubId, agentId })

  return <ChatView {...chat} onDisconnect={onDisconnect} />
}
