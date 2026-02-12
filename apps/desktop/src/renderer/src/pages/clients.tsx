import { useState } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@multica/ui/components/ui/card'
import { Button } from '@multica/ui/components/ui/button'
import { Input } from '@multica/ui/components/ui/input'
import { Badge } from '@multica/ui/components/ui/badge'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@multica/ui/components/ui/tabs'
import { QrCode, Radio, Smartphone } from 'lucide-react'
import { useChannelsStore } from '../stores/channels'
import { useHubStore, selectPrimaryAgent } from '../stores/hub'
import { ConnectionQRCode } from '../components/qr-code'
import { DeviceList } from '../components/device-list'

/** Status badge color mapping */
function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'running': return 'default'
    case 'starting': return 'secondary'
    case 'error': return 'destructive'
    default: return 'outline'
  }
}

function TelegramCard() {
  const { states, config, saveToken, removeToken, startChannel, stopChannel } = useChannelsStore()
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  // Current state and config for telegram:default
  const state = states.find((s) => s.channelId === 'telegram' && s.accountId === 'default')
  const savedConfig = config['telegram']?.['default'] as { botToken?: string } | undefined
  const hasToken = Boolean(savedConfig?.botToken)
  const isRunning = state?.status === 'running'
  const isStarting = state?.status === 'starting'

  const handleSave = async () => {
    if (!token.trim()) return
    setSaving(true)
    setLocalError(null)
    const result = await saveToken('telegram', 'default', token.trim())
    if (!result.ok) {
      setLocalError(result.error ?? 'Failed to save')
    } else {
      setToken('') // Clear input on success
    }
    setSaving(false)
  }

  const handleRemove = async () => {
    setSaving(true)
    setLocalError(null)
    const result = await removeToken('telegram', 'default')
    if (!result.ok) {
      setLocalError(result.error ?? 'Failed to remove')
    }
    setSaving(false)
  }

  const handleToggle = async () => {
    setSaving(true)
    setLocalError(null)
    if (isRunning || isStarting) {
      await stopChannel('telegram', 'default')
    } else {
      await startChannel('telegram', 'default')
    }
    setSaving(false)
  }

  // Mask the token for display: show first 5 and last 5 chars
  const maskedToken = savedConfig?.botToken
    ? `${savedConfig.botToken.slice(0, 5)}${'*'.repeat(10)}${savedConfig.botToken.slice(-5)}`
    : null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Telegram</CardTitle>
            <CardDescription>
              Connect a Telegram bot via Bot API long polling.
            </CardDescription>
          </div>
          {state && (
            <Badge variant={statusVariant(state.status)}>
              {state.status}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasToken ? (
          // Token is configured — show masked token and actions
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <code className="text-sm text-muted-foreground bg-muted px-2 py-1 rounded flex-1 truncate">
                {maskedToken}
              </code>
            </div>

            {state?.error && (
              <p className="text-sm text-destructive">{state.error}</p>
            )}

            <div className="flex gap-2">
              <Button
                variant={isRunning ? 'outline' : 'default'}
                size="sm"
                onClick={handleToggle}
                disabled={saving}
              >
                {isRunning ? 'Stop' : isStarting ? 'Starting...' : 'Start'}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleRemove}
                disabled={saving || isRunning}
                title={isRunning ? 'Stop the bot before removing' : undefined}
              >
                Remove
              </Button>
            </div>
          </div>
        ) : (
          // No token — show input form
          <div className="space-y-3">
            <Input
              type="password"
              placeholder="Bot Token (from @BotFather)"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            />
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || !token.trim()}
            >
              {saving ? 'Saving...' : 'Save & Connect'}
            </Button>
          </div>
        )}

        {localError && (
          <p className="text-sm text-destructive">{localError}</p>
        )}
      </CardContent>
    </Card>
  )
}

function ChannelsTab() {
  const { loading, error } = useChannelsStore()

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Connect messaging platforms to chat with your agent.
      </p>
      <TelegramCard />
    </div>
  )
}

function MulticaAppTab() {
  const { hubInfo, agents } = useHubStore()
  const primaryAgent = selectPrimaryAgent(agents)
  const [qrCodeExpanded, setQrCodeExpanded] = useState(false)

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Scan to connect from your phone. Manage authorized devices.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* QR Code Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Scan to Connect</CardTitle>
                <CardDescription>
                  Open Multica on your phone and scan.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setQrCodeExpanded(!qrCodeExpanded)}
              >
                <QrCode className="size-4 mr-1.5" />
                {qrCodeExpanded ? 'Hide' : 'Show'}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center py-4">
              {qrCodeExpanded ? (
                <ConnectionQRCode
                  gateway={hubInfo?.url ?? 'http://localhost:3000'}
                  hubId={hubInfo?.hubId ?? 'unknown'}
                  agentId={primaryAgent?.id}
                  expirySeconds={30}
                  size={160}
                />
              ) : (
                <button
                  onClick={() => setQrCodeExpanded(true)}
                  className="flex flex-col items-center justify-center gap-3 p-8 rounded-xl border-2 border-dashed border-muted-foreground/25 hover:border-muted-foreground/50 transition-colors cursor-pointer"
                >
                  <QrCode className="size-12 text-muted-foreground/40" />
                  <span className="text-sm text-muted-foreground">Click to show QR code</span>
                </button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Device List Section */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Authorized Devices</CardTitle>
            <CardDescription>
              Devices you've approved to access your agent.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DeviceList />
          </CardContent>
        </Card>
      </div>
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
