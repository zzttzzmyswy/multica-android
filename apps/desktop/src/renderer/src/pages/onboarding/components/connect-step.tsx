import { Button } from '@multica/ui/components/ui/button'
import { Separator } from '@multica/ui/components/ui/separator'
import { ChevronLeft, Info } from 'lucide-react'
import { useHubStore, selectPrimaryAgent } from '../../../stores/hub'
import { TelegramConnectQR } from '../../../components/telegram-qr'
import { StepDots } from './step-dots'

interface ConnectStepProps {
  onNext: () => void
  onBack: () => void
}

export default function ConnectStep({ onNext, onBack }: ConnectStepProps) {
  const { hubInfo, agents } = useHubStore()
  const primaryAgent = selectPrimaryAgent(agents)

  return (
    <div className="h-full flex items-center justify-center px-6 py-8 animate-in fade-in duration-300">
      <div className="w-full max-w-md space-y-6">
        {/* Back button */}
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="size-4" />
          Back
        </button>

        {/* Header */}
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Connect Telegram
          </h1>
          <p className="text-sm text-muted-foreground">
            Scan the QR code with your phone camera to connect on Telegram.
          </p>
        </div>

        {/* Info box */}
        <div className="rounded-lg bg-muted/50 px-4 py-3 space-y-2">
          <p className="text-sm text-muted-foreground">
            Chat with your agent from your phone via Telegram.
            Your messages are routed through the Gateway to this machine.
          </p>
          <p className="text-xs text-muted-foreground/70 flex items-center gap-1.5">
            <Info className="size-3.5 shrink-0" />
            Discord, Slack, and more coming soon.
          </p>
        </div>

        {/* QR code */}
        <div className="flex justify-center py-2">
          <TelegramConnectQR
            gateway={hubInfo?.url ?? 'http://localhost:3000'}
            hubId={hubInfo?.hubId ?? 'unknown'}
            agentId={primaryAgent?.id ?? 'unknown'}
            expirySeconds={30}
            size={180}
          />
        </div>

        <Separator />

        {/* Footer */}
        <div className="flex items-center justify-between">
          <StepDots />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onNext}>
              Skip
            </Button>
            <Button size="sm" onClick={onNext}>
              Continue
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
