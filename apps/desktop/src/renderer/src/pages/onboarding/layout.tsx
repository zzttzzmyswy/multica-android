import { Outlet, useLocation } from 'react-router-dom'
import { Stepper, type StepId } from '../../components/onboarding/stepper'

export default function OnboardingLayout() {
  const location = useLocation()

  // Derive current step from URL path
  const pathSegment = location.pathname.split('/').pop() as string
  const validSteps: StepId[] = ['permissions', 'setup', 'connect', 'try-it']
  const currentStep: StepId = validSteps.includes(pathSegment as StepId)
    ? (pathSegment as StepId)
    : 'permissions'

  return (
    <div className="h-dvh flex flex-col bg-background">
      {/* Draggable title bar region for macOS + stepper */}
      <header
        className="shrink-0 px-6 pt-3 pb-2"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Spacer for traffic lights */}
        <div className="h-5" />
        <Stepper currentStep={currentStep} />
      </header>

      {/* Step content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
