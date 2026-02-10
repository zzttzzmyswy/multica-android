import { useNavigate } from 'react-router-dom'
import { Button } from '@multica/ui/components/ui/button'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft02Icon } from '@hugeicons/core-free-icons'
import { SamplePrompt } from '../../components/onboarding/sample-prompt'
import { useOnboardingStore } from '../../stores/onboarding'

const samplePrompts = [
  {
    title: 'Summarize a webpage',
    prompt: 'Summarize the key points from this article for me',
  },
  {
    title: 'Write a script',
    prompt: 'Write a Python script that converts CSV files to JSON',
  },
  {
    title: 'Explain code',
    prompt: 'Explain how React hooks work with a simple example',
  },
]

export default function TryItStep() {
  const navigate = useNavigate()
  const { completeOnboarding } = useOnboardingStore()

  const handleComplete = () => {
    completeOnboarding()
    navigate('/')
  }

  const handleBack = () => {
    navigate('/onboarding/connect')
  }

  return (
    <div className="h-full flex">
      {/* Left column — main content, centered both axes */}
      <div className="flex-1 flex items-center justify-center px-12 py-8">
        <div className="max-w-md w-full space-y-6">
          <button
            onClick={handleBack}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <HugeiconsIcon icon={ArrowLeft02Icon} className="size-4" />
            Back
          </button>

          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              You're all set
            </h1>
            <p className="text-sm text-muted-foreground">
              Multica is ready. Start a conversation with your AI agent,
              or try one of these prompts to get started.
            </p>
          </div>

          <div className="space-y-2">
            {samplePrompts.map((sp) => (
              <SamplePrompt
                key={sp.title}
                title={sp.title}
                prompt={sp.prompt}
                onClick={handleComplete}
              />
            ))}
          </div>

          <div className="flex justify-end">
            <Button size="lg" onClick={handleComplete}>
              Open Multica
            </Button>
          </div>
        </div>
      </div>

      {/* Right column — visual */}
      <div className="flex-1 flex items-center justify-center bg-muted/30 px-12 py-8">
        <div className="max-w-sm text-center space-y-4">
          <p className="text-4xl">&#x2728;</p>
          <h3 className="text-lg font-medium">Now, experience the magic</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Chat with your agent, automate tasks, run shell commands
            with approval, and connect to Telegram or Discord channels.
          </p>
        </div>
      </div>
    </div>
  )
}
