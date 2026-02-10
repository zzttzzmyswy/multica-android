import { cn } from '@multica/ui/lib/utils'
import { HugeiconsIcon } from '@hugeicons/react'
import { Tick02Icon } from '@hugeicons/core-free-icons'

export type StepId = 'permissions' | 'setup' | 'connect' | 'try-it'

interface Step {
  id: StepId
  label: string
}

const steps: Step[] = [
  { id: 'permissions', label: 'Permissions' },
  { id: 'setup', label: 'Provider' },
  { id: 'connect', label: 'Connect' },
  { id: 'try-it', label: 'Try it' },
]

interface StepperProps {
  currentStep: StepId
}

export function Stepper({ currentStep }: StepperProps) {
  const currentIndex = steps.findIndex((s) => s.id === currentStep)
  // Progress: 0% at step 0, 50% at step 1, 100% at step 2
  const progress = (currentIndex / (steps.length - 1)) * 100

  return (
    <div className="w-full space-y-3">
      {/* Step labels */}
      <nav className="flex items-center justify-center gap-3">
        {steps.map((step, index) => {
          const isCompleted = index < currentIndex
          const isCurrent = step.id === currentStep

          return (
            <div key={step.id} className="flex items-center gap-3">
              {index > 0 && (
                <span
                  className={cn(
                    'text-xs',
                    isCompleted || isCurrent
                      ? 'text-muted-foreground'
                      : 'text-muted-foreground/40'
                  )}
                >
                  ›
                </span>
              )}
              <span
                className={cn(
                  'flex items-center gap-1 text-sm transition-colors',
                  isCurrent && 'text-foreground font-medium',
                  isCompleted && 'text-foreground',
                  !isCurrent && !isCompleted && 'text-muted-foreground/60'
                )}
              >
                {isCompleted && (
                  <HugeiconsIcon
                    icon={Tick02Icon}
                    className="size-3.5 text-foreground"
                  />
                )}
                {step.label}
              </span>
            </div>
          )
        })}
      </nav>

      {/* Progress bar */}
      <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}
