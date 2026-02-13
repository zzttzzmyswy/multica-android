import { useState } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@multica/ui/components/ui/card'
import { Button } from '@multica/ui/components/ui/button'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@multica/ui/components/ui/tabs'
import { QrCode, Radio, Smartphone, WifiOff, Loader2 } from 'lucide-react'
import { useHubStore, selectPrimaryAgent } from '../stores/hub'
import { ConnectionQRCode } from '../components/qr-code'
import { DeviceList } from '../components/device-list'


function ChannelsTab() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Connect messaging platforms to chat with your agent.
      </p>
      <p className="text-sm text-muted-foreground">
        Message <span className="font-medium text-foreground">@multica_bot</span> on Telegram to get started.
        Discord and Slack coming soon.
      </p>
    </div>
  )
}

/** QR Code card with show/hide toggle */
function QRCodeCard({
  gateway,
  hubId,
  agentId,
}: {
  gateway: string
  hubId: string
  agentId: string
}) {
  const [expanded, setExpanded] = useState(true)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Scan to Connect</CardTitle>
            <CardDescription>Open Multica on your phone and scan.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => setExpanded(!expanded)}>
            <QrCode className="size-4 mr-1.5" />
            {expanded ? 'Hide' : 'Show'}
          </Button>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="flex justify-center">
          <ConnectionQRCode
            gateway={gateway}
            hubId={hubId}
            agentId={agentId}
            expirySeconds={30}
            size={200}
          />
        </CardContent>
      )}
    </Card>
  )
}

/** Authorized devices card */
function DevicesCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Authorized Devices</CardTitle>
        <CardDescription>Devices you've approved to access your agent.</CardDescription>
      </CardHeader>
      <CardContent>
        <DeviceList />
      </CardContent>
    </Card>
  )
}

function MulticaAppTab() {
  const { hubInfo, agents } = useHubStore()
  const primaryAgent = selectPrimaryAgent(agents)

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Scan to connect from your phone. Manage authorized devices.
      </p>

      <div className="space-y-6">
        <QRCodeCard
          gateway={hubInfo?.url ?? 'http://localhost:3000'}
          hubId={hubInfo?.hubId ?? 'unknown'}
          agentId={primaryAgent?.id ?? 'unknown'}
        />
        <DevicesCard />
      </div>
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
            Access your agent from anywhere. Connect via third-party platforms or the Multica mobile app.
          </p>
          <div className="mt-2">
            <GatewayStatus />
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="channels" className="flex-1">
          <TabsList className="mb-4">
            <TabsTrigger value="channels" className="gap-2">
              <Radio className="size-4" />
              Channels
            </TabsTrigger>
            <TabsTrigger value="app" className="gap-2">
              <Smartphone className="size-4" />
              Multica App
            </TabsTrigger>
          </TabsList>

          <TabsContent value="channels">
            <ChannelsTab />
          </TabsContent>

          <TabsContent value="app">
            <MulticaAppTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
