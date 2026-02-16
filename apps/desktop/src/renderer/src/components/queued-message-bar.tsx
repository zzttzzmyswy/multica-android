import type { QueuedLocalMessage } from '../hooks/use-local-chat'

interface QueuedMessageBarProps {
  messages: QueuedLocalMessage[]
  isRunning: boolean
  onRemove: (id: string) => void
  onClear: () => void
}

export function QueuedMessageBar({ messages, isRunning, onRemove, onClear }: QueuedMessageBarProps) {
  if (messages.length === 0) return null

  const statusText = isRunning
    ? 'Agent is running. Queued messages will send automatically.'
    : 'Queued messages are being sent.'

  return (
    <div className="container px-4 pb-2">
      <div className="rounded-lg border bg-muted/40">
        <div className="flex items-center justify-between px-3 pt-2 pb-1">
          <span className="text-xs font-medium text-foreground/80">
            {messages.length} queued message{messages.length > 1 ? 's' : ''}
          </span>
          <button
            onClick={onClear}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear
          </button>
        </div>
        <div className="px-3 pb-2 text-xs text-muted-foreground">{statusText}</div>
        <div className="px-2 pb-2 space-y-1">
          {messages.slice(0, 3).map((item) => (
            <div key={item.id} className="flex items-start justify-between gap-2 rounded-md bg-background/70 px-2 py-1.5">
              <div className="text-xs text-foreground/85 break-all">{item.text}</div>
              <button
                onClick={() => onRemove(item.id)}
                className="shrink-0 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Remove
              </button>
            </div>
          ))}
          {messages.length > 3 && (
            <div className="px-1 text-xs text-muted-foreground">
              +{messages.length - 3} more
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
