import { HugeiconsIcon } from '@hugeicons/react'
import {
  Key01Icon,
  Database01Icon,
  CommandLineIcon,
} from '@hugeicons/core-free-icons'

const privacyItems = [
  {
    icon: Database01Icon,
    title: 'Everything stays local',
    description:
      'All sessions, history, and profiles are stored on your device. Nothing leaves your computer.',
  },
  {
    icon: Key01Icon,
    title: 'Your data, your control',
    description:
      'API keys and credentials are saved locally in ~/.super-multica/. We never access them.',
  },
  {
    icon: CommandLineIcon,
    title: 'Transparent execution',
    description:
      'Every shell command the agent wants to run requires your explicit approval first.',
  },
]

export function PrivacyPanel() {
  return (
    <div className="rounded-2xl bg-muted/50 border border-border/50 p-6 space-y-5">
      {privacyItems.map((item) => (
        <div key={item.title} className="flex gap-3">
          <div className="mt-0.5 flex items-center justify-center size-7 rounded-lg bg-primary/10 shrink-0">
            <HugeiconsIcon icon={item.icon} className="size-4 text-primary" />
          </div>
          <div className="space-y-0.5">
            <p className="font-medium text-sm text-primary">{item.title}</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {item.description}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}
