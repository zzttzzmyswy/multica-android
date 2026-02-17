import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@multica/ui/components/ui/card'
import { WifiOff, Loader2 } from 'lucide-react'
import { useHubStore, selectPrimaryAgent } from '../stores/hub'
import { TelegramConnectQR } from '../components/telegram-qr'
import { DeviceList } from '../components/device-list'

function ChannelsContent() {
  const { hubInfo, agents } = useHubStore()
  const primaryAgent = selectPrimaryAgent(agents)

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Connect messaging platforms to chat with your agent.
      </p>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Telegram</CardTitle>
              <CardDescription>Scan with your phone camera to connect on Telegram.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex justify-center">
          <TelegramConnectQR
            gateway={hubInfo?.url ?? 'http://localhost:3000'}
            hubId={hubInfo?.hubId ?? 'unknown'}
            agentId={primaryAgent?.id ?? 'unknown'}
            conversationId={primaryAgent?.id ?? 'unknown'}
            expirySeconds={30}
            size={200}
          />
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        Discord and Slack coming soon.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Authorized Devices</CardTitle>
          <CardDescription>Devices you've approved to access your agent.</CardDescription>
        </CardHeader>
        <CardContent>
          <DeviceList />
        </CardContent>
      </Card>
    </div>
  )
}

/** Gateway status indicator - only shows when disconnected/error */
function GatewayStatus() {
  const { hubInfo } = useHubStore()
  const state = hubInfo?.connectionState ?? 'disconnected'
  const url = hubInfo?.url ?? 'Unknown'

  // Only show when not connected
  const isConnected = state === 'connected' || state === 'registered'
  if (isConnected) return null

  const isConnecting = state === 'connecting' || state === 'reconnecting'

  return (
    <div className="flex items-center gap-2 text-sm rounded-md bg-destructive/10 text-destructive px-3 py-2">
      {isConnecting ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <WifiOff className="size-4" />
      )}
      <span>
        {state === 'connecting' && 'Connecting to gateway...'}
        {state === 'reconnecting' && 'Reconnecting to gateway...'}
        {state === 'disconnected' && 'Gateway disconnected'}
      </span>
      <span className="text-destructive/60 font-mono text-xs truncate max-w-[200px]" title={url}>
        {url}
      </span>
    </div>
  )
}

export default function ClientsPage() {
  return (
    <div className="h-full overflow-auto">
      <div className="container flex flex-col p-6">
        {/* Page Header */}
        <div className="mb-6">
          <h1 className="text-lg font-medium">Clients</h1>
          <p className="text-sm text-muted-foreground">
            Access your agent from anywhere. Connect via third-party platforms.
          </p>
          <div className="mt-2">
            <GatewayStatus />
          </div>
        </div>

        <ChannelsContent />
      </div>
    </div>
  )
}
