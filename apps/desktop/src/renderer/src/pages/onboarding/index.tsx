import { useNavigate } from "react-router-dom";
import { useOnboardingStore } from "../../stores/onboarding";
import { MulticaIcon } from "@multica/ui/components/multica-icon";
import { ModeToggle } from "../../components/mode-toggle";
import WelcomeStep from "./components/welcome-step";
import PermissionsStep from "./components/permissions-step";
import SetupStep from "./components/setup-step";
import ConnectStep from "./components/connect-step";
import TryItStep from "./components/try-it-step";

const steps = ["Privacy", "Provider", "Channels", "Start"];

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { currentStep, nextStep, prevStep, completeOnboarding } =
    useOnboardingStore();

  const handleComplete = async () => {
    await completeOnboarding();
    navigate("/");
  };

  // Welcome step (step 0) has no header content, just draggable area
  if (currentStep === 0) {
    return (
      <div className="h-dvh flex flex-col bg-background">
        {/* Draggable title bar region for macOS - same height as main header */}
        <header
          className="shrink-0 h-12"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        />
        <main
          key={currentStep}
          className="flex-1 overflow-auto"
        >
          <WelcomeStep onStart={nextStep} />
        </main>
      </div>
    );
  }

  const stepLabel = steps[currentStep - 1];
  const totalSteps = steps.length;

  return (
    <div className="h-dvh flex flex-col bg-background">
      <header
        className="relative shrink-0 h-12 flex items-center justify-between px-4"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        {/* Left: Brand */}
        <div className="flex items-center gap-2 pl-16">
          <MulticaIcon bordered noSpin />
          <span className="text-sm tracking-wide font-brand">Multica</span>
        </div>

        {/* Center: Step indicator (absolute for true centering) */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-sm text-muted-foreground">
            {stepLabel} ({currentStep}/{totalSteps})
          </span>
        </div>

        {/* Right: Theme toggle */}
        <div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <ModeToggle />
        </div>
      </header>

      {/* Step content */}
      <main
        key={currentStep}
        className="flex-1 overflow-auto"
      >
        {currentStep === 1 && <PermissionsStep onNext={nextStep} />}
        {currentStep === 2 && <SetupStep onNext={nextStep} onBack={prevStep} />}
        {currentStep === 3 && (
          <ConnectStep onNext={nextStep} onBack={prevStep} />
        )}
        {currentStep === 4 && (
          <TryItStep onComplete={handleComplete} onBack={prevStep} />
        )}
      </main>
    </div>
  );
}
