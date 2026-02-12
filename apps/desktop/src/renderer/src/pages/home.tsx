import { useNavigate } from 'react-router-dom'
import { Button } from '@multica/ui/components/ui/button'
import {
  Loader2,
  ArrowRight,
  Settings,
} from 'lucide-react'
import { useHubStore } from '../stores/hub'
import { useProviderStore } from '../stores/provider'
import { cn } from '@multica/ui/lib/utils'

export default function HomePage() {
  const navigate = useNavigate()
  const { loading } = useHubStore()
  const { current, loading: providerLoading } = useProviderStore()

  const isProviderAvailable = current?.available ?? false
  const agentReady = !providerLoading && isProviderAvailable

  if (loading || providerLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          <span>Starting agent...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="container shrink-0 px-6 pt-6">
        {/* Page Header */}
        <div className="mb-6">
          <h1 className="text-lg font-medium">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Overview of your agent's status.</p>
        </div>

        {/* Status Section */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1 mt-4">
            <span className="relative flex size-2">
              {agentReady ? (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full size-2 bg-green-500" />
                </>
              ) : (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
                  <span className="relative inline-flex rounded-full size-2 bg-yellow-500" />
                </>
              )}
            </span>
            <span className={cn(
              'font-medium',
              agentReady
                ? 'text-green-600 dark:text-green-400'
                : 'text-yellow-600 dark:text-yellow-400'
            )}>
              {agentReady ? 'Your agent is running' : 'Configure LLM provider to start'}
            </span>
          </div>

          <p className="text-sm text-muted-foreground mb-4">
            {agentReady
              ? 'Ready to assist you. Start a conversation to get things done.'
              : 'Go to Agent settings to configure your LLM provider.'}
          </p>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="lg"
              className="gap-2"
              onClick={() => navigate('/chat')}
              disabled={!agentReady}
            >
              Start Chat
              <ArrowRight className="size-4" />
            </Button>

            {!agentReady && (
              <Button
                variant="ghost"
                size="lg"
                className="gap-2"
                onClick={() => navigate('/agent/profile')}
              >
                <Settings className="size-4" />
                Configure Agent
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
